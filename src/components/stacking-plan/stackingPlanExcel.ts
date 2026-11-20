import {
  areaCheck, areaNumber, selectFloorRows, unitLayout,
  type PlanFloor, type PlanSpace, type SpaceFilter,
} from './stackingPlanModel';

export type StackingRentStep = {
  start: string | null;
  end: string | null;
  face_rent_monthly?: number | null;
  monthly_total_rent?: number | null;
  area_sqm?: number | null;
  unit?: string;
};
export type ExportableSpace = PlanSpace & {
  lease_steps: StackingRentStep[];
  notes: string;
};
export type ExportableTower = { id: string; code: string; display_name: string };

type ExportInput<S extends ExportableSpace> = {
  projectName: string;
  towers: ExportableTower[];
  floors: PlanFloor[];
  spaces: S[];
  sourceDate: string | null;
  sourceTitle: string;
  originalArchived: boolean;
  scope: 'visible' | 'all';
  filter: SpaceFilter;
  search: string;
};

const protect = (value: string | null | undefined) => {
  const v = value ?? '';
  return /^\s*[=+\-@]/.test(v) ? "'" + v : v;
};
const num = (value: number | string | null | undefined) => areaNumber(value);
const sumArea = (spaces: PlanSpace[], status: PlanSpace['occupancy_status']) =>
  spaces.filter(s => s.occupancy_status === status)
    .reduce((sum, s) => sum + (num(s.area_sqm) ?? 0), 0);

/** SheetJS-compatible, source-labelled records. Each rent step stays in its own row. */
export function createStackingExcelRecords<S extends ExportableSpace>(input: ExportInput<S>) {
  const floorRecords: Record<string, string | number | null>[] = [];
  const spaceRecords: Record<string, string | number | null>[] = [];
  const rentRecords: Record<string, string | number | null>[] = [];
  const date = input.sourceDate ?? '未知';
  const origin = protect(input.sourceTitle);
  const archive = input.originalArchived ? '已归档' : '未归档';
  for (const tower of input.towers) {
    const towerFloors = input.floors.filter(f => f.tower_id === tower.id);
    const ids = new Set(towerFloors.map(f => f.id));
    const towerSpaces = input.spaces.filter(s => ids.has(s.floor_id));
    const rows = selectFloorRows(
      towerFloors, towerSpaces,
      input.scope === 'all' ? 'all' : input.filter,
      input.scope === 'all' ? '' : input.search,
    );
    for (const { floor, spaces } of rows) {
      const complete = towerSpaces.filter(s => s.floor_id === floor.id);
      const check = areaCheck(floor, complete);
      const base = {
        '项目': protect(input.projectName),
        '楼座': protect(tower.display_name),
        '楼层': protect(floor.floor_code),
        '楼层用途': protect(floor.use_type),
        '数据截至': date,
        '来源': origin,
      };
      floorRecords.push({
        ...base,
        '楼层参考面积(㎡)': num(floor.floor_area_sqm),
        '已录入单元总面积(㎡)': check.recorded,
        '本次导出单元面积(㎡)': spaces.reduce((sum, s) => sum + (num(s.area_sqm) ?? 0), 0),
        '完整来源已租面积(㎡)': sumArea(complete, 'occupied'),
        '完整来源空置面积(㎡)': sumArea(complete, 'vacant'),
        '面积待核差额(㎡)': check.gap,
        '超额面积(㎡)': check.overallocated || null,
        '面积未知单元数': check.missingUnitAreas,
        '单元数(导出范围)': spaces.length,
      });
      for (const space of spaces) {
        const shared = {
          ...base, '单元': protect(space.unit_code),
          '租户 / 用途': protect(space.tenant_name),
          '单元面积(㎡)': num(space.area_sqm),
          '来源标注状态': {
            occupied: '已租', vacant: '空置', other: '其他用途', unknown: '待确认',
          }[space.occupancy_status],
          '核验状态': space.verification_status === 'verified' ? '已核验' : '未逐项核验',
        };
        spaceRecords.push({
          ...shared,
          '租金阶段数': space.lease_steps?.length ?? 0,
          '原始文件': archive,
          '备注': protect(space.notes),
        });
        for (const [index, step] of (space.lease_steps ?? []).entries()) {
          rentRecords.push({
            ...shared,
            '租金阶段': index + 1,
            '开始日期': step.start === null ? null : protect(step.start),
            '结束日期': step.end === null ? null : protect(step.end),
            '表面租金(元/㎡/月)': num(step.face_rent_monthly),
            '月总租金(元/月)': num(step.monthly_total_rent),
            '阶段面积(㎡)': num(step.area_sqm),
            '原图计价单位': protect(step.unit),
          });
        }
      }
    }
  }
  return { floorRecords, spaceRecords, rentRecords };
}



/**
 * A native editable double-tower diagram, rather than a flattened record table
 * or an embedded screenshot. Each occupied segment is an Excel merged cell.
 * Unknown / uncovered floor area is kept neutral and is NEVER called vacant.
 */
export const STACKING_DIAGRAM_COLUMNS = 24;
export type StackingDiagramLayout = {
  rows: (string | number | null)[][];
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[];
  styles: Record<string, number>;
  heights: number[];
  widths: number[];
};

const diagramColumn = (index: number) => {
  let n = index + 1;
  let result = '';
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(65 + n % 26) + result;
    n = Math.floor(n / 26);
  }
  return result;
};

const diagramRef = (row: number, column: number) =>
  diagramColumn(column) + String(row + 1);

const diagramName = (space: PlanSpace) => space.tenant_name?.trim()
  || (space.occupancy_status === 'vacant' ? '空置'
    : space.occupancy_status === 'other' ? '其他用途'
      : space.occupancy_status === 'unknown' ? '待确认' : space.unit_code);

const diagramArea = (value: number | string | null | undefined) => {
  const area = num(value);
  return area === null ? '—' : area.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + '㎡';
};

/** Allocate at least one visible cell per recorded unit; remaining cells are proportional. */
function diagramWidths(weights: number[], capacity: number): number[] {
  if (!weights.length) return [];
  if (weights.length >= capacity) return weights.map((_, i) => i < capacity ? 1 : 0);
  const valid = weights.map(w => Math.max(w, 0.001));
  const sum = valid.reduce((a, b) => a + b, 0);
  const remaining = capacity - valid.length;
  const shares = valid.map(w => remaining * w / sum);
  const widths = shares.map(v => 1 + Math.floor(v));
  let extra = capacity - widths.reduce((a, b) => a + b, 0);
  shares.map((v, i) => ({ i, fraction: v - Math.floor(v) }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i)
    .forEach(item => { if (extra > 0) { widths[item.i] += 1; extra -= 1; } });
  return widths;
}

export function createStackingDiagramLayout<S extends ExportableSpace>(
  input: ExportInput<S>,
): StackingDiagramLayout {
  const left = { floor: 1, area: 2, first: 3 };
  const right = { floor: 28, area: 29, first: 30 };
  const columns = 54;
  const towerRows = input.towers.slice(0, 2).map(tower => {
    const local = input.floors.filter(f => f.tower_id === tower.id);
    const floorIds = new Set(local.map(f => f.id));
    const localUnits = input.spaces.filter(s => floorIds.has(s.floor_id));
    const matched = selectFloorRows(local, localUnits,
      input.scope === 'all' ? 'all' : input.filter,
      input.scope === 'all' ? '' : input.search);
    const ids = new Set(matched.flatMap(item => item.spaces.map(space => space.id)));
    return { tower, floors: [...local].sort((a, b) => b.level_order - a.level_order),
      units: localUnits, visible: ids };
  });
  const height = Math.max(1, ...towerRows.map(t => t.floors.length));
  const rows: (string | number | null)[][] = Array.from({ length: height + 9 },
    () => Array.from({ length: columns }, () => null));
  const heights = rows.map(() => 27);
  const widths = Array.from({ length: columns }, () => 4.25);
  const merges: StackingDiagramLayout['merges'] = [];
  const styles: Record<string, number> = {};
  heights[0] = 32;
  heights[1] = 14;
  heights[2] = 21;
  heights[3] = 29;
  heights[4] = 28;
  widths[0] = 3;
  widths[27] = 4;
  for (const pos of [left, right]) {
    widths[pos.floor] = 8;
    widths[pos.area] = 14;
  }
  const place = (row: number, start: number, end: number, value: string | number | null, style: number) => {
    rows[row][start] = value;
    for (let c = start; c <= end; c++) styles[diagramRef(row, c)] = style;
    if (end > start) merges.push({ s: { r: row, c: start }, e: { r: row, c: end } });
  };
  place(0, 1, columns - 1, protect(input.projectName) + '  ·  Stacking Plan', 1);
  place(2, 1, columns - 1, input.towers.map(t => protect(t.display_name)).join('  /  ') + '  ·  租赁堆叠图', 2);
  towerRows.forEach((group, index) => {
    const pos = index === 0 ? left : right;
    const end = pos.first + STACKING_DIAGRAM_COLUMNS - 1;
    place(3, pos.floor, end, protect(group.tower.display_name), 2);
    place(4, pos.floor, pos.floor, '楼层', 3);
    place(4, pos.area, pos.area, '建筑面积（㎡）', 3);
    place(4, pos.first, end, '租户 / 单元面积', 3);
    for (const [floorIndex, floor] of group.floors.entries()) {
      const row = 5 + floorIndex;
      heights[row] = Math.max(heights[row], 32);
      place(row, pos.floor, pos.floor,
        protect(floor.floor_code.startsWith('B') ? floor.floor_code : floor.floor_code + 'F'), 4);
      place(row, pos.area, pos.area, num(floor.floor_area_sqm), 10);
      const fullUnits = group.units.filter(s => s.floor_id === floor.id);
      const shown = fullUnits.filter(s => group.visible.has(s.id));
      if (!shown.length) {
        place(row, pos.first, end, '', 9);
        continue;
      }
      const layout = unitLayout(floor, shown, input.scope === 'visible');
      const parts = shown.map(s => ({ space: s, weight: layout.items.find(item => item.id === s.id)?.weight ?? 1 }));
      const remaining = layout.residual > 0.1 ? [{ space: null, weight: layout.residual }] : [];
      const allParts: { space: S | null; weight: number }[] = [...parts, ...remaining];
      const allocations = diagramWidths(allParts.map(p => p.weight), STACKING_DIAGRAM_COLUMNS);
      let col = pos.first;
      for (let k = 0; k < allParts.length && col <= end; k++) {
        const part = allParts[k];
        const width = allocations[k];
        if (!width) continue;
        if (!part.space) {
          place(row, col, Math.min(end, col + width - 1), '', 9);
        } else {
          const statusStyle = {
            occupied: 5, vacant: 6, other: 7, unknown: 8,
          }[part.space.occupancy_status];
          place(row, col, Math.min(end, col + width - 1),
            protect(diagramName(part.space) + ' · ' + diagramArea(part.space.area_sqm)), statusStyle);
        }
        col += width;
      }
      if (col <= end) place(row, col, end, '', 9);
    }
    // Merge only consecutive, confidently full-floor same-name labels.
    // This groups the picture, not the legal lease identity or underlying rows.
    const fullFloorTenant = (floor: PlanFloor) => {
      const units = group.units.filter(unit => unit.floor_id === floor.id
        && group.visible.has(unit.id));
      if (units.length !== 1) return null;
      const tenant = units[0];
      const area = num(tenant.area_sqm);
      const reference = num(floor.floor_area_sqm);
      if (tenant.occupancy_status !== 'occupied' || !tenant.tenant_name?.trim()
        || area === null || reference === null || Math.abs(area - reference) > 0.5) return null;
      return { name: tenant.tenant_name.trim(), area, level: floor.level_order };
    };
    for (let i = 0; i < group.floors.length;) {
      const first = fullFloorTenant(group.floors[i]);
      if (!first) { i += 1; continue; }
      let endIndex = i + 1;
      let totalArea = first.area;
      let previousLevel = first.level;
      while (endIndex < group.floors.length) {
        const next = fullFloorTenant(group.floors[endIndex]);
        if (!next || next.name.toLocaleLowerCase() !== first.name.toLocaleLowerCase()
          || next.level !== previousLevel - 1) break;
        totalArea += next.area;
        previousLevel = next.level;
        endIndex += 1;
      }
      if (endIndex - i > 1) {
        const firstRow = 5 + i;
        const lastRow = 5 + endIndex - 1;
        for (let k = merges.length - 1; k >= 0; k--) {
          const m = merges[k];
          if (m.s.r >= firstRow && m.e.r <= lastRow
            && m.s.c >= pos.first && m.e.c <= end) merges.splice(k, 1);
        }
        rows[firstRow][pos.first] = protect(first.name + ' · ' +
          totalArea.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + '㎡');
        for (let k = firstRow + 1; k <= lastRow; k++) rows[k][pos.first] = null;
        merges.push({ s: { r: firstRow, c: pos.first }, e: { r: lastRow, c: end } });
      }
      i = endIndex;
    }
  });
  const legendRow = height + 6;
  heights[legendRow] = 26;
  place(legendRow, 1, 4, '已租', 5);
  place(legendRow, 5, 8, '空置', 6);
  place(legendRow, 9, 13, '其他用途', 7);
  place(legendRow, 14, 18, '待确认', 8);
  return { rows, merges, styles, heights, widths };
}

/**
 * Single workbook constructor used by the actual download path and binary tests.
 * This keeps filters, source disclosure and spreadsheet structure in one place.
 */
export function buildStackingWorkbook<S extends ExportableSpace>(
  XLSX: typeof import('xlsx'),
  input: ExportInput<S>,
) {
  const records = createStackingExcelRecords(input);
  const workbook = XLSX.utils.book_new();
  const diagram = createStackingDiagramLayout(input);
  const diagramSheet = XLSX.utils.aoa_to_sheet(diagram.rows);
  diagramSheet['!merges'] = diagram.merges;
  diagramSheet['!cols'] = diagram.widths.map(wch => ({ wch }));
  diagramSheet['!rows'] = diagram.heights.map(hpt => ({ hpt }));
  XLSX.utils.book_append_sheet(workbook, diagramSheet, '楼宇租赁堆叠图');

  const addSheet = (
    rows: Record<string, string | number | null>[],
    name: string,
    headers: string[],
  ) => {
    const sheet = rows.length ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([headers]);
    const columns = rows.length ? Object.keys(rows[0]) : headers;
    sheet['!cols'] = columns.map(key => ({
      wch: Math.min(42, Math.max(14, key.length * 1.8)),
    }));
    if (rows.length && sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  };
  addSheet(records.floorRecords, '楼层汇总', ['项目', '楼座', '楼层', '楼层用途']);
  addSheet(records.spaceRecords, '空间租赁明细', ['项目', '楼座', '楼层', '单元', '租户 / 用途']);
  addSheet(records.rentRecords, '租金阶段明细',
    ['项目', '楼座', '楼层', '单元', '租金阶段', '开始日期', '结束日期',
      '表面租金(元/㎡/月)', '月总租金(元/月)']);
  const label = {
    all: '全部状态', occupied: '已租', vacant: '空置',
    other: '其他用途', unknown: '待确认',
  }[input.filter];
  const scopeDescription = input.scope === 'all' ? '全部已建模单元'
    : '当前筛选（状态：' + label + '；搜索：' + (input.search.trim() || '无') + '）';
  const metadata = XLSX.utils.aoa_to_sheet([
    ['项目说明', '具体内容'],
    ['项目', protect(input.projectName)],
    ['楼座', input.towers.map(t => protect(t.display_name)).join('、')],
    ['来源资料截至日期', input.sourceDate ?? '未知'],
    ['来源资料标题', protect(input.sourceTitle)],
    ['导出范围', protect(scopeDescription)],
    ['核验状态', '数据来自原始水牌快照，租户、租期、状态与面积未完成逐项核验'],
    ['空置与面积', '标注空置不代表可立即出租；未知面积、楼层差额不得直接推定为空置'],
    ['租金口径', '原图表面月租金与月总租金分别列示，均不等于净有效租金'],
    ['原始文件', input.originalArchived ? '已私有归档' : '尚未归档'],
  ]);
  metadata['!cols'] = [{ wch: 27 }, { wch: 92 }];
  XLSX.utils.book_append_sheet(workbook, metadata, '口径与来源');
  return workbook;
}
