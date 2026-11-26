import { describe, expect, it } from 'vitest';
import { aggregateMarket } from '@/src/app/map/model/marketStatistics';
import { aggregateQuarter } from '../analytics';
import { fixture } from './fixtures';

describe('same-period same-inventory formal market parity', () => {
  it.each([2, 3])('matches AI and map weighted metrics for Q%i without fallback or mixed quarters', quarter => {
    const snapshot = fixture({year: 2026, quarter});
    const buildings = snapshot.rows.map(row => ({
      id: row.id, name: row.name, grade: 'A',
      metrics: [{ record_year: 2026, record_quarter: quarter, is_locked: true, is_draft: false,
        total_area: row.facts.totalArea?.sources[0].rawValue,
        vacant_area: row.facts.vacantArea?.sources[0].rawValue,
        net_effective_rent: row.facts.netEffectiveRent?.sources[0].rawValue }],
    }));
    const map = aggregateMarket(buildings, 'quarterly_market');
    const rent = aggregateQuarter(snapshot, 'rent'), vacancy = aggregateQuarter(snapshot, 'vacancy');
    expect(rent.value?.numeric).toBeCloseTo(map.rent!, 10);
    expect(rent.coverage.valid).toBe(map.rentSampleCount);
    expect(rent.denominator.numeric).toBe(map.rentSampleArea);
    expect(vacancy.value!.numeric * 100).toBeCloseTo(map.vacancyPct!, 10);
    expect(vacancy.coverage.valid).toBe(map.vacancySampleCount);
    expect(vacancy.denominator.numeric).toBe(map.vacancySampleArea);
  });
});
