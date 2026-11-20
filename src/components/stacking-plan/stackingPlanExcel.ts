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
            '开始日期': step.start,
            '结束日期': step.end,
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
