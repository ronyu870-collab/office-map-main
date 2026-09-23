import { describe, expect, it } from 'vitest';

import {
  canonicalDraftUserName,
  hasMeaningfulDraftData,
  isDraftRevisionConflict,
  isSubmissionPeriodChanged,
  parseSubmissionPeriod,
  previousSubmissionPeriod,
} from './quarterlyDraftLifecycle';

describe('quarterly draft lifecycle helpers', () => {
  it('requires an explicit valid configured submission period', () => {
    expect(parseSubmissionPeriod([
      { key: 'current_submission_year', value: '2026' },
      { key: 'current_submission_quarter', value: '2' },
    ])).toEqual({ year: 2026, quarter: 2 });

    expect(() => parseSubmissionPeriod([])).toThrow(/年份配置无效/);
    expect(() => parseSubmissionPeriod([
      { key: 'current_submission_year', value: '2026' },
      { key: 'current_submission_quarter', value: '5' },
    ])).toThrow(/季度配置无效/);
  });

  it('calculates the exact previous quarter across year boundaries', () => {
    expect(previousSubmissionPeriod({ year: 2026, quarter: 2 })).toEqual({ year: 2026, quarter: 1 });
    expect(previousSubmissionPeriod({ year: 2026, quarter: 1 })).toEqual({ year: 2025, quarter: 4 });
  });

  it('uses a stable legacy display key without using it for authorization', () => {
    expect(canonicalDraftUserName('Leo.Liu@Colliers.com')).toBe('leo.liu');
    expect(canonicalDraftUserName(undefined, 'fallback')).toBe('fallback');
  });

  it('detects meaningful regular and future-supply draft content', () => {
    expect(hasMeaningfulDraftData({})).toBe(false);
    expect(hasMeaningfulDraftData({ __futureSupply__: {} })).toBe(false);
    expect(hasMeaningfulDraftData({ buildingA: { qQuote: '100' }, __futureSupply__: {} })).toBe(true);
    expect(hasMeaningfulDraftData({ __futureSupply__: { assignmentA: { qQuote: '100' } } })).toBe(true);
  });

  it('classifies revision and period conflicts', () => {
    expect(isDraftRevisionConflict({ code: '40001', message: 'draft_revision_conflict' })).toBe(true);
    expect(isSubmissionPeriodChanged({ message: 'submission_period_changed' })).toBe(true);
    expect(isDraftRevisionConflict({ code: '42501', message: 'permission denied' })).toBe(false);
  });
});
