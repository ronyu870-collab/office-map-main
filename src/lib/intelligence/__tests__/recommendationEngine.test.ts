import { describe, expect, it } from 'vitest';

import type { RequirementParseResult } from '../requirementSchema';
import {
  buildRecommendationPlan,
  type RecommendationBuildingSource,
} from '../recommendationEngine';

const result: RequirementParseResult = {
  parsed: {
    city: '北京',
    locations: [
      { raw: '望京', kind: 'submarket', normalizedDistrict: '朝阳区', normalizedSubmarket: '望京-酒仙桥' },
      { raw: '酒仙桥', kind: 'submarket', normalizedDistrict: '朝阳区', normalizedSubmarket: '望京-酒仙桥' },
    ],
    area: { minSqm: 800, maxSqm: 1200 },
    rent: { minDailyRmbSqm: null, maxDailyRmbSqm: 7, basis: 'unspecified' },
    moveInMonth: '2026-11',
    grades: ['A'],
    metro: { preferred: true, maxDistanceMeters: null },
    greenCertifications: [],
    otherPreferences: [],
    unresolved: [],
  },
  capabilities: [
    { key: 'location', label: '区域', value: '望京-酒仙桥', status: 'supported', explanation: '', dataBasis: 'buildings.submarket' },
    { key: 'area', label: '面积', value: '800–1200㎡', status: 'unsupported', explanation: '', dataBasis: null },
    { key: 'rent', label: '预算', value: '≤7元/㎡/天', status: 'partial', explanation: '', dataBasis: 'building_metrics.net_effective_rent' },
    { key: 'moveIn', label: '入住时间', value: '2026-11', status: 'unsupported', explanation: '', dataBasis: null },
    { key: 'grade', label: '项目等级', value: 'A', status: 'supported', explanation: '', dataBasis: 'buildings.grade' },
    { key: 'metro', label: '交通', value: '地铁优先', status: 'partial', explanation: '', dataBasis: 'building_brochure_data.metro_access' },
  ],
  meta: { model: 'deepseek-v4-flash', durationMs: 800, inputTokens: 100, outputTokens: 100 },
};

function building(id: string, grade: string, rentMonthly: number, metroAccess: string | null): RecommendationBuildingSource {
  return {
    id,
    name: `项目${id}`,
    grade,
    district: '朝阳区',
    submarket: '望京-酒仙桥',
    metricPeriod: '2026 Q2',
    metrics: {
      netEffectiveRentMonthly: rentMonthly,
      askingRentMonthly: rentMonthly + 20,
      vacancyRate: 0.12,
      managementFee: 30,
    },
    brochure: {
      address: '测试路1号',
      developer: null,
      metroAccess,
      standardFloorArea: 2000,
      propertyManagement: null,
      leedCertification: null,
      wellCertification: null,
      greenBuildingStandard: null,
      completionDate: null,
    },
  };
}

describe('recommendationEngine', () => {
  it('treats “优先甲级” as ranking preference instead of a hard filter', () => {
    const plan = buildRecommendationPlan(
      result,
      '望京或酒仙桥，800-1200平方米，预算7元以内，11月入住，优先甲级项目、地铁便利',
      [building('a', 'A', 190, '地铁步行5分钟'), building('b', 'B', 180, '地铁步行4分钟')],
    );

    expect(plan.gradeIsHard).toBe(false);
    expect(plan.candidateCount).toBe(2);
    expect(plan.recommendations[0]?.id).toBe('a');
    expect(plan.preferenceCriteria.join(' ')).toContain('优先，不硬过滤');
  });

  it('uses net effective rent as an explicit recommendation-stage assumption when rent basis is omitted', () => {
    const plan = buildRecommendationPlan(
      result,
      '望京，预算7元以内',
      [building('inside', 'A', 200, null), building('outside', 'A', 230, null)],
    );

    expect(plan.effectiveResult.parsed.rent.basis).toBe('net_effective');
    expect(plan.assumptions.join(' ')).toContain('暂按净有效租金理解');
    expect(plan.recommendations.map(item => item.id)).toEqual(['inside']);
  });

  it('respects an explicit grade hard constraint without double-counting it in ranking score', () => {
    const plan = buildRecommendationPlan(
      result,
      '望京，只考虑甲级项目，预算7元以内',
      [building('a', 'A', 200, null), building('b', 'B', 180, null)],
    );

    expect(plan.gradeIsHard).toBe(true);
    expect(plan.recommendations.map(item => item.id)).toEqual(['a']);
    expect(plan.recommendations[0]?.scoreBreakdown.map(item => item.key)).not.toContain('grade');
    expect(plan.recommendations[0]?.scoreBreakdown.map(item => item.key)).not.toContain('location');
  });

  it('keeps unavailable unit area and move-in timing as verification items rather than scoring facts', () => {
    const plan = buildRecommendationPlan(result, '望京，800-1200平方米，11月入住', [building('a', 'A', 190, null)]);
    const verification = plan.verificationRequired.join(' ');

    expect(verification).toContain('实时可租单元面积');
    expect(verification).toContain('实时销控');
    expect(plan.recommendations[0]?.cautions.join(' ')).toContain('不代表当前有对应可租单元');
  });

  it('returns an evidence-based relaxation hint instead of padding an empty shortlist', () => {
    const plan = buildRecommendationPlan(
      result,
      '望京，预算5元以内',
      [building('a', 'A', 190, '地铁步行5分钟'), building('b', 'A', 210, '地铁步行8分钟')],
    );

    expect(plan.candidateCount).toBe(0);
    expect(plan.relaxationHints.join(' ')).toContain('最低约');
    expect(plan.relaxationHints.join(' ')).toContain('当前预算上限会过滤全部项目');
  });
});