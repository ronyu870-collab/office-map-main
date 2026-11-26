import { computeDebugStats } from '@/src/utils/debugStats';
import { describe, expect, it } from 'vitest';
import { MapDataStore } from './MapDataStore';
import { createDefaultFilterState } from './mapDomain';
import { officeGrade, mostRecentMarketMetric, submarketSummary } from './submarketOverview';
import { summarizeSubmarketTrend } from './submarketTrendDigest';
import type { BuildingWithMetrics } from '@/src/types';
import type { SubmarketTrendPoint } from './submarketMarketTrend';

import { aggregateMarket, aggregateFutureSupply } from './marketStatistics';
import { latestFormalMetric } from './quarterlyFacts';
import { computeSubmarketTrends } from './submarketMarketTrend';
import { normalizeMapSubmarket, submarketDatabaseNames } from './marketIdentity';
import { LEGACY_RENT_REFERENCES } from '../runtime/mapSubmarketOverview';

describe('market foundation defect regressions', () => {
  it('keeps Chinese Gold LEED in the default universe and explicit Gold selection', () => {
    const buildings = [{ id: 'synthetic-gold', name: '合成楼宇', grade: 'A', district: '朝阳区',
      submarket: 'CBD', leed_certification: '金级', location_lng: null, location_lat: null, metrics: [] }] as unknown as BuildingWithMetrics[];
    const store = new MapDataStore(buildings);
    const filterState = createDefaultFilterState();
    expect(store.filter({ filterState, compareGroups: [], role: 'viewer' })).toHaveLength(1);
    filterState.leeds = ['Gold'];
    const filtered = store.filter({ filterState, compareGroups: [], role: 'viewer' });
    expect(submarketSummary(filtered, 'CBD').officeCount).toBe(1);
  });

  it('does not guess grades from arbitrary letters', () => {
    for (const grade of ['APARTMENT', 'BUSINESS', 'SHOP', 'UNKNOWN PARK']) expect(officeGrade(grade)).toBe('other');
  });

  it('uses the locked formal record rather than a later draft or unreviewed candidate', () => {
    const formal = { id: '1', record_year: 2026, record_quarter: 2, is_locked: true, is_draft: false, net_effective_rent: 100 };
    expect(mostRecentMarketMetric([formal,
      { ...formal, id: '2', record_quarter: 3, is_draft: true },
      { ...formal, id: '3', record_quarter: 3, is_locked: false },
    ])).toBe(formal);
  });

  it('does not call a gap in quarters a quarter-on-quarter change', () => {
    const point = (quarter: number, rent: number) => ({ year: 2026, quarter, period: `2026Q${quarter}`, rent,
      vacancyPct: 0, rentSamples: 3, vacancySamples: 3, rentArea: 100, vacancyArea: 100 }) as SubmarketTrendPoint;
    expect(summarizeSubmarketTrend([point(1, 100), point(3, 120)]).rentChange).toBeNull();
  });
});



const published = (extra: Record<string, unknown> = {}) => ({ id: '1', is_locked: true, is_draft: false,
  record_year: 2026, record_quarter: 2, total_area: 100, net_effective_rent: 100, vacant_area: 0, ...extra });

describe('published market contract', () => {
  it('orders same-quarter versions by update time then stable numeric ID, independently of input order', () => {
    const older = published({ id: '9', updated_at: '2026-08-01T00:00:00Z' });
    const newer = published({ id: '10', updated_at: '2026-08-01T00:00:00Z' });
    const updated = published({ id: '8', updated_at: '2026-08-02T00:00:00Z' });
    expect(latestFormalMetric([newer, older])).toBe(newer);
    expect(latestFormalMetric([older, updated, newer])).toBe(updated);
    expect(latestFormalMetric([published({ is_locked: false }), published({ is_locked: null })])).toBeNull();
  });

  it('retains Q2 observation identity when the Q3 candidate is not published', () => {
    const result = aggregateMarket([{ id: 'one', metrics: [published(), published({ record_quarter: 3, is_locked: false, net_effective_rent: 999 })] }]);
    expect(result.periods).toEqual({ '2026Q2': 1 });
    expect(result.rent).toBe(100);
  });

  it('separates real zero, missing samples, total stock and each weighted denominator', () => {
    const result = aggregateMarket([
      { id: 'zero', metrics: [published({ net_effective_rent: 0 })] },
      { id: 'missing', metrics: [published({ total_area: 200, net_effective_rent: '', vacant_area: null, vacancy_rate: null })] },
      { id: 'rent', metrics: [published({ net_effective_rent: 300, vacant_area: null, vacancy_rate: null })] },
      { id: 'area-missing', metrics: [published({ total_area: null, net_effective_rent: 900 })] },
    ]);
    expect(result.stockArea).toBe(400);
    expect(result.rent).toBe(150);
    expect(result.rentSampleArea).toBe(200);
    expect(result.vacancyPct).toBe(0);
    expect(result.vacancySampleArea).toBe(100);
    expect(result.rentCoverage).toEqual({ count: .5, area: .5 });
    expect(result.vacancyCoverage).toEqual({ count: .25, area: .25 });
  });

  it('keeps diagnostic denominators equal to the market engine for zero and unknown observations', () => {
    const buildings = [
      { id: 'zero', metrics: [published({ net_effective_rent: 0, vacant_area: null, vacancy_rate: 0 })] },
      { id: 'unknown', metrics: [published({ net_effective_rent: null, vacant_area: null, vacancy_rate: null })] },
      { id: 'valid', metrics: [published({ net_effective_rent: 300, vacant_area: 30 })] },
    ] as unknown as BuildingWithMetrics[];
    const market = aggregateMarket(buildings), debug = computeDebugStats(buildings);
    expect(debug.weightedRent.result).toBe(market.rent);
    expect(debug.weightedRent.denominator).toBe(market.rentSampleArea);
    expect(debug.vacancyRate.result).toBe(market.vacancyPct! / 100);
    expect(debug.vacancyRate.denominator).toBe(market.vacancySampleArea);
    expect(debug.vacancyRate.excludedCount).toBe(1);
  });

  it('keeps future and pending supply separate from stock and preserves unknown area', () => {
    const result = aggregateFutureSupply([
      { id: 'future', total_area: 300 }, { id: 'unknown', total_area: null },
      { id: 'entered', total_area: 999, is_entered_market: true }, { id: 'pending', total_area: 999, status: 'pending' },
    ]);
    expect(result).toMatchObject({ scope: 'future_supply', count: 2, area: 300, areaSamples: 1 });
    expect(LEGACY_RENT_REFERENCES.every(row => !row.allowAggregation && !row.allowDisplay && row.asOf === null)).toBe(true);
  });

  it.each(['玉渊潭', '四季青', '通惠河传媒走廊', '上地', '北清路', '丰台科技园'])('retains the canonical identity of %s', name => {
    expect(normalizeMapSubmarket(name)).toBe(name);
  });
  it('shares historical aliases across filters and research reads', () => {
    for (const name of ['望京酒仙桥', '望京—酒仙桥', '望京/酒仙桥']) {
      expect(normalizeMapSubmarket(name)).toBe('望京-酒仙桥');
      expect(submarketDatabaseNames('望京-酒仙桥')).toContain(name);
    }
    expect(normalizeMapSubmarket('北京经济技术开发区')).toBe('亦庄');
  });

  it('publishes independent indicator periods, sample changes, and same-sample changes', () => {
    const buildings = [{ id: 'a', grade: 'A' }, { id: 'b', grade: 'B' }, { id: 'new', grade: 'A' }];
    const rows = [
      { building_id: 'a', ...published({ record_quarter: 1, net_effective_rent: 100 }) },
      { building_id: 'b', ...published({ record_quarter: 1, net_effective_rent: 200 }) },
      { building_id: 'a', ...published({ net_effective_rent: 110 }) },
      { building_id: 'b', ...published({ net_effective_rent: 220 }) },
      { building_id: 'new', ...published({ net_effective_rent: 900 }) },
      { building_id: 'a', ...published({ record_quarter: 3, net_effective_rent: null }) },
    ];
    const series = computeSubmarketTrends(buildings, rows).all;
    expect(series.at(-2)?.sameSampleQoq?.rent).toMatchObject({ samples: 2, rentPct: expect.closeTo(10) });
    expect(series.at(-2)?.sampleChanged?.rent).toBe(true);
    expect(series.at(-1)?.sameSampleQoq?.rent.rentPct).toBeNull();
    const digest = summarizeSubmarketTrend(series);
    expect(digest.latestRent?.period).toBe('2026Q2');
    expect(digest.latestVacancy?.period).toBe('2026Q3');
  });

  it('retains the same permissions through indexed filtering and performs no reads during filtering', () => {
    const store = new MapDataStore([{ id: 'synthetic', name: '合成', grade: 'BP', submarket: '亦庄经济开发区', district: '大兴区', metrics: [] }] as unknown as BuildingWithMetrics[]);
    const filterState = createDefaultFilterState(); filterState.submarkets = ['亦庄'];
    for (const role of ['viewer', 'editor', 'admin']) {
      const rows = store.filter({ filterState, compareGroups: [], role });
      expect(rows).toHaveLength(1);
      expect(submarketSummary(rows, '亦庄')).toMatchObject({ officeCount: 0, parkCount: 1 });
    }
    expect(store.filter({ filterState, compareGroups: [], role: 'unknown' })).toEqual([]);
  });
});


describe('first-screen calculation cost', () => {
  it('filters and aggregates a 2,000-project snapshot without history reads', () => {
    const buildings = Array.from({ length: 2000 }, (_, index) => ({ id: `perf-${index}`, name: `合成 ${index}`, grade: index % 2 ? 'A' : 'BP',
      district: '朝阳区', submarket: 'CBD', leed_certification: '金级', metrics: [published()] })) as unknown as BuildingWithMetrics[];
    const start = performance.now();
    const store = new MapDataStore(buildings);
    const rows = store.filter({ filterState: createDefaultFilterState(), compareGroups: [], role: 'viewer' });
    const summary = submarketSummary(rows, 'CBD');
    expect(summary).toMatchObject({ officeCount: 1000, parkCount: 1000, mappableCount: 0, rent: 100 });
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
