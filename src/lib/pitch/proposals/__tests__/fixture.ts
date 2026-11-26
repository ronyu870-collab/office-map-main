import type { SourceReference } from '../../contracts/content';
import type { BusinessDataBinding, PitchContextSnapshot, VisualAssetReference } from '../../integration-contracts';
import { proposalPhoto } from '../authorized-data';
import type { BoundBuilding, Evidence, Period, ProposalData } from '../projection';

export const id = (number: number) => `9c772d3b-2b41-4142-8f7a-${String(number).padStart(12, '0')}`;
export const period = { year: 2026, quarter: 2 } satisfies Period;
const day = '2026-06-30';
const official = (domain: BusinessDataBinding['domain']): BusinessDataBinding => ({ domain, permissionRevision: 'fixture', policyVersion: 'fixture', dataVersion: `fixture-${domain}`, dataAsOf: day });
const quarter = official('quarter');
const lease = official('lease');
const source = (number: number): SourceReference => ({ id: id(number), kind: 'synthetic', label: '隔离样本', version: 'fixture', locator: `fixture:${number}`, dataAsOf: day });
const evidence = <T>(value: T, binding?: BusinessDataBinding, number = 100): Evidence<T> => ({ value, sources: [source(number)], disclosure: 'internal', isTestData: true, data: binding && [binding] });
const published = <T>(value: T) => ({ ...evidence(value), publication: 'published' as const });

export function proposalFixture(scenario: PitchContextSnapshot['brief']['scenario']) {
  const visuals: VisualAssetReference[] = [];
  const asset = (kind: VisualAssetReference['kind'], number: number, buildingIds: string[]) => {
    const result = { kind, id: id(number), version: 1, versionHash: 'e'.repeat(64), buildingIds, source: source(number), disclosure: 'internal' as const };
    visuals.push(result);
    return result;
  };
  const all: BoundBuilding[] = Array.from({ length: 5 }, (_, index) => {
    const buildingId = id(index + 1), name = `样本${'甲乙丙丁戊'[index]}座`;
    const exterior = asset('photo', 200 + index, [buildingId]);
    return {
      id: buildingId, name, identity: evidence({ name }), submarket: '隔离研究区', grade: '甲级',
      profile: evidence([{ label: '入市年份', value: 2021 }, { label: '项目区位', value: '隔离研究区' }]),
      technical: evidence([{ label: '标准层', value: 1500 + 100 * index, unit: '㎡' }, { label: '办公楼层', value: 20 + index, unit: '层' }]),
      transport: evidence({ description: '样本站步行可达', walkingMinutes: index + 3 }),
      quarter: evidence({ period, netEffectiveRent: 150 + index * 10, vacancyRate: index === 4 ? null : index * .04, trackedArea: 40000 + index * 1000 }, quarter),
      photos: [proposalPhoto(exterior, 'exterior', `${name}外立面`)],
    };
  });
  const main = all[0];
  main.photos = [...main.photos!, proposalPhoto(asset('photo', 211, [main.id]), 'lobby', '已标注的样本大堂')];
  const stack = asset('stacking-plan', 212, [main.id]);
  const stackSource = stack.source;
  main.stackingPlan = { ...evidence({ sources: [stackSource], blocks: [{ kind: 'table' as const, columns: ['楼座', '楼层', '状态'], rows: [['A 座', '12 层', '输入记录']], sourceIds: [stackSource.id] }] }),
    visual: stack, sources: [stackSource] };

  const map = (number: number, buildings: BoundBuilding[]) => {
    const ref = asset('map', number, buildings.map(b => b.id));
    return { ...evidence({ kind: 'image' as const, mediaAssetId: ref.id, mediaVersion: ref.version, alt: '隔离地图输入' }), visual: ref, sources: [ref.source] };
  };
  const scenarioBuildings = scenario === 'market-report' || scenario === 'building-promotion' ? [main] : all;
  const snapshot: PitchContextSnapshot = {
    scope: { organizationId: 'fixture', region: 'fixture', city: '隔离样本城市', businessLine: 'office' },
    brief: { scenario, language: 'zh', style: 'research', audience: 'internal', title: '隔离提案样本', city: '隔离样本城市', submarkets: [], targetClient: null,
      period: '2026-Q2', start: '2025-Q4', pages: 18, buildingIds: scenarioBuildings.map(building => building.id) },
    fingerprint: 'isolated-proposal-fixture', data: [quarter, lease], visuals, isTestData: true,
  };
  const data: ProposalData = {
    buildings: scenarioBuildings,
    maps: { target: map(220, [main]), candidates: map(221, all), market: map(222, all) },
    market: {
      city: snapshot.brief.city, name: '隔离样本城市', submarket: scenario === 'leasing-agency' ? main.submarket : undefined,
      quarter: evidence({ period, netEffectiveRent: 145, vacancyRate: .12, trackedArea: 800000, sampleCount: 24 }, quarter),
      history: [evidence({ period: { year: 2025, quarter: 4 }, netEffectiveRent: 151, vacancyRate: .1 }, quarter),
        evidence({ period: { year: 2026, quarter: 1 }, netEffectiveRent: 150, vacancyRate: .11 }, quarter),
        evidence({ period, netEffectiveRent: 145, vacancyRate: .12 }, quarter)],
      submarkets: [evidence({ name: '样本西区', period, netEffectiveRent: 140, vacancyRate: .1 }, quarter), evidence({ name: '样本东区', period, netEffectiveRent: 150, vacancyRate: .14 }, quarter)],
      grades: [evidence({ name: '甲级', period, netEffectiveRent: 150, vacancyRate: .14 }, quarter), evidence({ name: '乙级', period, netEffectiveRent: 110, vacancyRate: .1 }, quarter)],
      spotlight: published({ name: '隔离研究区', observation: '隔离区域记录使用同一统计期。' }),
      outlook: published({ period: '2026 Q3', claim: '隔离情景假设', basis: '隔离样本口径', limitations: ['仅用于结构测试'] }),
    },
    leases: {
      trend: evidence({ unit: '笔', rows: [{ label: '2026 Q1', value: 10 }, { label: '2026 Q2', value: 14 }], methodology: '获权成交笔数' }, lease),
      industries: evidence({ unit: '笔', rows: [{ label: '样本行业甲', value: 6 }, { label: '行业乙', value: 3 }], methodology: '获权成交笔数' }, lease),
      sizes: evidence({ unit: '笔', rows: [{ label: '低于500㎡', value: 3 }, { label: '500㎡及以上', value: 8 }], methodology: '获权成交笔数' }, lease),
      deals: evidence([{ building: '样本甲座', industry: '行业甲', period: '2026-05', area: 500 }], lease),
    },
    customerBrief: evidence({ requirements: ['优先核对实际可租面积'], selectionBasis: ['明确选择的同一区域样本'] }),
    scoreWeights: evidence({ netEffectiveRent: 70, vacancyRate: 30 }),
    team: published({ kind: 'team', members: [{ name: '合成团队成员', title: '合成项目岗位', biography: '合成人员文本' }], sourceIds: [id(100)] }),
    case: published({ kind: 'case', title: '合成委托案例', challenge: '合成挑战', approach: '合成方法', outcome: '合成结果', sourceIds: [id(100)] }),
  };
  return { data, snapshot };
}
