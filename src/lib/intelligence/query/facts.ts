import { Decimal } from './decimal';
import { quarterKey, quarterSchema, type BuildingFacts, type FactSnapshot, type NumericFact, type Quarter, type SourceRef } from './contracts';
import { numericFields, type NumericField } from './registry';

export function missingFact(reason = 'not_recorded'): NumericFact {
  return { state: 'missing', reason, sources: [] };
}

/** Multiple inputs must be co-current candidates selected by the version adapter, never all history. */
export function resolveNumericFact(field: NumericField, entityId: string, sources: readonly SourceRef[], period: Quarter | null): NumericFact {
  if (!Object.hasOwn(numericFields, field)) throw new Error('UNKNOWN_FIELD');
  const rule = numericFields[field];
  if (rule.temporal === 'quarter' && !period) throw new Error('QUARTER_REQUIRED');
  if (period) quarterSchema.parse(period);
  const copied = structuredClone(sources);
  if (new Set(copied.map(source => source.id)).size !== copied.length) throw new Error('DUPLICATE_SOURCE');
  for (const source of copied) {
    if (!source.id || !source.recordId || !source.recordVersion || source.entityId !== entityId || source.table !== rule.table || source.field !== rule.column || source.unit !== rule.unit) throw new Error('SOURCE_BINDING_MISMATCH');
    if (source.period) quarterSchema.parse(source.period);
    if (rule.temporal === 'quarter' && (!source.period || quarterKey(source.period) !== quarterKey(period!))) throw new Error('SOURCE_PERIOD_MISMATCH');
    if (source.verification === 'verified_original' && !source.original) throw new Error('ORIGINAL_REFERENCE_REQUIRED');
  }
  const populated = copied.filter(source => source.rawValue !== null && source.rawValue !== undefined && !(typeof source.rawValue === 'string' && source.rawValue.trim() === ''));
  if (!populated.length) return { state: 'missing', reason: 'not_recorded', sources: copied };
  if (populated.some(source => source.verification === 'unreviewed')) return { state: 'unverified', reason: 'unreviewed_candidate', sources: copied };
  const values = populated.map(source => Decimal.parse(source.rawValue));
  if (values.some(value => !value || value.compare(Decimal.zero()) < (rule.positive ? 1 : 0) || (rule.integer && value.denominator !== BigInt(1)))) {
    return { state: 'invalid', reason: 'invalid_numeric_value', sources: copied };
  }
  const valid = values as Decimal[];
  if (valid.some(value => value.compare(valid[0]) !== 0)) return { state: 'conflict', reason: 'conflicting_co_current_values', sources: copied };
  return { state: 'valid', value: valid[0], sources: copied };
}

export function getFact(row: BuildingFacts, field: NumericField): NumericFact {
  return row.facts[field] ?? missingFact();
}

export function assertFieldContext(snapshot: FactSnapshot, fields: readonly NumericField[]): void {
  for (const field of fields) {
    if (!Object.hasOwn(numericFields, field)) throw new Error('UNKNOWN_FIELD');
    if (numericFields[field].temporal === 'quarter' && !snapshot.period) throw new Error('QUARTER_REQUIRED');
    for (const row of snapshot.rows) {
      const fact = getFact(row, field);
      const resolved = resolveNumericFact(field, row.id, fact.sources, snapshot.period);
      if (resolved.state !== fact.state || (resolved.state === 'valid' && fact.state === 'valid' && resolved.value.compare(fact.value) !== 0)) throw new Error('FACT_SOURCE_MISMATCH');
    }
  }
}

export type Truth = 'true' | 'false' | 'unknown';
export type Predicate =
  | { field: NumericField; operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'; value: string }
  | { operator: 'and' | 'or'; terms: readonly Predicate[] };

export function evaluatePredicate(row: BuildingFacts, predicate: Predicate, depth = 0): Truth {
  if (depth > 8) throw new Error('FILTER_TOO_DEEP');
  if ('terms' in predicate) {
    if (predicate.terms.length < 1 || predicate.terms.length > 20) throw new Error('FILTER_TERM_LIMIT');
    const values = predicate.terms.map(term => evaluatePredicate(row, term, depth + 1));
    if (predicate.operator === 'and') return values.includes('false') ? 'false' : values.includes('unknown') ? 'unknown' : 'true';
    return values.includes('true') ? 'true' : values.includes('unknown') ? 'unknown' : 'false';
  }
  if (!Object.hasOwn(numericFields, predicate.field)) throw new Error('UNKNOWN_FIELD');
  const threshold = Decimal.parse(predicate.value);
  if (!threshold) throw new Error('INVALID_FILTER_NUMBER');
  const fact = getFact(row, predicate.field);
  if (fact.state !== 'valid') return 'unknown';
  const comparison = fact.value.compare(threshold);
  const matches = { gt: comparison > 0, gte: comparison >= 0, lt: comparison < 0, lte: comparison <= 0, eq: comparison === 0 };
  if (!Object.hasOwn(matches, predicate.operator)) throw new Error('UNKNOWN_OPERATOR');
  return matches[predicate.operator] ? 'true' : 'false';
}
