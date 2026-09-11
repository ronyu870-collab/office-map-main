import { describe, expect, it } from 'vitest';

import type { ParsedRequirement } from '../requirementSchema';
import {
  normalizeRequirementAgainstVocabulary,
  resolveRequirementCapabilities,
} from '../requirementResolver';

const base: ParsedRequirement = {
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
};

describe('requirementResolver', () => {
  it('drops hallucinated normalized values that are not in the database vocabulary', () => {
    const normalized = normalizeRequirementAgainstVocabulary({
      ...base,
      locations: [{
        raw: '望京',
        kind: 'submarket',
        normalizedDistrict: '朝阳区',
        normalizedSubmarket: '不存在的商圈',
      }],
      grades: ['A', '不存在的等级'],
    }, {
      districts: ['朝阳区'],
      submarkets: ['望京-酒仙桥'],
      grades: ['A'],
    });

    expect(normalized.locations[0].normalizedDistrict).toBe('朝阳区');
    expect(normalized.locations[0].normalizedSubmarket).toBeNull();
    expect(normalized.grades).toEqual(['A']);
    expect(normalized.unresolved).toContain('不存在的等级');
  });

  it('never treats desired unit area or move-in month as live filters without supporting data', () => {
    const capabilities = resolveRequirementCapabilities({
      ...base,
      area: { minSqm: 800, maxSqm: 1200 },
      moveInMonth: '2026-11',
      rent: { minDailyRmbSqm: null, maxDailyRmbSqm: 7, basis: 'unspecified' },
    }, { latestMetricPeriod: '2026 Q2' });

    expect(capabilities.find(item => item.key === 'area')?.status).toBe('unsupported');
    expect(capabilities.find(item => item.key === 'moveIn')?.status).toBe('unsupported');
    expect(capabilities.find(item => item.key === 'rent')?.status).toBe('partial');
    expect(capabilities.find(item => item.key === 'rent')?.dataBasis).toContain('2026 Q2');
  });
});
