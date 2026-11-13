import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { calculateWeightedAverageRent } from '@/src/utils/calculations';
import { aggregateQuarter, compareQuarters, rankBuildings } from '../analytics';
import { Decimal } from '../decimal';
import { evaluatePredicate, resolveNumericFact, type Predicate } from '../facts';
import { basePeriod, currentPeriod, fixture, nameSource, source } from './fixtures';

describe('trusted query fixed business acceptance', () => {
  it('keeps independent rent, vacancy and stock denominators (T10–T15)', () => {
    const snapshot = fixture();
    const rent = aggregateQuarter(snapshot, 'rent');
    expect(rent.value).toEqual({ exact: { numerator: '170', denominator: '1' }, numeric: 170 });
    expect(rent.denominator.numeric).toBe(50000);
    expect(rent.coverage).toEqual({ total: 4, valid: 3, missing: 1, invalid: 0, conflict: 0, unverified: 0 });
    const vacancy = aggregateQuarter(snapshot, 'vacancy');
    expect(vacancy.value).toEqual({ exact: { numerator: '7', denominator: '40' }, numeric: 0.175 });
    expect(vacancy.denominator.numeric).toBe(40000);
    expect(vacancy.numerator.numeric).toBe(7000);
    expect(vacancy.excluded.map(row => [row.entityId, row.state])).toEqual([['C', 'missing'], ['D', 'invalid']]);
    expect(aggregateQuarter(snapshot, 'totalArea').value?.numeric).toBe(70000);
    expect(rent.contributions.flatMap(row => row.sourceIds)).not.toContain('C/netEffectiveRent/3/');
    expect(vacancy.contributions.map(row => row.entityId)).toEqual(['A', 'B']);
  });

  it('limits the tallest claim to known values and preserves missing/conflicting sources (T03/T08)', () => {
    const result = rankBuildings(fixture(), 'height', 1);
    expect(result.coverage).toEqual({ total: 4, valid: 2, missing: 1, invalid: 0, conflict: 1, unverified: 0 });
    expect(result.rows.map(row => [row.entityId, row.value.numeric])).toEqual([['A', 210]]);
    expect(result.excluded.find(row => row.entityId === 'D')?.sourceIds).toHaveLength(2);
    expect(result.populationMeaning).toBe('authorized_database_inventory_only');
  });

  it('retains all boundary ties with stable ranks independent of row order (T04)', () => {
    const data = fixture();
    const tied = { ...data, rows: data.rows.map(row => row.id === 'B' ? { ...row, facts: { ...row.facts, height: resolveNumericFact('height', row.id, [source(row.id, 'height', '210.00')], null) } } : row) };
    const forward = rankBuildings(tied, 'height', 1);
    const reverse = rankBuildings({ ...tied, rows: [...tied.rows].reverse() }, 'height', 1);
    expect(forward.rows).toEqual(reverse.rows);
    expect(forward.rows.map(row => [row.entityId, row.rank])).toEqual([['A', 1], ['B', 1]]);
  });

  it('uses three-valued logic, including false AND unknown and true OR unknown (T05)', () => {
    const rows = fixture().rows;
    const high: Predicate = { field: 'height', operator: 'gt', value: '200' };
    expect(rows.map(row => evaluatePredicate(row, high))).toEqual(['true', 'false', 'unknown', 'unknown']);
    expect(evaluatePredicate(rows[2], { operator: 'and', terms: [high, { field: 'totalArea', operator: 'lt', value: '100' }] })).toBe('false');
    expect(evaluatePredicate(rows[2], { operator: 'or', terms: [high, { field: 'totalArea', operator: 'gt', value: '100' }] })).toBe('true');
  });

  it('computes per-period versus independently paired samples before rounding (T16–T18)', () => {
    const base = fixture(basePeriod), current = fixture();
    const rentPerPeriod = compareQuarters(base, current, 'rent', 'per_period');
    const rentPaired = compareQuarters(base, current, 'rent', 'paired');
    expect(rentPerPeriod.base.value?.numeric).toBeCloseTo(155.7142857142857, 10);
    expect(rentPerPeriod.change?.numeric).toBeCloseTo(9.174311926605505, 10);
    expect(rentPaired.base.value?.numeric).toBe(154);
    expect(rentPaired.change?.numeric).toBeCloseTo(10.38961038961039, 10);
    expect(rentPaired.base.excludedByPairing).toEqual(['C']);
    const vacancyPerPeriod = compareQuarters(base, current, 'vacancy', 'per_period');
    const vacancyPaired = compareQuarters(base, current, 'vacancy', 'paired');
    expect(vacancyPerPeriod.change?.numeric).toBeCloseTo(3.2142857142857144, 10);
    expect(vacancyPaired.change).toEqual({ exact: { numerator: '5', denominator: '1' }, numeric: 5 });
    expect(vacancyPaired.changeUnit).toBe('percentage_point');
    expect(vacancyPaired.pairedIds).toEqual(['A', 'B']);
    expect(rentPaired.pairedIds).toEqual(['A', 'B', 'D']);
  });

  it('refuses partial reads, duplicate joins, different scope and wrong quarters (T01/T21)', () => {
    const data = fixture();
    expect(() => rankBuildings({ ...data, complete: false }, 'height')).toThrow('INCOMPLETE_SNAPSHOT');
    expect(() => aggregateQuarter({ ...data, expectedCount: 5 }, 'rent')).toThrow('INCOMPLETE_SNAPSHOT');
    expect(() => aggregateQuarter({ ...data, rows: [data.rows[0], ...data.rows.slice(0, 3)] }, 'rent')).toThrow('DUPLICATE_ENTITY');
    expect(() => compareQuarters(data, { ...data, scopeFingerprint: 'another-account' }, 'rent', 'paired')).toThrow('SCOPE_MISMATCH');
    expect(() => aggregateQuarter({ ...data, period: basePeriod }, 'rent')).toThrow('SOURCE_PERIOD_MISMATCH');
  });

  it('does not turn an empty or wholly missing population into zero', () => {
    const empty = { ...fixture(), rows: [], expectedCount: 0 };
    expect(aggregateQuarter(empty, 'rent').value).toBeNull();
    expect(rankBuildings(empty, 'height').rows).toEqual([]);
    const allMissing = { ...fixture(), rows: fixture().rows.map(row => ({ ...row, facts: {} })) };
    expect(rankBuildings(allMissing, 'height').coverage.missing).toBe(4);
    expect(compareQuarters(allMissing, allMissing, 'rent', 'paired').change).toBeNull();
  });

  it('preserves exact zero vacancy and zero-base semantics', () => {
    const data = fixture();
    const zero = { ...data, rows: data.rows.map(row => ({ ...row, facts: { ...row.facts, vacantArea: resolveNumericFact('vacantArea', row.id, [source(row.id, 'vacantArea', 0)], currentPeriod) } })) };
    expect(aggregateQuarter(zero, 'vacancy').value?.numeric).toBe(0);
    expect(compareQuarters(zero, zero, 'vacancy', 'paired').change?.numeric).toBe(0);
    expect(compareQuarters(zero, data, 'vacancy', 'paired').change?.numeric).toBe(17.5);
  });
});

describe('field binding and numeric integrity', () => {
  it.each([null, undefined, '', '   '])('treats %s as missing, never zero', raw => {
    expect(resolveNumericFact('height', 'A', [source('A', 'height', raw)], null).state).toBe('missing');
  });
  it.each([true, [], {}, '1,200', '210m', 'NaN', Infinity, -1, '1e999'])('rejects noncanonical or invalid values %s', raw => {
    expect(resolveNumericFact('height', 'A', [source('A', 'height', raw)], null).state).toBe('invalid');
  });
  it('does not substitute floors or another building, period or unit for height (T06)', () => {
    expect(() => resolveNumericFact('height', 'A', [source('A', 'floors', 60)], null)).toThrow('SOURCE_BINDING_MISMATCH');
    expect(() => resolveNumericFact('height', 'A', [source('B', 'height', 210)], null)).toThrow('SOURCE_BINDING_MISMATCH');
    expect(() => resolveNumericFact('height', 'A', [{ ...source('A', 'height', 210), unit: 'cm' }], null)).toThrow('SOURCE_BINDING_MISMATCH');
    expect(() => resolveNumericFact('totalArea', 'A', [source('A', 'totalArea', 100, basePeriod)], currentPeriod)).toThrow('SOURCE_PERIOD_MISMATCH');
  });
  it('preserves record-only provenance, refuses fake verification and unreviewed candidates', () => {
    const reference = source('A', 'height', 210);
    const fact = resolveNumericFact('height', 'A', [reference], null);
    expect(fact.sources[0].verification).toBe('database_only');
    expect(fact.sources[0].original).toBeNull();
    expect(() => resolveNumericFact('height', 'A', [{ ...reference, verification: 'verified_original' }], null)).toThrow('ORIGINAL_REFERENCE_REQUIRED');
    expect(resolveNumericFact('height', 'A', [{ ...reference, verification: 'unreviewed' }], null).state).toBe('unverified');
  });
  it('does not alter legacy positive-rent semantics or round decimal inputs', () => {
    expect(resolveNumericFact('netEffectiveRent', 'A', [source('A', 'netEffectiveRent', 0)], currentPeriod).state).toBe('invalid');
    expect(resolveNumericFact('parking', 'A', [source('A', 'parking', 0)], null).state).toBe('valid');
    expect(resolveNumericFact('parking', 'A', [source('A', 'parking', '0.5')], null).state).toBe('invalid');
    expect(Decimal.parse('0.1')!.add(Decimal.parse('0.2')!).exact()).toEqual({ numerator: '3', denominator: '10' });
    expect(Decimal.parse('9007199254740993')!.subtract(Decimal.parse('9007199254740992')!).exact()).toEqual({ numerator: '1', denominator: '1' });
  });
  it('matches the established rent formula for valid samples and is permutation invariant', () => {
    fc.assert(fc.property(fc.array(fc.record({ area: fc.integer({ min: 1, max: 100000 }), rent: fc.integer({ min: 1, max: 10000 }) }), { minLength: 1, maxLength: 80 }), input => {
      const template = fixture();
      const rows = input.map((item, index) => {
        const id = String(index);
        return { id, name: id, nameSource: nameSource(id, id), facts: {
          totalArea: resolveNumericFact('totalArea', id, [source(id, 'totalArea', item.area)], currentPeriod),
          netEffectiveRent: resolveNumericFact('netEffectiveRent', id, [source(id, 'netEffectiveRent', item.rent)], currentPeriod),
        } };
      });
      const snapshot = { ...template, rows, expectedCount: rows.length };
      const result = aggregateQuarter(snapshot, 'rent');
      expect(result.value?.numeric).toBeCloseTo(calculateWeightedAverageRent(input, row => row)!, 8);
      expect(aggregateQuarter({ ...snapshot, rows: [...rows].reverse() }, 'rent').value?.exact).toEqual(result.value?.exact);
      expect(result.coverage.valid).toBe(rows.length);
    }), { numRuns: 100 });
  });
});
