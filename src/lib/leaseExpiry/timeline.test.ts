import { describe, expect, it } from 'vitest';
import { expiryBar, expiryLabel, expiryMonths, expiryAxisMonths } from './timeline';

describe('lease expiry timeline display', () => {
  it('clips inclusive estimates to the half-open server window without dropping its last day', () => {
    expect(expiryBar('2026-10-01', '2026-12-31', '2026-11-13', '2027-05-13')).toMatchObject({ left: 0, before: true, after: false });
    expect(expiryBar('2027-04-01', '2027-06-30', '2026-11-13', '2027-05-13')).toMatchObject({ after: true });
    expect(expiryBar('2027-05-13', '2027-05-13', '2026-11-13', '2027-05-13')).toBeNull();
    expect(expiryBar('2026-11-12', '2026-11-12', '2026-11-13', '2027-05-13')).toBeNull();
    expect(expiryBar('2026-11-13', '2026-11-13', '2026-11-13', '2027-05-13')).toMatchObject({ left: 0, point: true });
  });
  it('preserves month, quarter and exact-day precision, including leap dates', () => {
    expect(expiryLabel('2026-10-01', '2026-12-31')).toBe('2026 年第四季度');
    expect(expiryLabel('2028-02-01', '2028-02-29')).toBe('2028 年 2 月');
    expect(expiryLabel('2027-01-15', '2027-01-15')).toBe('2027.01.15');
    expect(expiryLabel('2027-03-01', '2027-05-31')).toBe('2027.03.01 — 2027.05.31');
    expect(expiryLabel('2027-02-29', '2027-03-01')).toBe('暂无法估算');
    expect(expiryLabel(null, null)).toBe('暂无法估算');
    expect(expiryBar('2027-05-01', '2027-04-01', '2026-11-13', '2027-05-13')).toBeNull();
  });
  it('uses server dates and marks the year boundary, never assumes a local current date', () => {
    const months = expiryMonths('2026-11-13', '2027-05-13');
    expect(months).toHaveLength(7);
    expect(months[0]).toMatchObject({ key: '2026-11', left: 0 });
    expect(months[2].label).toBe('2027/1月');
    expect(expiryMonths('2026-11-13', '2026-11-12')).toEqual([]);
  });
});

it('keeps compact axis labels apart at month-end and across the year without shifting date positions', () => {
  for (const day of ['2026-11-13', '2026-11-30', '2026-12-31']) {
    const all = expiryMonths(day, '2027-05-31'), compact = expiryAxisMonths(day, '2027-05-31');
    expect(compact.some(month => month.label === '2027/1月')).toBe(true);
    for (const month of compact) { const original=all.find(value=>value.key===month.key)!; expect(month.left).toBeGreaterThan(original.left); expect(month.left).toBeLessThan(100); }
    for (let i = 1; i < compact.length; i++) expect(compact[i].left - compact[i - 1].left).toBeGreaterThanOrEqual(12);
  }
});
