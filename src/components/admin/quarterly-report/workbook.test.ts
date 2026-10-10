import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReport, type MetricRow } from './model';
import { buildWorkbook, reportBytes } from './workbook';
function sample(empty = false) {
  const row = (id: string, building_id: string, extra: Partial<MetricRow> = {}): MetricRow => ({ id, building_id, record_year: 2026, record_quarter: 3, created_at: '2026-10-10T01:00:00.123456Z', total_area: 100, net_effective_rent: 240, vacant_area: 0.5, vacancy_rate: 0.5, asking_rent: 300, management_fee: 30, face_rent: 270, rent_free_period: 4, owner: '测试业主', property_management: '测试物业', user_name: '测试提交人', notes: '=1+1', ...extra });
  return buildReport({ period: { year: 2026, quarter: 3 }, capturedAt: '2026-10-10T02:00:00Z', users: [], buildings: [{ id: 'a', name: '测试楼宇甲', grade: 'P', submarket: 'CBD' }, { id: 'b', name: '测试楼宇乙', grade: 'B', submarket: '金融街' }, { id: 'c', name: '测试园区', grade: 'BP', submarket: '上地' }], submissions: empty ? [] : [row('old', 'a', { created_at: '2026-10-09T00:00:00Z', net_effective_rent: 245 }), row('new', 'a'), row('b', 'b', { vacant_area: 0, vacancy_rate: 0 }), row('c', 'c', { net_effective_rent: null, vacant_area: null, vacancy_rate: null })], previousMetrics: [row('p-a', 'a', { record_quarter: 2, net_effective_rent: 250, vacant_area: 1, vacancy_rate: 0.01 }), row('p-b', 'b', { record_quarter: 2, net_effective_rent: 245, vacant_area: 0, vacancy_rate: 0 })] });
}
describe('minimal four-sheet Excel workbook', () => {
  it('contains exactly four sheets with the original business information and no technical columns', () => {
    const report = sample(); const { workbook } = buildWorkbook(report);
    expect(workbook.SheetNames).toEqual(['01 季度环比', '02 本季最新', '03 原始记录', '04 市场看板']);
    const raw = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['03 原始记录'], { header: 1, raw: true });
    expect(raw.slice(4)).toHaveLength(report.raw.length);
    expect(raw[3]).toEqual(['项目名称', '类型', '子市场', '总面积(㎡)', '报价租金(元/㎡/月)', '物业费(元/㎡/月)', '表面租金(元/㎡/月)', '免租期(月)', '净有效租金(元/㎡/月)', '空置面积(㎡)', '空置率', '填写人', '提交时间（北京时间）', '业主', '物业公司', '备注']);
    expect(JSON.stringify(raw[3])).not.toMatch(/UUID|行政区|user_id|building_id/);
  });
  it('keeps numbers, missing values, literal formula-like text and sub-1% vacancy intact', () => {
    const { workbook } = buildWorkbook(sample()); const sheet = workbook.Sheets['02 本季最新'];
    expect(sheet.K5).toMatchObject({ v: 0.005, t: 'n', z: '0.0%' });
    expect(sheet.K6.v).toBe(0); expect(sheet.I7.v).toBe('');
    expect(sheet.M5.v).toContain('09:00:00.123456');
    expect(sheet.P5).toMatchObject({ v: '=1+1', t: 's' }); expect(sheet.P5.f).toBeUndefined();
  });
  it('adds checks only when necessary and leaves raw records untouched', () => {
    const { workbook } = buildWorkbook(sample());
    expect(workbook.Sheets['02 本季最新'].Q4.v).toBe('数据检查');
    expect(workbook.Sheets['03 原始记录'].Q4).toBeUndefined();
    const report = sample(); report.latest = report.latest.filter(r => !r.checks.length);
    expect(buildWorkbook(report).workbook.Sheets['02 本季最新'].Q4).toBeUndefined();
  });
  it('handles no current submissions without inventing current values or changes', () => {
    const { workbook } = buildWorkbook(sample(true));
    expect(XLSX.utils.decode_range(workbook.Sheets['02 本季最新']['!ref']!).e.r).toBe(3);
    expect(workbook.Sheets['04 市场看板'].B7.v).toBe(0);
    expect(workbook.Sheets['04 市场看板'].E7.v).toBe('');
  });
  it('round-trips independently copied XLSX bytes and validates XML, styles, panes and values', async () => {
    const bytes = await reportBytes(sample());
    const artifactDir = process.env.QUARTERLY_REPORT_ARTIFACT_DIR;
    if (artifactDir) { mkdirSync(artifactDir, { recursive: true }); writeFileSync(join(artifactDir, 'synthetic-quarterly-report.xlsx'), bytes); }
    const zip = await JSZip.loadAsync(new Uint8Array(bytes));
    const xml = async (name: string) => {
      const entry = zip.file(name); expect(entry, name).not.toBeNull();
      return new DOMParser().parseFromString(await entry!.async('string'), 'application/xml');
    };
    for (const name of Object.keys(zip.files).filter(n => n.endsWith('.xml'))) expect((await xml(name)).querySelector('parsererror'), name).toBeNull();
    const styles = await xml('xl/styles.xml'); const xfs = styles.querySelector('cellXfs')!;
    expect(xfs.children.length).toBe(Number(xfs.getAttribute('count')));
    for (let i = 1; i <= 4; i++) {
      const doc = await xml(`xl/worksheets/sheet${i}.xml`);
      expect(doc.querySelector('pane')?.getAttribute('state')).toBe('frozen');
      expect(doc.querySelector('pane')?.getAttribute('ySplit')).toBe(i === 4 ? '3' : '4');
      for (const cell of doc.querySelectorAll('c[s]')) expect(Number(cell.getAttribute('s'))).toBeLessThan(xfs.children.length);
      expect(doc.querySelector('f')).toBeNull();
    }
    expect((await xml('xl/workbook.xml')).querySelector('workbookView')?.getAttribute('activeTab')).toBe('3');
    const reloaded = XLSX.read(new Uint8Array(bytes), { type: 'array', cellNF: true });
    expect(reloaded.Sheets['02 本季最新'].K5).toMatchObject({ v: 0.005, z: '0.0%' });
    expect(reloaded.Sheets['02 本季最新'].P5.v).toBe('=1+1');
    const comparison = XLSX.utils.sheet_to_json<unknown[]>(reloaded.Sheets['01 季度环比'], { header: 1, raw: true });
    expect(comparison[4]).toContain(240);
    expect(comparison[4]).toContain(250);
    expect(comparison[4]).toContain(-0.04);
  });
});
