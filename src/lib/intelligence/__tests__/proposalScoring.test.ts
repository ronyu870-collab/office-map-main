import { describe, expect, it } from 'vitest';

import type { ParsedRequirement, RequirementCapability } from '../requirementSchema';
import { scoreProposalCandidate, type ProposalCandidateData } from '../proposalScoring';

const parsed: ParsedRequirement = {
  city: '北京',
  locations: [{ raw: '望京', kind: 'submarket', normalizedDistrict: null, normalizedSubmarket: '望京-酒仙桥' }],
  area: { minSqm: 800, maxSqm: 1200 },
  rent: { minDailyRmbSqm: null, maxDailyRmbSqm: 7, basis: 'net_effective' },
  moveInMonth: '2026-11',
  grades: ['A'],
  metro: { preferred: true, maxDistanceMeters: null },
  greenCertifications: [],
  otherPreferences: [],
  unresolved: [],
};

const capabilities: RequirementCapability[] = [
  { key: 'location', label: '区域', value: '望京-酒仙桥', status: 'supported', explanation: '', dataBasis: 'buildings.submarket' },
  { key: 'rent', label: '预算', value: '≤7', status: 'supported', explanation: '', dataBasis: 'building_metrics' },
  { key: 'grade', label: '项目等级', value: 'A', status: 'partial', explanation: '', dataBasis: 'buildings.grade' },
  { key: 'area', label: '面积', value: '800–1200㎡', status: 'unsupported', explanation: '', dataBasis: null },
  { key: 'moveIn', label: '入住时间', value: '2026-11', status: 'unsupported', explanation: '', dataBasis: null },
  { key: 'metro', label: '交通', value: '地铁优先', status: 'partial', explanation: '', dataBasis: 'building_brochure_data.metro_access' },
];

const candidate: ProposalCandidateData = {
  id: 'b-1',
  name: '测试中心',
  district: '朝阳区',
  submarket: '望京-酒仙桥',
  grade: 'A',
  metricPeriod: '2026 Q2',
  metrics: { net_effective_rent: 200, asking_rent: 220, vacancy_rate: 0.12, management_fee: 30, total_area: 80000 },
  brochure: { address: '测试路1号', metro_access: '步行5分钟', standard_floor_area: 2000, property_management: '测试物业' },
};

describe('proposalScoring', () => {
  it('scores only the evaluable fact-backed capabilities supplied by the proposal context', () => {
    const result = scoreProposalCandidate(parsed, capabilities, candidate);
    expect(result.score).toBe(100);
    expect(result.checks.map(item => item.key)).toEqual(['location', 'rent', 'grade', 'metro']);
    expect(result.checks.map(item => item.key)).not.toContain('area');
    expect(result.checks.map(item => item.key)).not.toContain('moveIn');
  });

  it('uses the same A/P project-category semantics as the Map and recommendation engines', () => {
    const superPrime = { ...candidate, grade: 'P' };
    const result = scoreProposalCandidate(parsed, capabilities, superPrime);
    expect(result.checks.find(item => item.key === 'grade')?.passed).toBe(true);
    expect(result.score).toBe(100);
  });

  it('converts monthly rent to the customer daily-rent basis before testing budget', () => {
    const overBudget = {
      ...candidate,
      metrics: { ...candidate.metrics, net_effective_rent: 230 },
    };
    const result = scoreProposalCandidate(parsed, capabilities, overBudget);
    expect(result.checks.find(item => item.key === 'rent')?.passed).toBe(false);
    expect(result.score).toBe(63);
  });

  it('keeps data coverage separate from business match score', () => {
    const sparse = { ...candidate, brochure: null, metricPeriod: null };
    const result = scoreProposalCandidate(parsed, capabilities, sparse);
    expect(result.score).toBe(84);
    expect(result.dataConfidence).toBe(20);
  });
});