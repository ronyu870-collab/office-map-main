import { describe, expect, it } from 'vitest';
import { officeGrade, submarketSummary, summarizeSubmarkets } from './submarketOverview';
import { computeSubmarketTrends } from './submarketMarketTrend';
import { emptySubmarketProfile, submarketProfileSchema } from './submarketProfile';

describe('submarket office inventory and summary', () => {
  const buildings = [
    { id: 'a', submarket: 'CBD', grade: 'A', metrics: [{ is_locked: true, is_draft: false, record_year: 2026, record_quarter: 3, total_area: 100, net_effective_rent: 100, vacancy_rate: .1 }] },
    { id: 'b', submarket: 'CBD', grade: 'B', metrics: [{ is_locked: true, is_draft: false, record_year: 2026, record_quarter: 3, total_area: 300, net_effective_rent: 200, vacancy_rate: .3 }] },
    { id: 'p', submarket: 'CBD', grade: 'P', metrics: [{ is_locked: true, is_draft: false, record_year: 2026, record_quarter: 3, total_area: 200, net_effective_rent: 150, vacant_area: 0 }] },
    { id: 'bp', submarket: 'CBD', grade: 'BP', metrics: [{ is_locked: true, is_draft: false, record_year: 2026, record_quarter: 3, total_area: 400, net_effective_rent: 999, vacancy_rate: .9 }] },
    { id: 'n', submarket: 'CBD', grade: 'UNKNOWN', metrics: [] },
    { id: 'null-rent', submarket: 'CBD', grade: 'B', metrics: [{ is_locked: true, is_draft: false, record_year: 2026, record_quarter: 3, total_area: 100, net_effective_rent: null, vacancy_rate: 0 }] },
    { id: 'a', submarket: 'CBD', grade: 'A', metrics: [] },
  ];

  it('excludes industrial parks and unknown grades from A/B count, including duplicates', () => {
    expect(officeGrade('BP')).toBe('park');
    expect(officeGrade('P')).toBe('a');
    const result = submarketSummary(buildings, 'CBD');
    expect(result.officeCount).toBe(4);
    expect(result.gradeACount).toBe(2);
    expect(result.gradeBCount).toBe(2);
    expect(result.parkCount).toBe(1);
  });

  it('weights rent and vacancy by their own valid area samples and preserves real zero vacancy', () => {
    const result = submarketSummary(buildings, 'CBD');
    expect(result.rent).toBeCloseTo((100 * 100 + 200 * 300 + 150 * 200) / 600);
    expect(result.vacancyPct).toBeCloseTo((10 + 90 + 0 + 0) / 700 * 100);
    expect(result.rentSampleCount).toBe(3);
    expect(result.vacancySampleCount).toBe(4);
  });

  it('normalizes an area alias and counts records without map coordinates', () => {
    const result = summarizeSubmarkets([
      { id: 'x', submarket: '望京酒仙桥', grade: 'A' },
      { id: 'y', submarket: '望京-酒仙桥', grade: 'B' },
    ]);
    expect(result.get('望京-酒仙桥')?.officeCount).toBe(2);
  });

  it('never converts missing market metrics into zero', () => {
    const result = submarketSummary([{ id: 'one', submarket: '丽泽', grade: 'A', metrics: [] }], '丽泽');
    expect(result.rent).toBeNull();
    expect(result.vacancyPct).toBeNull();
  });
});

describe('same-quarter historical trends', () => {
  const members = [
    { id: 'a', grade: 'A' }, { id: 'b', grade: 'B' }, { id: 'park', grade: 'BP' },
  ];
  const rows = [
    { building_id: 'a', is_locked: true, is_draft: false, record_year: 2025, record_quarter: 1, total_area: 100, net_effective_rent: 100, vacancy_rate: .1 },
    { building_id: 'b', is_locked: true, is_draft: false, record_year: 2025, record_quarter: 1, total_area: 300, net_effective_rent: 200, vacancy_rate: .2 },
    { building_id: 'park', is_locked: true, is_draft: false, record_year: 2025, record_quarter: 1, total_area: 500, net_effective_rent: 1000, vacancy_rate: 1 },
    { building_id: 'a', is_locked: true, is_draft: false, record_year: 2025, record_quarter: 2, total_area: 100, net_effective_rent: 110, vacancy_rate: 0 },
    { building_id: 'b', is_locked: true, is_draft: false, record_year: 2025, record_quarter: 2, total_area: 300, net_effective_rent: 190, vacant_area: 60 },
    { building_id: 'a', is_locked: true, record_year: 2025, record_quarter: 3, total_area: 100, net_effective_rent: 0, is_draft: true },
  ];

  it('uses a single common quarterly axis, never joins different latest periods', () => {
    const trends = computeSubmarketTrends(members, rows, 8);
    expect(trends.all).toHaveLength(8);
    expect(trends.all.at(-1)?.period).toBe('2025Q2');
    expect(trends.all.at(-2)?.period).toBe('2025Q1');
    expect(trends.all.at(-2)?.rent).toBeCloseTo(175);
    expect(trends.all.at(-1)?.rent).toBeCloseTo(170);
    // Q1 has rate-only records. Q2's A-grade rate-only zero is not a
    // physical vacancy observation; only B's 60/300 qualifies formally.
    expect(trends.all.at(-2)).toMatchObject({ vacancyPct: null, vacancySamples: 0, vacancyArea: 0 });
    expect(trends.all.at(-1)).toMatchObject({ vacancyPct: 20, vacancySamples: 1, vacancyArea: 300 });
    expect(trends.all.at(-1)?.sameSampleQoq?.vacancy).toMatchObject({ samples: 0, vacancyPp: null });
  });

  it('separates A, B, excludes rate-only records and leaves missing quarters null', () => {
    const trends = computeSubmarketTrends(members, rows);
    expect(trends.a.at(-1)).toMatchObject({ vacancyPct: null, vacancySamples: 0, vacancyArea: 0 });
    expect(trends.b.at(-1)?.rent).toBe(190);
    expect(trends.all[0]?.rent).toBeNull();
    expect(trends.all[0]?.rentSamples).toBe(0);
  });

  it('preserves actual zero vacancy in formal quarterly statistics, even with a conflicting ratio', () => {
    const physicalRows = rows.map(row => row.building_id === 'a' && row.record_quarter === 2
      ? { ...row, vacant_area: 0, vacancy_rate: .5 } : row);
    const trends = computeSubmarketTrends(members, physicalRows);
    expect(trends.a.at(-1)).toMatchObject({ vacancyPct: 0, vacancySamples: 1, vacancyArea: 100 });
    expect(trends.all.at(-1)).toMatchObject({ vacancyPct: 15, vacancySamples: 2, vacancyArea: 400 });
  });

  it('returns no fake chart when only draft metrics exist', () => {
    expect(computeSubmarketTrends(members, [{ building_id: 'a', is_locked: true, record_year: 2026, record_quarter: 3, is_draft: true }]).all).toHaveLength(0);
  });
});

describe('editable market profile validation', () => {
  it('begins empty rather than inventing statistics or policies', () => {
    expect(submarketProfileSchema.parse(emptySubmarketProfile()).policies).toEqual([]);
  });
  it('refuses non-https source URLs', () => {
    const draft = emptySubmarketProfile();
    draft.demographics.push({ label: '常住人口', value: '100', unit: '万人', scope: '朝阳区', asOf: '2025年', sourceUrl: 'http://example.com' });
    expect(submarketProfileSchema.safeParse(draft).success).toBe(false);
  });
});
