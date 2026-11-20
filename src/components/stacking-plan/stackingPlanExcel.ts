import {
  areaCheck, areaNumber, selectFloorRows,
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
 * Single workbook constructor used by the actual download path and binary tests.
 * This keeps filters, source disclosure and spreadsheet structure in one place.
 */
export function buildStackingWorkbook<S extends ExportableSpace>(
  XLSX: typeof import('xlsx'),
  input: ExportInput<S>,
) {
  const records = createStackingExcelRecords(input);
  const workbook = XLSX.utils.book_new();
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
