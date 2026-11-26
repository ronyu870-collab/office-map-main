import { describe, expect, it } from 'vitest';
import type { SubmarketTrendPoint } from './submarketMarketTrend';
import { buildTrendTimeline, designMarketTrends, latestGradeComparisons, marketTrendAxisDensity } from './marketTrendPresentation';

function observation(period: string, rent: number | null, vacancyPct: number | null = null, extra: Partial<SubmarketTrendPoint> = {}): SubmarketTrendPoint {
  return {
    period, year: Number(period.slice(0, 4)), quarter: Number(period.at(-1)), rent, vacancyPct,
    rentSamples: rent == null ? 0 : 2, vacancySamples: vacancyPct == null ? 0 : 3,
    rentArea: rent == null ? 0 : 400, vacancyArea: vacancyPct == null ? 0 : 600,
    ...extra,
  };
}

describe('market chart decisions', () => {
  it('uses one common axis for continuous observations while each indicator retains its own latest date', () => {
    const axis = buildTrendTimeline([
      observation('2026Q1', 180, 0), observation('2025Q4', 200, 13),
      observation('2026Q3', 170), observation('2026Q2', 175, 12),
    ]);
    const [rent, vacancy] = designMarketTrends(axis, 'research');
    expect([rent.kind, vacancy.kind]).toEqual(['line', 'line']);
    expect(rent.axis).toBe(vacancy.axis);
    expect(rent.latest?.period).toBe('2026Q3');
    expect(vacancy.latest?.period).toBe('2026Q2');
    expect(rent.latestChange?.label).toBe('环比');
    expect(vacancy.observations[1].point?.vacancyPct).toBe(0);
  });

  it('starts with a recent continuous interval and restores older values and genuine gaps in history', () => {
    const axis = buildTrendTimeline([
      observation('2024Q3', 200), observation('2025Q1', 190),
      observation('2026Q1', 190), observation('2026Q2', 175), observation('2026Q3', 180),
    ]);
    const [recent] = designMarketTrends(axis, 'research');
    expect(recent).toMatchObject({ kind: 'line', offersHistory: true, keepsOtherObservations: true });
    expect(recent.axis.map(row => row.period)).toEqual(['2026Q1', '2026Q2', '2026Q3']);
    const [history] = designMarketTrends(axis, 'research', 'history');
    expect(history.kind).toBe('scatter');
    expect(history.axis.map(row => row.point?.rent ?? null)).toEqual([200, null, 190, null, null, null, 190, 175, 180]);
  });

  it('uses discrete positions for multiple gaps, without magnifying sparse series by dropping older points', () => {
    const axis = buildTrendTimeline([observation('2022Q1', 100), observation('2025Q3', 150), observation('2026Q1', 120)]);
    const [rent] = designMarketTrends(axis, 'research');
    expect(rent.kind).toBe('scatter');
    expect(rent.axis.map(row => row.point?.rent ?? null).filter(value => value != null)).toEqual([100, 150, 120]);
    expect(rent.axis).toHaveLength(17);
  });

  it('uses value or comparison summaries for one or two observations and leaves truly empty metrics empty', () => {
    const axis = buildTrendTimeline([observation('2025Q1', 180, 0), observation('2026Q1', 170)]);
    const [rent, vacancy] = designMarketTrends(axis, 'research');
    expect(rent.kind).toBe('comparison');
    expect(rent.latestChange).toMatchObject({ label: '2025Q1 至 2026Q1变化', difference: -10 });
    expect(vacancy).toMatchObject({ kind: 'value', latest: { period: '2025Q1' } });
    expect(designMarketTrends([], 'research').map(plot => plot.kind)).toEqual(['empty', 'empty']);
  });

  it('suppresses changes if one period has fewer than two observations and identifies material sample differences', () => {
    const before = observation('2026Q1', 100, 0, { rentSamples: 1, vacancyCoverage: { count: 1, area: 0.75 } });
    const after = observation('2026Q2', 120, 20, {
      vacancyCoverage: { count: 1, area: 0.65 },
      sameSampleQoq: { rent: { samples: 0, rentPct: null, vacancyPp: null }, vacancy: { samples: 2, rentPct: null, vacancyPp: -3 } },
    });
    const [rent, vacancy] = designMarketTrends(buildTrendTimeline([before, after]), 'research');
    expect(rent).toMatchObject({ latestChange: null, quality: '两期有效样本不足，无法比较' });
    expect(vacancy.latestChange).toMatchObject({ difference: 20, sampleChanged: true, sameSample: { vacancyPp: -3 } });
  });

  it('limits overview and default research ranges independently while preserving full history', () => {
    const axis = buildTrendTimeline(Array.from({ length: 12 }, (_, i) => observation(`${2024 + Math.floor(i / 4)}Q${i % 4 + 1}`, 200 - i)));
    expect(designMarketTrends(axis, 'overview')[0].axis).toHaveLength(5);
    expect(designMarketTrends(axis, 'research')[0].axis).toHaveLength(8);
    expect(designMarketTrends(axis, 'research', 'history')[0].axis).toHaveLength(12);
    expect(marketTrendAxisDensity(300, 12).interval).toBeGreaterThan(marketTrendAxisDensity(650, 12).interval);
  });

  it('finds same-quarter A/B comparisons per metric and excludes single or unmatched grades', () => {
    const a = [observation('2026Q1', 200, 12), observation('2026Q2', 190, 0), observation('2026Q3', 180, 10)];
    const b = [observation('2026Q1', 140, 14), observation('2026Q2', 130, 0, { rentSamples: 1 })];
    const comparison = latestGradeComparisons({ a, b });
    expect(comparison).toMatchObject([
      { metric: 'rent', a: { period: '2026Q1' }, b: { period: '2026Q1' }, difference: 60 },
      { metric: 'vacancyPct', a: { period: '2026Q2' }, b: { period: '2026Q2' }, difference: 0 },
    ]);
  });
});
