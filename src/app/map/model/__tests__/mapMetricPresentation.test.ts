import { describe, expect, it } from 'vitest';
import { compactMarketArea, marketObservationLabel } from '../mapMetricPresentation';
import { computeStatsFromBuildings } from '../mapDomain';

describe('compact market context without changing the facts', () => {
  it('never labels mixed latest building observations as a uniform quarter', () => {
    expect(marketObservationLabel({ '2026Q2': 40, '2025Q4': 2 })).toBe('筛选存量 · 2025Q4–2026Q2 混合季度');
    expect(marketObservationLabel({ '2026Q2': 40 })).toBe('筛选存量 · 最新正式 2026Q2');
    expect(marketObservationLabel({})).toContain('未收录');
  });
  it('retains exact source area with compact ten-thousand square metre units', () => {
    const stats = computeStatsFromBuildings([{ id: 'one', grade: 'A', metrics: [{ is_locked: true, is_draft: false, record_year: 2026, record_quarter: 2, total_area: 36077944 }] }]);
    expect(compactMarketArea(stats)).toEqual({ value: '3,607.8', unit: '万㎡', exact: '36,077,944' });
    expect(stats.periods).toEqual({ '2026Q2': 1 });
    expect(compactMarketArea({ ...stats, stockArea: 0 })).toEqual({ value: '0', unit: '㎡', exact: '0' });
    expect(compactMarketArea({ ...stats, totalArea: '—', stockArea: null })).toEqual({ value: '—', unit: '㎡' });
  });
});
