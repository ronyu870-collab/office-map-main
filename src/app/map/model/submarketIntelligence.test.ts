/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { MAP_SUBMARKETS, MAP_SUBMARKETS_SECONDARY } from './mapDomain';
import { readSubmarketIntelligence, submarketIntelligenceSchema, type SubmarketIntelligence } from './submarketIntelligence';
import { readSubmarketProfileRow } from './submarketProfile';
import { publicBriefReviewErrors, visibleSubmarketProfile } from './submarketPublication';
import { computeSubmarketTrends } from './submarketMarketTrend';
import { submarketResearchSignal } from './submarketResearchSignal';

const edition = Object.values(import.meta.glob('../../../../data/submarket-research/2026-11-27/*.json',
  { eager: true, import: 'default' })).map(entry => submarketIntelligenceSchema.parse(entry));
const cbd = edition.find(item => item.market === 'CBD')!;
const lize = edition.find(item => item.market === '丽泽')!;

describe('structured submarket research edition', () => {
  it('covers every named map market with a valid public profile and preserves scope', () => {
    expect(edition.map(item => item.market).sort()).toEqual([...MAP_SUBMARKETS, ...MAP_SUBMARKETS_SECONDARY].filter(market => market !== '其他').sort());
    for (const research of edition) {
      const profile = readSubmarketProfileRow({ headline: '内部核验材料', research }, research.market);
      expect(visibleSubmarketProfile(profile, true)).toMatchObject({ overview: '', headline: research.positioning, research });
      expect(visibleSubmarketProfile(profile, false).research).toBeUndefined();
    }
    expect(readSubmarketIntelligence(cbd, '丽泽')).toBeNull();
  });

  it('rejects dangling citations, unsupported figures, future verification and invalid links', () => {
    const invalid = (patch: Partial<SubmarketIntelligence>) => submarketIntelligenceSchema.safeParse({ ...cbd, ...patch }).success;
    const [head, ...rest] = cbd.facts;
    expect(invalid({ facts: [{ ...head, sourceIds: ['wrong'] }, ...rest] })).toBe(false);
    expect(invalid({ facts: [{ ...head, measure: { value: '987654', unit: '家' } }, ...rest] })).toBe(false);
    expect(invalid({ facts: [{ ...head, status: 'planned' }, ...rest] })).toBe(false);
    const [first, ...sources] = cbd.sources;
    expect(invalid({ sources: [{ ...first, verifiedOn: '2027-01-01' }, ...sources] })).toBe(false);
    expect(invalid({ sources: [{ ...first, url: 'anything' }, ...sources] })).toBe(false);
    expect(invalid({ sources: [{ ...first, url: 'https://app.example.com/private?token=private' }, ...sources] })).toBe(false);
    const profile = readSubmarketProfileRow({ research: { ...cbd, positioning: '客户草稿' } }, 'CBD');
    expect(publicBriefReviewErrors(profile)).toHaveLength(1);
    expect(visibleSubmarketProfile(profile, true).research).toBeUndefined();
    expect(submarketIntelligenceSchema.safeParse(lize).success).toBe(true);
  });
});

describe('quarterly research signal', () => {
  const buildings = [{ id: 'a', grade: 'P' }, { id: 'b', grade: 'A' }, { id: 'c', grade: 'B' }, { id: 'd', grade: 'B' }];
  const rows = [1, 2].flatMap(quarter => buildings.map(({ id }, index) => ({
    building_id: id, record_year: 2026, record_quarter: quarter, total_area: 250, is_locked: true,
    net_effective_rent: (200 - index * 30) * (quarter === 2 ? 0.9 : 1),
    // Formal quarter observations require recorded physical vacancy area.
    vacant_area: 25 + quarter * 2.5,
    vacancy_rate: 0.1 + quarter * 0.01,
  })));
  it('recomputes weighted gaps and same-cohort changes after the next quarter is formally released', () => {
    const pending = { ...rows[0], record_quarter: 3, net_effective_rent: 999, is_locked: false };
    const trend = computeSubmarketTrends(buildings, [...rows, pending]);
    expect(submarketResearchSignal('grade-rent', trend, 'ready')?.text).toContain('2026Q2 甲级减乙级 +54');
    expect(submarketResearchSignal('matched-rent', trend, 'ready')?.text).toContain('2026Q2 -10%');
    expect(trend.all.at(-1)).toMatchObject({ vacancyPct: 12, vacancySamples: 4, vacancyArea: 1000 });
    expect(submarketResearchSignal('matched-vacancy', trend, 'ready')?.text).toContain('2026Q2 +1 个百分点');
    const release = computeSubmarketTrends(buildings, [...rows, ...rows.slice(4).map(row => ({ ...row, record_quarter: 3 }))]);
    expect(submarketResearchSignal('matched-rent', release, 'ready')?.text).toContain('2026Q3 0%');
    expect(submarketResearchSignal('matched-rent', release, 'error')).toBeNull();
  });

  it('excludes rate-only observations from formal same-cohort vacancy signals', () => {
    const rateOnly = computeSubmarketTrends(buildings, rows.map(row => ({ ...row, vacant_area: null })));
    expect(rateOnly.all.at(-1)).toMatchObject({ vacancyPct: null, vacancySamples: 0, vacancyArea: 0 });
    expect(submarketResearchSignal('matched-vacancy', rateOnly, 'ready')?.text).toContain('缺少连续两季的可比项目');
    // The rent cohort is still valid; missing vacancy never excludes a valid rent observation.
    expect(submarketResearchSignal('matched-rent', rateOnly, 'ready')?.text).toContain('2026Q2 -10%');
  });

  it('avoids using an earlier period, a single building or a filtered office proxy', () => {
    const sparse = computeSubmarketTrends(buildings, [...rows, { ...rows[0], record_quarter: 3 }]);
    expect(submarketResearchSignal('grade-rent', sparse, 'ready')?.text).toContain('缺少足够');
    expect(submarketResearchSignal('matched-rent', sparse, 'ready')?.text).toContain('缺少连续两季');
    expect(submarketResearchSignal('stock', sparse, 'ready')).toBeNull();
  });
});
