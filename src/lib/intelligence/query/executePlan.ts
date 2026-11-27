import { assertComplete, quarterKey, type FactSnapshot } from './contracts';
import { assertFieldContext, evaluatePredicate, predicateFields, predicateInputFields } from './facts';
import { parseQueryPlan, planMetrics, planOutputFields, planPeriods } from './plan';
import { attachExecutedPlan, attachFilterEvidence, buildDistributionResult, buildRelationshipResult, buildCrossTabResult, buildCrossTrendResult, buildGroupedResult, buildTrendResult, buildAggregateResult, buildCompareResult, buildListResult, buildRankResult, type QueryResult } from './result';
import type { NumericField } from './registry';
import { attachResearchAnalysis } from './researchAnalysis';
import { assertMultiMetricResultSize, combineMetricResults } from './multiMetric';
import type { AggregateMetric } from './analytics';

/** Execute only against server-read snapshots, never client-provided rows.
 * This layer neither fetches latest data nor accepts model-supplied numbers. */
export function executeQueryPlan(input: unknown, snapshots: readonly FactSnapshot[]): QueryResult {
  const plan = parseQueryPlan(input);
  const periods = planPeriods(plan);
  const key = (period: FactSnapshot['period']) => period ? quarterKey(period) : 'catalog';
  const required = new Set(periods.map(key));
  if (snapshots.length !== required.size || new Set(snapshots.map(snapshot => key(snapshot.period))).size !== required.size
    || snapshots.some(snapshot => !required.has(key(snapshot.period)))) throw new Error('QUERY_SNAPSHOT_PERIOD_MISMATCH');
  for (const snapshot of snapshots) assertComplete(snapshot);
  if (new Set(snapshots.map(snapshot => snapshot.dataVersion)).size !== 1 || new Set(snapshots.map(snapshot => snapshot.scopeFingerprint)).size !== 1) throw new Error('QUERY_SNAPSHOT_VERSION_MISMATCH');
  // A compare read has one authorized current-catalog universe for both periods.
  // Missing quarterly facts remain rows; a source must not silently drop them.
  const universe = snapshots[0].rows.map(row => row.id).sort().join(',');
  if (snapshots.some(snapshot => snapshot.rows.map(row => row.id).sort().join(',') !== universe)) throw new Error('QUERY_SNAPSHOT_UNIVERSE_MISMATCH');
  const filterFields = predicateInputFields(plan.filter);
  const requiredFields = new Set<NumericField>([...planOutputFields(plan), ...filterFields]);
  const filterInputs = predicateFields(plan.filter);
  for (const snapshot of snapshots) {
    const scope = snapshot.queryScope;
    if (!scope || scope.inventory !== plan.scope.inventory
      || JSON.stringify(scope.submarkets ?? null) !== JSON.stringify(plan.scope.submarkets ?? null)
      || JSON.stringify(scope.buildingIds ?? null) !== JSON.stringify(plan.scope.buildingIds ?? null)
      || JSON.stringify(scope.filter ?? null) !== JSON.stringify(plan.filter ?? null)
      || JSON.stringify(scope.requestedFields) !== JSON.stringify([...requiredFields].sort())) throw new Error('QUERY_SNAPSHOT_PLAN_MISMATCH');
  }
  const evidence = snapshots.map(snapshot => {
    assertFieldContext(snapshot, [...filterFields]);
    return { snapshot, fields: filterFields, includeCatalogDimensions: filterInputs.includes('grade'), decisions: snapshot.rows.map(row => ({ entityId: row.id, state: plan.filter ? evaluatePredicate(row, plan.filter) : 'true' as const })) };
  });
  const selected = evidence.map(item => {
    const matching = new Set(item.decisions.filter(row => row.state === 'true').map(row => row.entityId));
    const rows = item.snapshot.rows.filter(row => matching.has(row.id));
    return { ...item.snapshot, rows, expectedCount: rows.length };
  });
  const find = (period: FactSnapshot['period']) => selected.find(snapshot => key(snapshot.period) === key(period))!;
  const metrics = planMetrics(plan);
  const build = (metric: AggregateMetric = 'rent') => plan.operation === 'distribution' ? buildDistributionResult(find(plan.period), plan.measure)
    : plan.operation === 'relationship' ? buildRelationshipResult(find(plan.period))
    : plan.operation === 'cross_aggregate' ? buildCrossTabResult(find(plan.period), snapshots[0], metric)
    : plan.operation === 'cross_trend' ? buildCrossTrendResult(periods.map(find), periods.map(period => snapshots.find(snapshot => key(snapshot.period) === key(period))!), metric, plan.mode, metrics.length)
    : plan.operation === 'group_aggregate' || plan.operation === 'group_trend'
    ? buildGroupedResult(periods.map(find), periods.map(period => snapshots.find(snapshot => key(snapshot.period) === key(period))!), plan.groupBy, metric, plan.operation === 'group_trend' ? plan.mode : 'per_period')
    : plan.operation === 'trend' ? buildTrendResult(periods.map(find), metric, plan.mode)
    : plan.operation === 'compare' ? buildCompareResult(find(plan.base), find(plan.current), metric, plan.mode)
    : plan.operation === 'list' ? buildListResult(find(plan.period), plan.fields, Boolean(plan.scope.buildingIds) || filterInputs.includes('vacancyRate'))
    : plan.operation === 'rank' ? buildRankResult(find(plan.period), plan.field, plan.limit, plan.direction, plan.projection)
    : buildAggregateResult(find(plan.period), metric);
  const result = metrics.length > 1 ? combineMetricResults(metrics.map(metric => ({ metric, result: build(metric) }))) : build(metrics[0]);
  const planned = attachExecutedPlan(result, plan);
  return assertMultiMetricResultSize(attachResearchAnalysis(plan.filter ? attachFilterEvidence(planned, evidence) : planned, selected, snapshots));
}
