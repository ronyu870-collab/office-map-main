import { describe, expect, it } from 'vitest';
import { buildAggregateResult, buildRankResult } from '../result';
import { resultViewSchema, resultSummary, formatExact, cellText } from '../presentation';
import { fixture } from './fixtures';

describe('same-snapshot presentation', () => {
  it('formats exact rationals and preserves real zero / unknown separately', () => {
    expect(formatExact({ exact: { numerator: '7', denominator: '40' }, numeric: 999 }, 'ratio')).toBe('17.5');
    expect(formatExact({ exact: { numerator: '-1', denominator: '8' }, numeric: 0 }, 'percentage_point')).toBe('-0.13');
    expect(cellText({ kind: 'number', value: { exact: { numerator: '0', denominator: '1' }, numeric: 0 }, sourceIds: [] }, 'm')).toBe('0');
    expect(cellText({ kind: 'unknown', state: 'missing', reason: 'absent', sourceIds: [] }, 'm')).toContain('未知');
  });
  it('renders authoritative 170 / 17.5 and known-sample qualifications from one result', () => {
    const rent = resultViewSchema.parse(buildAggregateResult(fixture(), 'rent'));
    expect(resultSummary(rent).join(' ')).toContain('170');
    const vacancy = resultViewSchema.parse(buildAggregateResult(fixture(), 'vacancy'));
    expect(resultSummary(vacancy).join(' ')).toContain('17.5');
    const rank = resultViewSchema.parse(buildRankResult(fixture(), 'height', 1, 'desc'));
    expect(resultSummary(rank).join(' ')).toContain('不能确认整个现实市场');
    const tampered = structuredClone(rent); tampered.sources = [];
    expect(resultViewSchema.safeParse(tampered).success).toBe(false);
  });
});
