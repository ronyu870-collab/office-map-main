import { describe, expect, it } from 'vitest';
import { computeStatsFromBuildings } from '../mapDomain';
import { mapOptionalNumber, observedVacantArea } from '../vacancyMetrics';

describe('map vacancy observations', () => {
  it('preserves genuine 0 while marking null, empty and invalid numbers as unknown', () => {
    expect(mapOptionalNumber(0)).toBe(0);
    expect(mapOptionalNumber('0')).toBe(0);
    expect(mapOptionalNumber(0.08)).toBe(0.08);
    for (const unknown of [null, undefined, '', '  ', 'abc', Number.NaN]) {
      expect(Number.isNaN(mapOptionalNumber(unknown))).toBe(true);
    }
  });

  it('uses a known physical vacant area or a ratio-derived observation only for aggregation', () => {
    expect(observedVacantArea({ total_area: 1000, vacant_area: 75, vacancy_rate: 0.2 })).toBe(75);
    expect(observedVacantArea({ total_area: 1000, vacant_area: null, vacancy_rate: 0.2 })).toBe(200);
    expect(observedVacantArea({ total_area: 1000, vacant_area: null, vacancy_rate: 0 })).toBe(0);
    expect(Number.isNaN(observedVacantArea({ total_area: 1000, vacant_area: null, vacancy_rate: null }))).toBe(true);
    expect(Number.isNaN(observedVacantArea({ total_area: null, vacant_area: 5, vacancy_rate: 0.2 }))).toBe(true);
    expect(Number.isNaN(observedVacantArea({ total_area: 1000, vacant_area: null, vacancy_rate: 8 }))).toBe(true);
  });

  it('excludes unknown observations from the vacancy denominator without dropping total project area', () => {
    const row = (id: string, fraction: number | null, vacantArea: number | null) => ({
      id,
      name: id,
      location_lng: 116.46,
      location_lat: 39.91,
      metrics: [{
        record_year: 2026, record_quarter: 3, total_area: 1000,
        net_effective_rent: 200, vacant_area: vacantArea, vacancy_rate: fraction,
      }],
    });
    const stats = computeStatsFromBuildings([
      row('ratio-only', 0.2, null),
      row('unknown', null, null),
      row('true-zero', 0, 0),
    ]);
    expect(stats.totalArea).toBe('3,000');
    expect(stats.overallVacancyPct).toBe('10.0');
    expect(stats.avgRent).toBe('200.0');
    expect(computeStatsFromBuildings([row('all-unknown', null, null)]).overallVacancyPct).toBe('-');
  });
});
