import { aggregateQuarter } from './analytics';
import type { FactSnapshot } from './contracts';
import { groupedQuarterAnalysis } from './grouping';

/** Two current-catalog dimensions, one quarterly snapshot. All cells use the
 * same authorized axes, including empty intersections; no cell-level reread. */
export function crossTabQuarter(selected: FactSnapshot, universe: FactSnapshot, metric: Parameters<typeof aggregateQuarter>[1]) {
  const regions = groupedQuarterAnalysis([selected], [universe], 'submarket', metric, 'per_period');
  const grades = groupedQuarterAnalysis([selected], [universe], 'grade', metric, 'per_period');
  if (regions.groups.length * grades.groups.length > 400) throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  const gradeOf = new Map(grades.groups.flatMap(group => group.entityIds.map(id => [id, group.key] as const)));
  const selectedIds = new Set(selected.rows.map(row => row.id));
  const rowsById = new Map(universe.rows.map(row => [row.id, row]));
  const cells = regions.groups.flatMap(region => grades.groups.map(grade => {
    const entityIds = region.entityIds.filter(id => gradeOf.get(id) === grade.key);
    const rows = entityIds.filter(id => selectedIds.has(id)).map(id => rowsById.get(id)!);
    return { key: `${region.key}/${grade.key}`, regionKey: region.key, gradeKey: grade.key, entityIds,
      membershipSourceIds: entityIds.flatMap(id => ['submarket', 'grade'].map(field => rowsById.get(id)!.dimensions![field as 'submarket' | 'grade']!.source.id)),
      analysis: aggregateQuarter({ ...selected, rows, expectedCount: rows.length }, metric) };
  }));
  const axis = (groups: typeof regions.groups) => groups.map(({ key, value, label, sourceIds }) => ({ key, value, label, sourceIds }));
  return { metric, membershipTime: 'current_catalog' as const, rows: axis(regions.groups), columns: axis(grades.groups), cells,
    membershipSources: [...regions.membershipSources, ...grades.membershipSources] };
}
