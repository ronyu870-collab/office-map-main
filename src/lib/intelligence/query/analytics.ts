import { Decimal } from './decimal';
import { assertComplete, quarterKey, type BuildingFacts, type Coverage, type Exclusion, type FactSnapshot, type FactState, type NumericFact, type NumericOutput } from './contracts';
import { assertFieldContext, getFact } from './facts';
import { FORMULAS, numericFields, type NumericField } from './registry';

const output = (value: Decimal): NumericOutput => ({ exact: value.exact(), numeric: value.toNumber() });
const sourceIds = (facts: readonly NumericFact[]): string[] => [...new Set(facts.flatMap(fact => fact.sources.map(source => source.id)))].sort();
const blankCoverage = (total: number): Record<FactState, number> & { total: number } => ({ total, valid: 0, missing: 0, invalid: 0, conflict: 0, unverified: 0 });

export function rankBuildings(snapshot: FactSnapshot, field: NumericField, limit = 10, direction: 'asc' | 'desc' = 'desc') {
  assertComplete(snapshot);
  if (!Object.hasOwn(numericFields, field)) throw new Error('UNKNOWN_FIELD');
  assertFieldContext(snapshot, [field]);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('INVALID_RANK_LIMIT');
  if (direction !== 'asc' && direction !== 'desc') throw new Error('INVALID_RANK_DIRECTION');
  const coverage = blankCoverage(snapshot.rows.length);
  const excluded: Exclusion[] = [];
  const eligible: { entityId: string; name: string; value: Decimal; sourceIds: string[] }[] = [];
  for (const row of snapshot.rows) {
    const fact = getFact(row, field);
    coverage[fact.state]++;
    if (fact.state === 'valid') eligible.push({ entityId: row.id, name: row.name, value: fact.value, sourceIds: sourceIds([fact]) });
    else excluded.push({ entityId: row.id, state: fact.state, reason: fact.reason, sourceIds: sourceIds([fact]) });
  }
  eligible.sort((a, b) => a.value.compare(b.value) * (direction === 'asc' ? 1 : -1) || (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
  const boundary = eligible[Math.min(limit, eligible.length) - 1]?.value;
  const included = eligible.filter((entry, index) => index < limit || (boundary && entry.value.compare(boundary) === 0));
  let rank = 1;
  return {
    snapshotId: snapshot.snapshotId, field, unit: numericFields[field].unit, direction,
    coverage, excluded, requestedLimit: limit, tiesIncluded: true,
    populationMeaning: 'authorized_database_inventory_only' as const,
    rows: included.map((entry, index) => {
      if (index > 0 && entry.value.compare(included[index - 1].value) !== 0) rank = index + 1;
      return { ...entry, rank, value: output(entry.value) };
    }),
  };
}

export type AggregateMetric = keyof typeof FORMULAS;
type Contribution = { entityId: string; numerator: Decimal; denominator: Decimal; sourceIds: string[] };
type AggregateParts = { coverage: Coverage; excluded: Exclusion[]; contributions: Contribution[] };

function invalidPart(row: BuildingFacts, facts: NumericFact[]): Exclusion | null {
  // Mutual exclusion precedence: conflict > invalid > unreviewed > missing.
  for (const state of ['conflict', 'invalid', 'unverified', 'missing'] as const) {
    const fact = facts.find(value => value.state === state);
    if (fact && fact.state !== 'valid') return { entityId: row.id, state, reason: fact.reason, sourceIds: sourceIds(facts) };
  }
  return null;
}

function aggregateParts(snapshot: FactSnapshot, metric: AggregateMetric): AggregateParts {
  assertComplete(snapshot);
  if (!snapshot.period) throw new Error('QUARTER_REQUIRED');
  if (!Object.hasOwn(FORMULAS, metric)) throw new Error('UNKNOWN_METRIC');
  assertFieldContext(snapshot, metric === 'rent' ? ['totalArea', 'netEffectiveRent'] : metric === 'vacancy' ? ['totalArea', 'vacantArea'] : ['totalArea']);
  const coverage = blankCoverage(snapshot.rows.length);
  const contributions: Contribution[] = [];
  const excluded: Exclusion[] = [];
  for (const row of snapshot.rows) {
    const area = getFact(row, 'totalArea');
    const value = metric === 'rent' ? getFact(row, 'netEffectiveRent') : metric === 'vacancy' ? getFact(row, 'vacantArea') : area;
    const facts = metric === 'totalArea' ? [area] : [area, value];
    // Do not allow an accidentally mixed-quarter adapter result to be aggregated.
    for (const fact of facts) for (const source of fact.sources) {
      if (!source.period || quarterKey(source.period) !== quarterKey(snapshot.period)) throw new Error('SOURCE_PERIOD_MISMATCH');
    }
    let exclusion = invalidPart(row, facts);
    if (!exclusion && area.state === 'valid' && value.state === 'valid') {
      if (metric === 'vacancy' && value.value.compare(area.value) > 0) exclusion = { entityId: row.id, state: 'invalid', reason: 'vacant_area_exceeds_total_area', sourceIds: sourceIds(facts) };
      else {
        coverage.valid++;
        contributions.push({
          entityId: row.id,
          numerator: metric === 'rent' ? value.value.multiply(area.value) : value.value,
          denominator: metric === 'totalArea' ? Decimal.parse(1)! : area.value,
          sourceIds: sourceIds(facts),
        });
      }
    }
    if (exclusion) { coverage[exclusion.state]++; excluded.push(exclusion); }
  }
  return { coverage, excluded, contributions };
}

function reduceContributions(metric: AggregateMetric, contributions: readonly Contribution[]) {
  const numerator = contributions.reduce((sum, row) => sum.add(row.numerator), Decimal.zero());
  const denominator = contributions.reduce((sum, row) => sum.add(row.denominator), Decimal.zero());
  const value = !contributions.length ? null : metric === 'totalArea' ? numerator : numerator.divide(denominator);
  return { numerator, denominator, value };
}

export function aggregateQuarter(snapshot: FactSnapshot, metric: AggregateMetric) {
  const parts = aggregateParts(snapshot, metric);
  const totals = reduceContributions(metric, parts.contributions);
  return {
    snapshotId: snapshot.snapshotId, period: snapshot.period, metric, formulaVersion: FORMULAS[metric],
    unit: metric === 'rent' ? 'CNY/m2/month' : metric === 'vacancy' ? 'ratio' : 'm2',
    coverage: parts.coverage, excluded: parts.excluded,
    value: totals.value ? output(totals.value) : null,
    numerator: output(totals.numerator), denominator: output(totals.denominator),
    denominatorUnit: metric === 'totalArea' ? 'building_count' : 'm2',
    contributions: parts.contributions.map(row => ({ ...row, numerator: output(row.numerator), denominator: output(row.denominator) })),
  };
}

/** Pair independently for each metric; rent and vacancy need not have the same valid sample. */
export function compareQuarters(base: FactSnapshot, current: FactSnapshot, metric: AggregateMetric, mode: 'per_period' | 'paired') {
  if (mode !== 'paired' && mode !== 'per_period') throw new Error('UNKNOWN_COMPARISON_MODE');
  if (base.scopeFingerprint !== current.scopeFingerprint) throw new Error('SCOPE_MISMATCH');
  const baseParts = aggregateParts(base, metric);
  const currentParts = aggregateParts(current, metric);
  const baseIds = new Set(baseParts.contributions.map(row => row.entityId));
  const currentIds = new Set(currentParts.contributions.map(row => row.entityId));
  const pairedIds = [...baseIds].filter(id => currentIds.has(id)).sort();
  const pairedSet = new Set(pairedIds);
  const select = (parts: AggregateParts) => mode === 'paired' ? parts.contributions.filter(row => pairedSet.has(row.entityId)) : parts.contributions;
  const selectedBase = select(baseParts);
  const selectedCurrent = select(currentParts);
  const before = reduceContributions(metric, selectedBase);
  const after = reduceContributions(metric, selectedCurrent);
  const difference = before.value && after.value ? after.value.subtract(before.value) : null;
  const change = difference && before.value && (metric === 'vacancy' || before.value.compare(Decimal.zero()) !== 0)
    ? (metric === 'vacancy' ? difference : difference.divide(before.value)).multiply(Decimal.parse(100)!) : null;
  const periodResult = (snapshot: FactSnapshot, parts: AggregateParts, selected: Contribution[], totals: ReturnType<typeof reduceContributions>) => ({
    snapshotId: snapshot.snapshotId, period: snapshot.period,
    availableCoverage: parts.coverage, excluded: parts.excluded,
    usedEntityIds: selected.map(row => row.entityId).sort(),
    excludedByPairing: parts.contributions.filter(row => !selected.includes(row)).map(row => row.entityId).sort(),
    value: totals.value ? output(totals.value) : null,
    numerator: output(totals.numerator), denominator: output(totals.denominator),
    sourceIds: [...new Set(selected.flatMap(row => row.sourceIds))].sort(),
  });
  return {
    metric, mode, formulaVersion: FORMULAS[metric], pairedIds,
    base: periodResult(base, baseParts, selectedBase, before),
    current: periodResult(current, currentParts, selectedCurrent, after),
    difference: difference ? output(difference) : null,
    change: change ? output(change) : null,
    changeUnit: metric === 'vacancy' ? 'percentage_point' : 'percent',
    unavailableReason: change ? null : before.value && before.value.compare(Decimal.zero()) === 0 ? 'zero_base' : 'no_valid_sample',
  };
}
