'use client';

import { ChevronRight } from 'lucide-react';
import {
  areaNumber, selectFloorRows, summarizePlan, unitLayout,
  type PlanFloor, type PlanSpace, type SpaceFilter,
} from './stackingPlanModel';
import styles from './StackingPlanWorkspace.module.css';

type Tower = { id: string; code: string; display_name: string };
type Props<S extends PlanSpace> = {
  towers: Tower[];
  floors: PlanFloor[];
  spaces: S[];
  filter: SpaceFilter;
  search: string;
  onOpen: (space: S, towerCode: string) => void;
  onOpenTower: (code: string) => void;
  onClear: () => void;
};

const fmt = (value: number | string | null | undefined) => {
  const n = areaNumber(value);
  return n === null ? '—' : n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
};
const displayName = (unit: PlanSpace) => unit.tenant_name ||
  (unit.occupancy_status === 'vacant' ? '空置' :
    unit.occupancy_status === 'unknown' ? '待确认' : unit.unit_code);

export function StackingPlanOverview<S extends PlanSpace>({
  towers, floors, spaces, filter, search, onOpen, onOpenTower, onClear,
}: Props<S>) {
  const filtered = filter !== 'all' || search.trim().length > 0;
  return <section className={styles.overview} aria-label="双楼租赁总览">
    <div className={styles.overviewHeader}>
      <div>
        <h2>楼层租赁总览</h2>
        <p>点击楼层色块查看单元详情；筛选未命中的单元以浅色保留楼宇结构。</p>
      </div>
      {filtered && <button type="button" className={styles.clearFilter} onClick={onClear}>清除筛选</button>}
    </div>
    <div className={styles.overviewGrid}>
      {towers.map(t => {
        const towerFloors = floors.filter(f => f.tower_id === t.id)
          .sort((a, b) => b.level_order - a.level_order);
        const floorIds = new Set(towerFloors.map(f => f.id));
        const units = spaces.filter(s => floorIds.has(s.floor_id));
        const summary = summarizePlan(towerFloors, units);
        const matches = selectFloorRows(towerFloors, units, filter, search);
        const matchingIds = new Set(matches.flatMap(row => row.spaces.map(s => s.id)));
        return <article key={t.id} className={styles.towerOverview}>
          <div className={styles.towerOverviewHead}>
            <div>
              <h3>{t.display_name}</h3>
              <p>{summary.officeFloors} 个办公楼层 · {units.length} 个来源单元</p>
            </div>
            <button type="button" onClick={() => onOpenTower(t.code)}>
              查看详情 <ChevronRight size={16}/>
            </button>
          </div>
          <div className={styles.towerOverviewFacts}>
            <span>来源已租 <strong>{fmt(summary.occupiedArea)}㎡</strong></span>
            <span>来源空置 <strong>{fmt(summary.vacantArea)}㎡</strong></span>
          </div>
          <div className={styles.miniBuilding}>
            {towerFloors.map(floor => {
              const floorUnits = units.filter(s => s.floor_id === floor.id);
              const layout = unitLayout(floor, floorUnits, false);
              return <div key={floor.id} className={styles.miniFloor}>
                <span className={styles.miniLevel}>
                  {floor.floor_code.startsWith('B') ? floor.floor_code : floor.floor_code + 'F'}
                </span>
                <div className={styles.miniUnits}>
                  {floorUnits.map(unit => {
                    const weight = layout.items.find(item => item.id === unit.id)?.weight ?? 1;
                    return <button key={unit.id} type="button"
                      className={[styles.miniUnit, styles[unit.occupancy_status],
                        filtered && !matchingIds.has(unit.id) ? styles.miniMuted : ''].filter(Boolean).join(' ')}
                      style={{ flexGrow: weight, flexBasis: 0 }}
                      title={displayName(unit) + ' · ' + fmt(unit.area_sqm) + '㎡'}
                      aria-label={t.display_name + ' ' + floor.floor_code + '层 ' + displayName(unit)}
                      onClick={() => onOpen(unit, t.code)}>
                      <span>{displayName(unit)}</span>
                    </button>;
                  })}
                  {layout.residual > 0.1 && <div className={styles.miniRemainder}
                    style={{ flexGrow: layout.residual, flexBasis: 0 }}
                    title={layout.residualLabel ?? '面积未覆盖'} />}
                  {!floorUnits.length && <span className={styles.miniEmpty}>暂无单元记录</span>}
                </div>
                <span className={styles.miniArea}>{fmt(floor.floor_area_sqm)}㎡</span>
              </div>;
            })}
          </div>
        </article>;
      })}
    </div>
    <div className={styles.overviewLegend}>
      <span><i className={styles.occupied}/>已租</span>
      <span><i className={styles.vacant}/>空置</span>
      <span><i className={styles.other}/>其他用途</span>
      <span><i className={styles.unknown}/>待确认</span>
      <span className={styles.legendNote}>状态及面积来自来源快照；未记录面积不代表空置</span>
    </div>
  </section>;
}
