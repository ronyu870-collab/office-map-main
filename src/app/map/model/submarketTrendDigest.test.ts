import { describe, expect, it } from 'vitest';
import type { SubmarketTrendPoint } from './submarketMarketTrend';
import { summarizeSubmarketTrend } from './submarketTrendDigest';

const row = (period: string, rent: number | null, vacancyPct: number | null): SubmarketTrendPoint => ({
  period, year: Number(period.slice(0, 4)), quarter: Number(period.slice(-1)),
  rent, vacancyPct, rentSamples: rent == null ? 0 : 1,
  vacancySamples: vacancyPct == null ? 0 : 1,
  rentArea: rent == null ? 0 : 100, vacancyArea: vacancyPct == null ? 0 : 100,
});

describe('submarket trend brief: observed quarters only', () => {
  it('does not mislabel an empty time-axis tail as the latest observation', () => {
    const result = summarizeSubmarketTrend([
      row('2026Q1', 180, 10), row('2026Q2', 170, 12), row('2026Q3', null, null),
    ]);
    expect(result.hasTrend).toBe(true);
    expect(result.latest?.period).toBe('2026Q2');
    expect(result.previous?.period).toBe('2026Q1');
    expect(result.rentChange).toBe(-10);
    expect(result.vacancyChange).toBe(2);
  });

  it('preserves valid 0% vacancy without fabricating missing rent', () => {
    const result = summarizeSubmarketTrend([
      row('2026Q1', 180, 20), row('2026Q2', null, 0),
    ]);
    expect(result.latest?.period).toBe('2026Q2');
    expect(result.rentChange).toBeNull();
    expect(result.vacancyChange).toBe(-20);
  });

  it('never bridges missing quarters or infers a trend from an empty series', () => {
    const gap = summarizeSubmarketTrend([
      row('2026Q1', 180, 10), row('2026Q2', null, null), row('2026Q3', 170, 15),
    ]);
    expect(gap.latest?.period).toBe('2026Q3');
    expect(gap.previous?.period).toBe('2026Q2');
    expect(gap.rentChange).toBeNull();
    expect(gap.vacancyChange).toBeNull();
    const empty = summarizeSubmarketTrend([row('2026Q1', null, null)]);
    expect(empty).toMatchObject({ latest: null, previous: null, rentChange: null, vacancyChange: null, hasTrend: false });
  });
});
