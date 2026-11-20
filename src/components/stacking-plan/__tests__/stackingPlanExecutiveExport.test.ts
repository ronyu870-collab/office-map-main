import { describe, expect, it } from 'vitest';
import { buildStackingWorkbook, createStackingDiagramLayout, createStackingExcelRecords, type ExportableSpace } from '../stackingPlanExcel';
import { styleStackingWorkbook } from '../stackingPlanExcelStyles';
import JSZip from 'jszip';
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

  it('renders a dynamic high-resolution SVG with clean typography and no internal warnings', () => {
    const result = createStackingPresentationSvg({
      ...common, onlyMatching: false,
    });
    expect(result).toContain('width="2048"');
    expect(result).toMatch(/height="\d+" viewBox="0 0 2048 \d+"/);
    expect(result).toContain('Example · 180㎡');
    expect(result).toContain('A 座');
    expect(result).toContain('B 座');
    expect(result).toContain('2026-11-18');
    expect(result).not.toContain('逐项未核验');
    expect(result).not.toContain('不代表正式销控');
  });

  it('labels a filtered PNG without claiming unrecorded area is vacant', () => {
    const filtered = createStackingPresentationSvg({
      ...common, onlyMatching: true, filter: 'occupied', search: '',
    });
    expect(filtered).toContain('筛选结果');
    expect(filtered).not.toContain('未展示');
    const complete = createStackingPresentationSvg({
      ...common, onlyMatching: true, filter: 'all', search: '',
    });
    expect(complete).not.toContain('筛选结果');
    expect(complete).not.toContain('未展示');
  });

  it('rasterizes the vector diagram as a valid PNG binary', async () => {
    const sharp = (await import('sharp')).default;
    const source = createStackingPresentationSvg({ ...common, onlyMatching: false });
    const { data, info } = await sharp(Buffer.from(source)).png().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(2048);
    expect(info.height).toBeGreaterThan(350);
    expect(info.format).toBe('png');
    expect(data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('round-trips the production XLSX builder with rent numbers and source scope', async () => {
    const XLSX = await import('xlsx');
    const workbook = buildStackingWorkbook(XLSX, { ...common, scope: 'all' });
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    const decoded = XLSX.read(bytes, { type: 'buffer' });
    expect(decoded.SheetNames).toEqual([
      '楼宇租赁堆叠图', '楼层汇总', '空间租赁明细', '租金阶段明细', '口径与来源',
    ]);
    const steps = XLSX.utils.sheet_to_json<Record<string, string | number>>(
      decoded.Sheets['租金阶段明细'],
    );
    expect(steps.map(step => step['表面租金(元/㎡/月)'])).toEqual([330, 360]);
    expect(steps.every(step => typeof step['表面租金(元/㎡/月)'] === 'number')).toBe(true);
    expect(decoded.Sheets['空间租赁明细']['!autofilter']).toBeTruthy();
    expect(decoded.Sheets['楼宇租赁堆叠图']['!merges']?.length).toBeGreaterThan(4);
    const editableDiagram = XLSX.utils.sheet_to_json<(string | number)[]>(
      decoded.Sheets['楼宇租赁堆叠图'], { header: 1 });
    expect(JSON.stringify(editableDiagram)).toContain('Example · 180㎡');
    expect(JSON.stringify(editableDiagram)).toContain('空置 · 200㎡');
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
    const parsed = XLSX.read(new Uint8Array(bytes), { type: 'array' });
    expect(parsed.SheetNames).toContain('口径与来源');
  });



  it('merges adjacent fully occupied floors of the same named tenant without losing individual floor areas', () => {
    const input = {
      ...common, scope: 'all' as const,
      floors: [
        floors[0],
        { ...floors[0], id: 'floor-a4', floor_code: '4', level_order: 4 },
        floors[1],
      ],
      spaces: [
        { ...spaces[0], area_sqm: 300 },
        { ...spaces[0], id: 'a-floor4', floor_id: 'floor-a4', area_sqm: 300 },
        spaces[2],
      ],
    };
    const diagram = createStackingDiagramLayout(input);
    const spanning = diagram.merges.find(m => m.s.r === 5 && m.e.r === 6
      && m.s.c === 3 && m.e.c === 26);
    expect(spanning).toBeTruthy();
    expect(diagram.rows[5][3]).toContain('600㎡');
    expect(diagram.rows[6][3]).toBeNull();
    expect(diagram.rows[5][2]).toBe(300);
    expect(diagram.rows[6][2]).toBe(300);
  });

  it('produces styled native Excel cells with no embedded screenshot and two editable towers', async () => {
    const XLSX = await import('xlsx');
    const input = { ...common, scope: 'all' as const };
    const wb = buildStackingWorkbook(XLSX, input);
    const layout = createStackingDiagramLayout(input);
    const original = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true }) as ArrayBuffer;
    const final = await styleStackingWorkbook(original, layout.styles);
    const archive = await JSZip.loadAsync(final);
    const xml = await archive.file('xl/worksheets/sheet1.xml')?.async('string');
    const styles = await archive.file('xl/styles.xml')?.async('string');
    expect(xml).toContain(' s="5"');
    expect(xml).toContain(' s="6"');
    expect(xml).toContain('pageSetup');
    expect(styles).toContain('DCEAF4');
    expect(Object.keys(archive.files).some(file => file.includes('/media/'))).toBe(false);
    const decoded = XLSX.read(new Uint8Array(final), { type: 'array' });
    expect(decoded.SheetNames[0]).toBe('楼宇租赁堆叠图');
    expect(decoded.Sheets['楼宇租赁堆叠图']['!merges']?.length).toBeGreaterThan(0);
    expect(JSON.stringify(XLSX.utils.sheet_to_json(decoded.Sheets['楼宇租赁堆叠图'], { header: 1 })))
      .toContain('Example · 180㎡');
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
