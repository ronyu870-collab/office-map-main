import { aggregateQuarter, quarterSeries } from './analytics';
import type { FactSnapshot } from './contracts';
import { catalogGroupMemberships } from './grouping';
import { CROSS_TREND_LIMITS } from './plan';

/** Establish both axes from the same authorized pre-filter universe. Each
 * dimension validates provenance and unchanged current-catalog membership in
 * every quarter before any cell calculation. Empty intersections stay present. */
export function crossTabMemberships(selected: readonly FactSnapshot[], universe: readonly FactSnapshot[], maxCells = 400) {
  const regions = catalogGroupMemberships(selected, universe, 'submarket');
  const grades = catalogGroupMemberships(selected, universe, 'grade');
  if (regions.groups.length * grades.groups.length > maxCells) throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  const gradeOf = new Map(grades.groups.flatMap(group => group.entityIds.map(id => [id, group.key] as const)));
  const rowsById = new Map(universe[0].rows.map(row => [row.id, row]));
  const cells = regions.groups.flatMap(region => grades.groups.map(grade => {
    const entityIds = region.entityIds.filter(id => gradeOf.get(id) === grade.key);
    return { key: `${region.key}/${grade.key}`, regionKey: region.key, gradeKey: grade.key, entityIds,
      membershipSourceIds: entityIds.flatMap(id => ['submarket', 'grade'].map(field => rowsById.get(id)!.dimensions![field as 'submarket' | 'grade']!.source.id)) };
  }));
  const axis = (groups: typeof regions.groups) => groups.map(({ key, value, label, sourceIds }) => ({ key, value, label, sourceIds }));
  return { membershipTime: 'current_catalog' as const, rows: axis(regions.groups), columns: axis(grades.groups), cells,
    membershipSources: [...regions.membershipSources, ...grades.membershipSources] };
}

/** Two current-catalog dimensions, one quarterly snapshot. All cells use the
 * same authorized axes, including empty intersections; no cell-level reread. */
export function crossTabQuarter(selected: FactSnapshot, universe: FactSnapshot, metric: Parameters<typeof aggregateQuarter>[1]) {
  const membership = crossTabMemberships([selected], [universe]);
  const selectedIds = new Set(selected.rows.map(row => row.id));
  const rowsById = new Map(universe.rows.map(row => [row.id, row]));
  const cells = membership.cells.map(cell => {
    const rows = cell.entityIds.filter(id => selectedIds.has(id)).map(id => rowsById.get(id)!);
    return { ...cell, analysis: aggregateQuarter({ ...selected, rows, expectedCount: rows.length }, metric) };
  });
  return { metric, ...membership, cells };
}

/** One quarterSeries per fixed intersection: no mean of cell means and no
 * cross-metric joint cohort. Pairing is the full requested-period intersection
 * after filtering and metric validity, exactly as existing grouped trends. */
export function crossTabTrend(selected: readonly FactSnapshot[], universe: readonly FactSnapshot[],
  metric: Parameters<typeof quarterSeries>[1], mode: 'per_period' | 'paired', metricCount = 1) {
  if (selected.length < 2 || selected.length > 40 || !Number.isInteger(metricCount) || metricCount < 1 || metricCount > 3) throw new Error('INVALID_CROSS_TREND');
  const membership = crossTabMemberships(selected, universe, CROSS_TREND_LIMITS.groups);
  if (membership.cells.length * selected.length * metricCount > CROSS_TREND_LIMITS.metricPoints) throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  const cells = membership.cells.map(cell => {
    const ids = new Set(cell.entityIds);
    const snapshots = selected.map(snapshot => {
      const rows = snapshot.rows.filter(row => ids.has(row.id));
      return { ...snapshot, rows, expectedCount: rows.length };
    });
    return { ...cell, analysis: quarterSeries(snapshots, metric, mode) };
  });
  return { metric, mode, ...membership, cells };
}
