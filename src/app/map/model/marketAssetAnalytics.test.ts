import { describe, expect, it } from 'vitest';
import { analyzeMarketAssets, rentDistribution, summarizeResearchDemand, summarizeResearchSupply, type ResearchLease } from './marketAssetAnalytics';
import type { MarketBuilding, MarketMetric } from './marketStatistics';

const period = 2026 * 4 + 1;
const metric = (rent: number, area: number, vacant: number | null, extra: Partial<MarketMetric> = {}): MarketMetric =>
  ({ record_year: 2026, record_quarter: 2, is_locked: true, is_draft: false, net_effective_rent: rent, total_area: area, vacant_area: vacant, ...extra });
const building = (id: string, grade: string, metrics: MarketMetric[]): MarketBuilding => ({ id, name: id, submarket: 'CBD', grade, metrics });

describe('market asset research', () => {
  it('uses one formal version in one quarter, includes unmappable assets and separates weighted mean from building median', () => {
    const rows = [
      building('a', 'P', [metric(100, 100, 0), metric(999, 100, 50, { record_quarter: 3 }), metric(555, 100, 0, { is_draft: true })]),
      building('b', 'A', [metric(200, 900, 90), metric(888, 900, 90, { is_locked: false })]),
      building('c', 'A', [metric(0, 100, 10)]),
      building('d', 'BP', [metric(80, 500, 30)]),
      building('e', 'A', [metric(300, 100, null, { vacancy_rate: .1 })]),
    ];
    const result = analyzeMarketAssets([...rows, rows[0]], 'CBD', period, 'a');
    expect(result.statistics.projectCount).toBe(4);
    expect(result.statistics.rentSampleCount).toBe(3);
    expect(result.distribution?.median).toBe(200);
    expect(result.statistics.rent).toBe(200);
    expect(result.paired.map(p => p.id)).toEqual(['a', 'b']);
    expect(result.paired[0].vacancy).toBe(0);
    expect(analyzeMarketAssets(rows, 'CBD', period, 'park').statistics.rent).toBe(80);
    const weighted = analyzeMarketAssets(rows.slice(0, 2), 'CBD', period, 'a');
    expect(weighted.statistics.rent).toBe(190);
    expect(weighted.distribution?.median).toBe(150);
  });
  it('keeps small samples as real points and assigns every larger sample to exactly one bin', () => {
    const points = Array.from({ length: 15 }, (_, i) => ({ id: String(i), name: String(i), grade: 'a' as const, area: 100, rent: 50 + i * 10, vacancy: 0 }));
    expect(rentDistribution(points.slice(0, 3))?.bins).toEqual([]);
    const distribution = rentDistribution(points)!;
    expect(distribution.bins.length).toBeGreaterThan(1);
    expect(distribution.bins.flatMap(b => b.ids).sort()).toEqual(points.map(p => p.id).sort());
    expect(distribution.median).toBe(120);
  });
  it('does not assign unknown dates or cancelled, entered or pending supplies to forecast years', () => {
    const base = { submarket: 'CBD', status: 'future', grade: 'A', is_entered_market: false };
    const data = summarizeResearchSupply([{ ...base, id: '1', launch_year: 2027, total_area: 200 },
      { ...base, id: '2', launch_year: null }, { ...base, id: '3', status: 'pending' },
      { ...base, id: '4', status: 'cancelled' }, { ...base, id: '5', is_entered_market: true }], 'CBD');
    expect(data.count).toBe(2); expect(data.area).toBe(200); expect(data.years.map(row => row.label)).toEqual(['2027', '待定']);
  });
  it('excludes history, unknown identity, duplicate live records and insufficient category disclosure', () => {
    const row: ResearchLease = { record_source: 'live', quality_status: 'OPERATIONAL', building_match_scope: 'exact',
      source_record_id: '1', building_id: 'a', transaction_year: 2026, transaction_quarter: 'Q2', area_sqm: 100, industry: '金融' };
    const data = summarizeResearchDemand([row, row, { ...row, source_record_id: '2' }, { ...row, source_record_id: '3', industry: null },
      { ...row, source_record_id: '4', record_source: 'history' }, { ...row, source_record_id: '5', building_id: 'outside' }], new Set(['a']), 2026);
    expect(data?.count).toBe(3); expect(data?.area).toBe(300); expect(data?.industries).toEqual([]);
    expect(summarizeResearchDemand([row], new Set(['a']), 2026)).toBeNull();
  });
});
