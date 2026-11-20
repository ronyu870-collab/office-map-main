import { describe, expect, it } from 'vitest';
import { buildStackingWorkbook, createStackingExcelRecords, type ExportableSpace } from '../stackingPlanExcel';
import { createStackingPresentationSvg } from '../stackingPlanPresentation';
import type { PlanFloor } from '../stackingPlanModel';

const towers = [
  { id: 'tower-a', code: 'A', display_name: 'A 座' },
  { id: 'tower-b', code: 'B', display_name: 'B 座' },
];
const floors: PlanFloor[] = [
  { id: 'floor-a', tower_id: 'tower-a', floor_code: '5', level_order: 5, floor_area_sqm: 300, zone: null, use_type: 'office' },
  { id: 'floor-b', tower_id: 'tower-b', floor_code: '18', level_order: 18, floor_area_sqm: 200, zone: null, use_type: 'office' },
];
const spaces: ExportableSpace[] = [
  { id: 'a1', floor_id: 'floor-a', unit_code: '01', tenant_name: 'Example',
    occupancy_status: 'occupied', area_sqm: 180, verification_status: 'source_unverified',
    lease_steps: [
      { start: '2026-01-01', end: '2026-06-30', face_rent_monthly: 330, unit: '元/㎡/月' },
      { start: '2026-07-01', end: null, face_rent_monthly: 360, unit: '元/㎡/月' },
    ], notes: '=HYPERLINK("https://example.invalid")' },
  { id: 'a2', floor_id: 'floor-a', unit_code: '02', tenant_name: null,
    occupancy_status: 'unknown', area_sqm: null, verification_status: 'source_unverified',
    lease_steps: [], notes: '' },
  { id: 'b1', floor_id: 'floor-b', unit_code: '01', tenant_name: null,
    occupancy_status: 'vacant', area_sqm: 200, verification_status: 'source_unverified',
    lease_steps: [], notes: '' },
];
const common = { projectName: 'Demo Building', towers, floors, spaces,
  sourceDate: '2026-11-18', sourceTitle: 'Historic snapshot', originalArchived: false,
  filter: 'all' as const, search: '' };

describe('Stacking Plan executive export data fidelity', () => {
  it('preserves two towers, unknown areas, and independent rent-step rows', () => {
    const records = createStackingExcelRecords({ ...common, scope: 'all' });
    expect(records.floorRecords).toHaveLength(2);
    expect(records.spaceRecords).toHaveLength(3);
    expect(records.rentRecords).toHaveLength(2);
    const a = records.floorRecords.find(row => row['楼座'] === 'A 座');
    expect(a?.['完整来源已租面积(㎡)']).toBe(180);
    expect(a?.['完整来源空置面积(㎡)']).toBe(0);
    expect(a?.['面积未知单元数']).toBe(1);
    expect(records.rentRecords.map(r => r['表面租金(元/㎡/月)'])).toEqual([330, 360]);
    expect(records.rentRecords.every(r => r['月总租金(元/月)'] === null)).toBe(true);
    expect(records.spaceRecords[0]['备注']).toMatch(/^'/);
    expect(records.spaceRecords[0]['核验状态']).toBe('未逐项核验');
  });

  it('neutralizes formula-like content in untrusted lease-stage dates', () => {
    const injected = createStackingExcelRecords({
      ...common, scope: 'all',
      spaces: [{ ...spaces[0], lease_steps: [{
        start: '=HYPERLINK("https://invalid.example")',
        end: '+SUM(1,2)',
        face_rent_monthly: 330,
      }] }, ...spaces.slice(1)],
    });
    expect(injected.rentRecords[0]['开始日期']).toMatch(/^'/);
    expect(injected.rentRecords[0]['结束日期']).toMatch(/^'/);
  });

  it('limits Excel rows to current filters without redefining complete floor area', () => {
    const records = createStackingExcelRecords({
      ...common, scope: 'visible', filter: 'occupied', search: 'Example',
    });
    expect(records.floorRecords).toHaveLength(1);
    expect(records.spaceRecords.map(r => r['租户 / 用途'])).toEqual(['Example']);
    expect(records.floorRecords[0]['已录入单元总面积(㎡)']).toBe(180);
    expect(records.floorRecords[0]['单元数(导出范围)']).toBe(1);
  });

  it('renders a 16:9 labeled SVG without fabricating verified current vacancy', () => {
    const result = createStackingPresentationSvg({
      ...common, onlyMatching: false,
    });
    expect(result).toContain('width="1920" height="1080"');
    expect(result).toContain('A 座');
    expect(result).toContain('B 座');
    expect(result).toContain('2026-11-18');
    expect(result).toContain('逐项未核验');
    expect(result).toContain('不代表正式销控');
  });

  it('labels a filtered PNG without claiming unrecorded area is vacant', () => {
    const filtered = createStackingPresentationSvg({
      ...common, onlyMatching: true, filter: 'occupied', search: '',
    });
    expect(filtered).toContain('仅显示筛选单元');
    expect(filtered).toContain('未展示');
    expect(filtered).toContain('不代表正式销控');
    const complete = createStackingPresentationSvg({
      ...common, onlyMatching: true, filter: 'all', search: '',
    });
    expect(complete).not.toContain('仅显示筛选单元');
    expect(complete).not.toContain('未展示');
  });

  it('rasterizes the executive SVG as a valid 16:9 PNG binary', async () => {
    const sharp = (await import('sharp')).default;
    const source = createStackingPresentationSvg({ ...common, onlyMatching: false });
    const { data, info } = await sharp(Buffer.from(source)).png().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(1920);
    expect(info.height).toBe(1080);
    expect(info.format).toBe('png');
    expect(data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('round-trips the production XLSX builder with rent numbers and source scope', async () => {
    const XLSX = await import('xlsx');
    const workbook = buildStackingWorkbook(XLSX, { ...common, scope: 'all' });
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    const decoded = XLSX.read(bytes, { type: 'buffer' });
    expect(decoded.SheetNames).toEqual([
      '楼层汇总', '空间租赁明细', '租金阶段明细', '口径与来源',
    ]);
    const steps = XLSX.utils.sheet_to_json<Record<string, string | number>>(
      decoded.Sheets['租金阶段明细'],
    );
    expect(steps.map(step => step['表面租金(元/㎡/月)'])).toEqual([330, 360]);
    expect(steps.every(step => typeof step['表面租金(元/㎡/月)'] === 'number')).toBe(true);
    expect(decoded.Sheets['空间租赁明细']['!autofilter']).toBeTruthy();
    const metadata = XLSX.utils.sheet_to_json<string[]>(
      decoded.Sheets['口径与来源'], { header: 1 },
    );
    expect(metadata).toContainEqual(['导出范围', '全部已建模单元']);
    expect(metadata.some(row => row[0] === '租金口径'
      && row[1].includes('不等于净有效租金'))).toBe(true);

    const filteredWorkbook = buildStackingWorkbook(XLSX, {
      ...common, scope: 'visible', filter: 'occupied', search: 'Example',
    });
    const filteredNotes = XLSX.utils.sheet_to_json<string[]>(
      filteredWorkbook.Sheets['口径与来源'], { header: 1 },
    );
    expect(filteredNotes.some(row => row[0] === '导出范围'
      && row[1].includes('当前筛选'))).toBe(true);
  });

  it('serializes the same workbook to an ArrayBuffer suitable for browser downloads', async () => {
    const XLSX = await import('xlsx');
    const workbook = buildStackingWorkbook(XLSX, { ...common, scope: 'all' });
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true }) as ArrayBuffer;
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    expect(blob.size).toBeGreaterThan(1000);
    const parsed = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
    expect(parsed.SheetNames).toContain('口径与来源');
  });

  it('escapes tenant names before building SVG markup', () => {
    const result = createStackingPresentationSvg({
      ...common,
      spaces: [{ ...spaces[0], tenant_name: '<script>bad</script>' }, ...spaces.slice(1)],
      onlyMatching: false,
    });
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });
});
