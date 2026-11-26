import { describe, expect, it } from 'vitest';
import type { BuildingWithMetrics } from '@/src/types';
import { MapDataStore } from './MapDataStore';
import { createDefaultFilterState, getBeijingBenchmarkFilters } from './mapDomain';
import type { MarketBuilding, MarketMetric } from './marketStatistics';
import { computeSubmarketTrends, type TrendMetricRow } from './submarketMarketTrend';
import { submarketSummary } from './submarketOverview';
import {
  describeCurrentResearchMarket, describeQuarterlyResearchMarket, signedResearchNumber, submarketResearchObservation,
} from './submarketResearch';

const fact = (year: number, quarter: number, rent: number | null, vacancy: number | null, area = 100) => ({
  is_locked: true, record_year: year, record_quarter: quarter,
  net_effective_rent: rent, vacancy_rate: vacancy, total_area: area,
});
const building = (id: string, submarket: string, metric: MarketMetric, grade = 'A'): MarketBuilding => ({ id, submarket, grade, metrics: [metric] });
const cohort = [
  building('a', 'CBD', fact(2026, 2, 0, null), 'P'),
  building('b', 'CBD', fact(2026, 2, 300, null, 200), 'B'),
  building('c', 'CBD', fact(2026, 1, null, 0)),
  building('d', 'CBD', fact(2026, 1, null, 0.2), 'B'),
  building('e', '金融街', fact(2026, 2, 400, null, 100)),
  building('f', '金融街', fact(2026, 1, null, 0.4)),
  building('park', '望京', fact(2025, 4, 500, 0.8), 'BP'),
  building('invalid', '望京', fact(2025, 4, 500, 0.8, 0)),
];

describe('qualifying a same-quarter Beijing benchmark', () => {
  const local = cohort.filter(item => item.submarket === 'CBD');

  it('uses metric-specific formal periods, eligible A/B observations and independent area weighting', () => {
    const current = describeCurrentResearchMarket('CBD', local, cohort);
    expect(current).toEqual({
      rent: { periods: ['2026Q2'], benchmark: { period: '2026Q2', cityValue: 250, difference: -50 } },
      vacancyPct: { periods: ['2026Q1'], benchmark: { period: '2026Q1', cityValue: 20, difference: -10 } },
    });
    expect(submarketResearchObservation('CBD', submarketSummary(cohort, 'CBD'), current, null)).toMatch(/2026Q2.*净有效租金低于.*2026Q1.*空置率低于/);
  });

  it('removes only the research submarket selection and never feeds city projects to the local KPI', () => {
    const original = createDefaultFilterState();
    const current = { ...original, submarkets: ['CBD'], projectTypes: ['甲级写字楼'] };
    const store = new MapDataStore([
      building('local1', 'CBD', fact(2026, 2, 100, 0.1)),
      building('local2', 'CBD', fact(2026, 2, 300, 0.3), 'P'),
      building('outside', '金融街', fact(2026, 2, 500, 0.5)),
      building('filtered-out', '金融街', fact(2026, 1, 900, 0.9), 'B'),
    ].map(row => ({ ...row, district: row.submarket === 'CBD' ? '朝阳区' : '西城区' })) as BuildingWithMetrics[]);
    const filter = (filterState: typeof current) => store.filter({ filterState, compareGroups: [] });
    const localRows = filter(current);
    const benchmark = getBeijingBenchmarkFilters(current, original, 'CBD');
    expect(benchmark).toBeDefined();
    const cityRows = filter(benchmark!);
    expect(localRows.map(row => row.id)).toEqual(['local1', 'local2']);
    expect(cityRows.map(row => row.id)).toEqual(['local1', 'local2', 'outside']);
    expect(describeCurrentResearchMarket('CBD', localRows, cityRows).rent.benchmark?.cityValue).toBe(300);
    expect(submarketSummary(localRows, 'CBD').officeCount).toBe(2);
    expect(getBeijingBenchmarkFilters(current, { ...original, submarkets: ['CBD', '金融街'] }, 'CBD')).toBeUndefined();
  });

  it('withholds implicit or self-only comparison, also when another submarket has no valid metric', () => {
    expect(describeCurrentResearchMarket('CBD', cohort).rent.benchmark).toBeNull();
    const invalidOutsiders = [
      building('no-submarket', '', fact(2026, 2, 400, null)),
      building('other', '其他-未分类', fact(2026, 2, 400, null)),
      building('other-valid-vacancy', '金融街', fact(2026, 2, null, 0.2)),
    ];
    expect(describeCurrentResearchMarket('CBD', local, local).rent.benchmark).toBeNull();
    const self = describeCurrentResearchMarket('cbd', local, [...local, ...invalidOutsiders]);
    expect(self.rent).toEqual({ periods: ['2026Q2'], benchmark: null });
    expect(self.vacancyPct.benchmark).toBeNull();
  });

  it('rejects a mixed city period per metric or a single local sample; does not use a draft or older formal row to fill missing', () => {
    const mixed = describeCurrentResearchMarket('CBD', local, [...cohort, building('g', '其他板块', fact(2026, 1, 200, null))]);
    expect(mixed.rent).toEqual({ periods: ['2026Q2'], benchmark: null });
    expect(mixed.vacancyPct.benchmark?.period).toBe('2026Q1');
    const localSingle = [
      ...local.filter(b => b.id !== 'a'),
      { id: 'a', submarket: 'CBD', grade: 'P', metrics: [fact(2026, 1, 300, null), fact(2026, 2, null, null), { ...fact(2026, 3, 400, null), is_draft: true }] },
    ];
    expect(describeCurrentResearchMarket('CBD', localSingle, cohort).rent).toEqual({ periods: ['2026Q2'], benchmark: null });
    const localMixed = [...local, building('g', 'CBD', fact(2026, 1, 300, null))];
    expect(describeCurrentResearchMarket('CBD', localMixed, cohort).rent).toEqual({ periods: ['2026Q1', '2026Q2'], benchmark: null });
  });
});

describe('quarterly observations', () => {
  const offices = [{ id: 'a', grade: 'A' }, { id: 'b', grade: 'B' }];
  // Formal historical observations use recorded physical vacant area, not the
  // legacy rate-only estimate used by the current-market fixture above.
  const rows = (observation: ReturnType<typeof fact>): TrendMetricRow[] => offices.map(({ id }) => ({
    building_id: id, ...observation,
    vacant_area: observation.vacancy_rate === null ? null : observation.total_area * observation.vacancy_rate,
  }));

  it('keeps independent latest periods and requires the real preceding quarter and year', () => {
    const points = computeSubmarketTrends(offices, [
      ...rows(fact(2025, 2, 100, null)), ...rows(fact(2025, 3, null, 0.22)),
      ...rows(fact(2026, 1, 120, 0.15)), ...rows(fact(2026, 2, 150, 0.2)), ...rows(fact(2026, 3, null, 0.25)),
    ]).all;
    const quarterly = describeQuarterlyResearchMarket(points);
    expect(quarterly.rent.latest?.period).toBe('2026Q2');
    expect(quarterly.rent.qoqAbsolute).toBe(30);
    expect(quarterly.rent.qoqPct).toBe(25);
    expect(quarterly.rent.yoyPct).toBeCloseTo(50);
    expect(quarterly.vacancy.latest?.period).toBe('2026Q3');
    expect(quarterly.vacancy.qoqPp).toBe(5);
    expect(quarterly.vacancy.yoyPp).toBeCloseTo(3);
    expect(submarketResearchObservation('CBD', submarketSummary(cohort, 'CBD'), describeCurrentResearchMarket('CBD', cohort), quarterly)).toBe('当前筛选的甲乙级项目中，甲级按项目数占 50.0%。');
  });

  it('describes two real same-quarter moves but never supplies changes across a gap or with one effective sample', () => {
    const current = describeCurrentResearchMarket('CBD', cohort);
    const summary = submarketSummary(cohort, 'CBD');
    const points = computeSubmarketTrends(offices, [
      ...rows(fact(2025, 4, 200, 0.10)), ...rows(fact(2026, 1, 150, 0.15)),
    ]).all;
    expect(submarketResearchObservation('CBD', summary, current, describeQuarterlyResearchMarket(points)))
      .toBe('2026Q1 完整甲乙级子市场的净有效租金环比下降，空置率环比上升。');
    const sparse = describeQuarterlyResearchMarket(computeSubmarketTrends(offices, [
      ...rows(fact(2025, 4, 200, 0.10)), ...rows(fact(2026, 1, 150, 0.15)).slice(0, 1), ...rows(fact(2026, 3, 0, 0)),
    ]).all);
    expect(sparse.vacancy.qoqPp).toBeNull();
    expect(sparse.rent.qoqAbsolute).toBeNull();
    const single = describeQuarterlyResearchMarket(computeSubmarketTrends(offices, [
      ...rows(fact(2025, 4, 200, 0.10)), ...rows(fact(2026, 1, 150, 0.15)).slice(0, 1),
    ]).all);
    expect(single.rent.latest?.rentSamples).toBe(1);
    expect(single.rent.qoqPct).toBeNull();
    expect(signedResearchNumber(-0.01)).toBe('0.0');
  });
});
