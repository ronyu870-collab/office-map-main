import { describe, expect, it } from 'vitest';

import type { RequirementParseResult } from '@/src/lib/intelligence/requirementSchema';
import {
  createIntelligenceMapHandoff,
  parseIntelligenceMapHandoff,
} from '../intelligenceMapHandoff';

const baseResult: RequirementParseResult = {
  parsed: {
    city: '北京',
    locations: [],
    area: { minSqm: null, maxSqm: null },
    rent: { minDailyRmbSqm: null, maxDailyRmbSqm: null, basis: 'unspecified' },
    moveInMonth: null,
    grades: [],
    metro: { preferred: false, maxDistanceMeters: null },
    greenCertifications: [],
    otherPreferences: [],
    unresolved: [],
  },
  capabilities: [],
  meta: { model: 'deepseek-v4-flash', durationMs: 100, inputTokens: 20, outputTokens: 40 },
};

function supported(key: 'location' | 'rent' | 'grade', label: string) {
  return { key, label, value: label, status: 'supported' as const, explanation: 'supported', dataBasis: 'test' };
}

describe('Intelligence map handoff', () => {
  it('maps supported submarket, grade and net-effective daily rent into existing Map filter semantics', () => {
    const handoff = createIntelligenceMapHandoff({
      ...baseResult,
      parsed: {
        ...baseResult.parsed,
        locations: [{ raw: '望京', kind: 'submarket', normalizedDistrict: null, normalizedSubmarket: '望京-酒仙桥' }],
        grades: ['A'],
        rent: { minDailyRmbSqm: null, maxDailyRmbSqm: 7, basis: 'net_effective' },
      },
      capabilities: [supported('location', '区域'), supported('grade', '项目等级'), supported('rent', '预算')],
    });

    expect(handoff.appliedCapabilities).toEqual(['location', 'grade', 'rent']);
    expect(handoff.filterState.submarkets).toEqual(['望京-酒仙桥']);
    expect(handoff.filterState.projectTypes).toEqual(['甲级写字楼']);
    expect(handoff.filterState.numericFilters).toEqual([
      expect.objectContaining({ field: 'net_effective_rent', operator: '<=', value: 212.9 }),
    ]);

    const parsed = parseIntelligenceMapHandoff(new URL(`https://example.com${handoff.href}`).searchParams);
    expect(parsed?.filterState.submarkets).toEqual(['望京-酒仙桥']);
    expect(parsed?.filterState.projectTypes).toEqual(['甲级写字楼']);
    expect(parsed?.filterState.numericFilters[0]?.value).toBe(212.9);
  });

  it('allows multiple natural-language location aliases to collapse to one canonical submarket', () => {
    const handoff = createIntelligenceMapHandoff({
      ...baseResult,
      parsed: {
        ...baseResult.parsed,
        locations: [
          { raw: '望京', kind: 'submarket', normalizedDistrict: null, normalizedSubmarket: '望京-酒仙桥' },
          { raw: '酒仙桥', kind: 'submarket', normalizedDistrict: null, normalizedSubmarket: '望京-酒仙桥' },
        ],
      },
      capabilities: [supported('location', '区域')],
    });

    expect(handoff.appliedCapabilities).toContain('location');
    expect(handoff.filterState.submarkets).toEqual(['望京-酒仙桥']);
  });

  it('does not apply mixed district/submarket alternatives because the current Map would turn the OR into an AND', () => {
    const handoff = createIntelligenceMapHandoff({
      ...baseResult,
      parsed: {
        ...baseResult.parsed,
        locations: [
          { raw: '朝阳区', kind: 'district', normalizedDistrict: '朝阳区', normalizedSubmarket: null },
          { raw: '金融街', kind: 'submarket', normalizedDistrict: null, normalizedSubmarket: '金融街' },
        ],
      },
      capabilities: [supported('location', '区域')],
    });

    expect(handoff.appliedCapabilities).not.toContain('location');
    expect(handoff.skippedCapabilities.find(item => item.key === 'location')?.reason).toContain('OR');
  });

  it('never applies partial or unsupported conditions to the map', () => {
    const handoff = createIntelligenceMapHandoff({
      ...baseResult,
      parsed: {
        ...baseResult.parsed,
        area: { minSqm: 800, maxSqm: 1200 },
        moveInMonth: '2026-11',
        rent: { minDailyRmbSqm: null, maxDailyRmbSqm: 7, basis: 'asking' },
      },
      capabilities: [
        { key: 'area', label: '面积', value: '800–1200㎡', status: 'unsupported', explanation: 'no data', dataBasis: null },
        { key: 'moveIn', label: '入住时间', value: '2026-11', status: 'unsupported', explanation: 'no data', dataBasis: null },
        { key: 'rent', label: '预算', value: '≤7', status: 'partial', explanation: 'asking rent mismatch', dataBasis: 'building_metrics' },
      ],
    });

    expect(handoff.appliedCapabilities).toEqual([]);
    expect(handoff.filterState.numericFilters).toEqual([]);
  });

  it('rejects malformed, contradictory, or partially tampered map query values instead of trusting URL input', () => {
    expect(parseIntelligenceMapHandoff(new URLSearchParams('source=intelligence&v=1&district=朝阳区&submarket=CBD'))).toBeNull();
    expect(parseIntelligenceMapHandoff(new URLSearchParams('source=intelligence&v=1&rentMinMonthly=300&rentMaxMonthly=200'))).toBeNull();
    expect(parseIntelligenceMapHandoff(new URLSearchParams('source=intelligence&v=1&submarket=不存在的商圈'))).toBeNull();
    expect(parseIntelligenceMapHandoff(new URLSearchParams('source=intelligence&v=1&submarket=CBD&submarket=不存在的商圈'))).toBeNull();
    expect(parseIntelligenceMapHandoff(new URLSearchParams('source=intelligence&v=1&submarket=CBD&rentMaxMonthly=not-a-number'))).toBeNull();
  });
});
