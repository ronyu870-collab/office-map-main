import { describe, expect, it } from 'vitest';
import {
  areaCheck, matchingTenant, selectFloorRows, summarizePlan,
  uncoveredFloorLabels, unitLayout, type PlanFloor, type PlanSpace,
} from '../stackingPlanModel';

const floor = (id: string, code: string, area: number, order: number): PlanFloor => ({
  id, tower_id: 'A', floor_code: code, level_order: order,
  floor_area_sqm: area, zone: '办公', use_type: 'office',
});
const unit = (
  id: string, floorId: string, status: PlanSpace['occupancy_status'],
  area: number | null, tenant: string | null,
): PlanSpace => ({
  id, floor_id: floorId, unit_code: id, occupancy_status: status,
  area_sqm: area, tenant_name: tenant, verification_status: 'source_unverified',
});

describe('Stacking Plan P0 projection and data integrity', () => {
  const floors = [floor('f3','3',1700,3), floor('f1','1',1700,1)];
  const units = [
    unit('a','f3','occupied',700,'奥迪'),
    unit('b','f3','vacant',600,null),
    unit('c','f1','occupied',1700,'奥迪'),
  ];

  it('uses exactly the same unit projection for the current view and export', () => {
    const vacant = selectFloorRows(floors, units, 'vacant', '');
    expect(vacant.map(r => r.floor.floor_code)).toEqual(['3']);
    expect(vacant.flatMap(r => r.spaces.map(s => s.id))).toEqual(['b']);
    const all = selectFloorRows(floors, units, 'all', '');
    expect(all.flatMap(r => r.spaces.map(s => s.id))).toEqual(['a','b','c']);
    expect(selectFloorRows(floors, units, 'all', '奥迪').flatMap(r => r.spaces.map(s => s.id)))
      .toEqual(['a','c']);
    expect(selectFloorRows(floors, units, 'occupied', '1F').flatMap(r => r.spaces.map(s => s.id)))
      .toEqual(['c']);
  });

  it('does not count unassigned or unknown area as vacant and warns on over-allocation', () => {
    const partial = areaCheck(floors[0], units.filter(s => s.floor_id === 'f3'));
    expect(partial.recorded).toBe(1300);
    expect(partial.gap).toBe(400);
    expect(partial.overallocated).toBe(0);
    const incomplete = areaCheck(floors[0], [unit('x','f3','unknown',null,null)]);
    expect(incomplete.missingUnitAreas).toBe(1);
    expect(incomplete.gap).toBe(1700);
    const overlap = areaCheck(floors[0], [unit('y','f3','occupied',2000,'租户')]);
    expect(overlap.overallocated).toBe(300);
    expect(overlap.isBalanced).toBe(false);
    const summary = summarizePlan(floors, units);
    expect(summary.vacantArea).toBe(600);
    expect(summary.officeUnassignedArea).toBe(400);
    expect(summary.verifiedUnits).toBe(0);
    expect(summary.allUnits).toBe(3);
    expect(summary.areaConflicts).toBe(0);
  });

  it('preserves spatial context under filters and marks the hidden remainder rather than repainting a full floor', () => {
    const filtered = selectFloorRows(floors, units, 'vacant', '')[0];
    const weights = unitLayout(filtered.floor, filtered.spaces, true);
    expect(weights.residual).toBe(1100);
    expect(weights.residualLabel).toBe('其他未展示面积');
    expect(weights.items.map(x => x.id)).toEqual(['b']);
    const unfiltered = unitLayout(floors[0],units.filter(s=>s.floor_id==='f3'),false);
    expect(unfiltered.residual).toBe(400);
    expect(unfiltered.residualLabel).toBe('面积未覆盖 / 待核');
  });

  it('labels missing floor numbers as source-coverage questions without fabricating records', () => {
    expect(uncoveredFloorLabels(floors)).toEqual(['2F']);
    expect(selectFloorRows(floors, units, 'all', '')).toHaveLength(2);
    expect(uncoveredFloorLabels([{ ...floors[0], floor_code:'B1',level_order:-1 }])).toEqual([]);
  });

  it('highlights only exact source names, not fuzzy tenant identities', () => {
    const selected = units[0];
    expect(matchingTenant(selected,units[2])).toBe(true);
    expect(matchingTenant(selected,unit('d','f1','occupied',50,'奥迪中国'))).toBe(false);
    expect(matchingTenant(selected,unit('e','f1','vacant',50,'奥迪'))).toBe(false);
  });
});
