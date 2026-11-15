import assert from 'node:assert/strict';
import { queryPerformanceSuite } from '../verification/query-performance-suite.mjs';
import { exactFractionMatches, validateCrossTrendResult } from '../verification/ai-query-cross-trend-oracle.mjs';
import { summarizeCrossTrendPerformance } from './verify-query-cross-trend.mjs';
import { queryPerformanceErrorCode } from './query-conversation-probe.mjs';

assert.equal(queryPerformanceSuite(), 'regression'); assert.equal(queryPerformanceSuite('cross_trend'), 'cross_trend');
for (const invalid of ['', 'all', 'cross', 'regression ', '0']) assert.throws(() => queryPerformanceSuite(invalid), /INVALID_QUERY_PERFORMANCE_SUITE/);

const cell = (numerator, denominator = '1') => ({ kind: 'number', value: { exact: { numerator, denominator } }, sourceIds: [] });
assert.equal(exactFractionMatches(cell('1', '8'), '12.5000', '100.00'), true);
assert.equal(exactFractionMatches(cell('-1', '2'), '-0.50'), true);
assert.equal(exactFractionMatches(cell('1'), '1', '0'), false);

// Preset SQL-shaped evidence, independent of the production grouping/formulas.
// The synthetic empty pair and different metric counts must remain observable.
const rows = ['CBD', '金融街'].flatMap(submarket => ['A', 'B'].flatMap(grade => ['2026-Q2', '2026-Q3'].map(period => {
  const empty = submarket === '金融街' && grade === 'B';
  const rent = empty ? 0 : submarket === 'CBD' && grade === 'B' && period === '2026-Q3' ? 1 : 2;
  const vacancy = empty ? 0 : submarket === '金融街' && period === '2026-Q3' ? 1 : 2;
  return { submarket, grade, period, candidate_count: empty ? 0 : 2,
    rent_numerator: rent ? (rent === 1 ? '2700000' : '5400000') : null, rent_denominator: rent ? (rent === 1 ? '15000' : '30000') : '0', rent_count: rent, rent_available: rent,
    vacancy_numerator: vacancy ? (vacancy === 1 ? '1500' : '3000') : null, vacancy_denominator: vacancy ? (vacancy === 1 ? '15000' : '30000') : '0', vacancy_count: vacancy, vacancy_available: vacancy,
    totalArea_numerator: empty ? null : '30000', totalArea_denominator: empty ? '0' : '2', totalArea_count: empty ? 0 : 2, totalArea_available: empty ? 0 : 2 };
})));
function result(metrics = ['rent', 'vacancy', 'totalArea']) {
  const keys = ['value', 'usedCount', 'availableCount', 'denominator', 'coverage'];
  const mapping = Object.fromEntries(metrics.map((metric, index) => [metric, Object.fromEntries(keys.map(key => [key, index === 0 ? key : `${metric}_${key}`]))]));
  return { operation: 'cross_trend', sources: [], parameters: { metric: metrics[0], tableVersion: 'cross-trend/1',
    ...(metrics.length > 1 ? { metrics, metricColumns: mapping } : {}),
    rowGroups: ['CBD', '金融街'].map(value => ({ value })), columnGroups: ['A', 'B'].map(value => ({ value })) },
  table: { rows: rows.map(row => ({ entityId: `${row.submarket}/${row.grade}/${row.period}`, cells: {
    name: { kind: 'text', value: row.submarket, sourceIds: [] }, grade: { kind: 'text', value: row.grade, sourceIds: [] }, period: { kind: 'text', value: row.period, sourceIds: [] },
    ...Object.fromEntries(metrics.flatMap(metric => {
      const map = mapping[metric];
      return [[map.value, row[metric + '_count'] === 0 ? { kind: 'unknown', sourceIds: [] }
        : metric === 'rent' ? cell('180') : metric === 'vacancy' ? cell('1', '10') : cell('30000')],
      [map.usedCount, cell(String(row[metric + '_count']))], [map.availableCount, cell(String(row[metric + '_available']))],
      [map.denominator, cell(row[metric + '_denominator'])], [map.coverage, { kind: 'text', value: `候选 ${row.candidate_count}`, sourceIds: [] }]];
    })) },
  })) } };
}
for (const metrics of [['rent'], ['rent', 'vacancy'], ['rent', 'vacancy', 'totalArea']]) validateCrossTrendResult(result(metrics), rows, metrics);
for (const [code, corrupt] of [
  ['CROSS_TREND_ORACLE_DIMENSION_MISMATCH', value => { value.table.rows[0].cells.period.value = '2026Q2'; }],
  ['CROSS_TREND_ORACLE_DIMENSION_MISMATCH', value => { value.table.rows[0].cells.grade.value = 'unknown-other-grade'; }],
  ['CROSS_TREND_ORACLE_DIMENSION_MISMATCH', value => { value.table.rows[1] = structuredClone(value.table.rows[0]); }],
  ['CROSS_TREND_ORACLE_ROW_COUNT_MISMATCH', value => { value.table.rows.pop(); }],
  ['CROSS_TREND_ORACLE_VALUE_MISMATCH', value => { value.table.rows[0].cells.totalArea_value = cell('15000'); }],
  ['CROSS_TREND_ORACLE_VALUE_MISMATCH', value => { value.table.rows.at(-1).cells.value = cell('0'); }],
  ['CROSS_TREND_ORACLE_COUNT_MISMATCH', value => { value.table.rows[0].cells.vacancy_usedCount = cell('1'); }],
  ['CROSS_TREND_ORACLE_DENOMINATOR_MISMATCH', value => { value.table.rows[0].cells.totalArea_denominator = cell('30000'); }],
  ['CROSS_TREND_ORACLE_PLAN_MISMATCH', value => { value.parameters.metricColumns.vacancy.value = 'value'; }],
  ['CROSS_TREND_ORACLE_SOURCE_MISMATCH', value => { value.table.rows[0].cells.value.sourceIds = ['unbound-source']; }],
]) {
  const changed = result(); corrupt(changed);
  assert.throws(() => validateCrossTrendResult(changed, rows), error => queryPerformanceErrorCode(error) === code);
}

const common = { profile: 'desktop', step: 'cross_per_period', status: 'success', oracleVerified: true, sourceVerified: true,
  vacancySwitchVerified: true, areaSwitchVerified: true, feedback_ms: 40, content_usable_ms: 1500, source_open_ms: 20,
  source_reopen_ms: 30, vacancy_switch_ms: 200, area_switch_ms: 250 };
const samples = Array.from({ length: 20 }, () => ({ ...common }));
const summary = values => summarizeCrossTrendPerformance(values).find(group => group.profile === 'desktop' && group.scenario === 'cross_per_period');
assert.equal(summary(samples).budgetsMet, true);
assert.equal(summary(samples.slice(0, 19)).measurementComplete, false);
for (const field of ['sourceVerified', 'oracleVerified', 'vacancySwitchVerified', 'areaSwitchVerified'])
  assert.equal(summary([...samples.slice(0, 19), { ...common, [field]: false }]).measurementComplete, false);
for (const field of ['vacancy_switch_ms', 'area_switch_ms', 'content_usable_ms']) assert.equal(summary(samples.map(value => ({ ...value, [field]: 2501 }))).budgetsMet, false);
assert.equal(summary(samples.map(value => ({ ...value, source_reopen_ms: 501 }))).budgetsMet, false);
assert.equal(summary([...samples.slice(0, 19), { ...common, status: 'failed' }]).failed, 1);
console.log('PASS cross-trend collector: strict suite, canonical two-axis periods, independent metric samples/SUM denominators, empty cells, source binding, two switches and unchanged timing budgets');
