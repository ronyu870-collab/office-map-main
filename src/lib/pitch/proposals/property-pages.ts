import { officeGrade } from '@/src/app/map/model/marketIdentity';
import { fieldPage, levelsSummary, metricPage, photoPage, tablePage, textPage, distributionPage, type PageDraft } from './drafts';
import { bind, periodLabel, prose } from './page-content';
import { displayMetric, historicalMetric, metricComparison, metricValue, positioningMatrix, type KeyMetric } from './observations';
import { scorecardPage } from './site-selection';
import type { BoundBuilding, LocationReference, Period, ProposalData } from './projection';

export function cover(title: string, subject: BoundBuilding, period: Period): PageDraft {
  const photo = subject.photos?.find(item => item.value.kind === 'exterior');
  const suffix = title.startsWith(subject.name) ? title.slice(subject.name.length).trim() : '';
  const grade = officeGrade(subject.grade);
  const parts = [subject.submarket, grade === 'a' ? '甲级写字楼' : grade === 'b' ? '乙级写字楼' : null].filter(Boolean);
  return {
    title: suffix && title.length < 160 ? `${subject.name}\n${suffix}` : title,
    subtitle: periodLabel(period),
    composition: 'cover',
    blocks: [prose(parts.join(' · ') || subject.name, [subject.identity]), ...(photo ? [bind(photo.value.block, [photo])] : [])],
  };
}

function location(title: string, map: LocationReference | undefined, buildings: readonly BoundBuilding[], pointTitle = title): PageDraft | null {
  const descriptions = buildings.flatMap(building => building.transport ? [prose(`${building.name} · ${building.transport.value.description}`, [building.identity, building.transport])] : []);
  if (!map) return descriptions.length ? { title, composition: 'two-columns', blocks: descriptions } : null;
  const block = bind(map.value, [map]);
  const heading = descriptions.length ? title : pointTitle;
  if (block.block.kind === 'map') {
    const blocks = [block];
    if (descriptions.length && buildings.length === 1) {
      const item = buildings[0];
      blocks.push(bind({ kind: 'insight', claim: item.transport!.value.description, basis: item.name, limitations: ['步行时间受入口与路线影响'] }, [item.identity, item.transport!]));
    }
    return { title: heading, composition: 'map-analysis', blocks };
  }
  return { title: heading, composition: 'hero-caption', blocks: [block, descriptions[0] ?? prose('项目区位', [map])] };
}

function officialRows(buildings: readonly BoundBuilding[]) {
  return buildings.flatMap(building => building.quarter ? [{ ...building.quarter, label: building.name, id: building.id }] : []);
}

function comparisonPage(buildings: readonly BoundBuilding[], metric: KeyMetric, target?: string): PageDraft | null {
  const result = metricComparison(officialRows(buildings), metric, target);
  return result ? { title: result.title, subtitle: result.coverage + ` · 已取得正式季度记录 ${officialRows(buildings).length}/${buildings.length}`, composition: result.block.block.kind === 'chart' ? 'chart-insight' : 'data-table', blocks: [result.block] } : null;
}

function projectList(buildings: readonly BoundBuilding[], title: string): PageDraft {
  return tablePage(title, ['候选项目', '子市场', '物业等级', '已披露交通'], buildings.map(building => [
    building.name, building.submarket ?? null, building.grade ?? null, building.transport?.value.description ?? null,
  ]), buildings.flatMap(building => [building.identity, ...(building.transport ? [building.transport] : [])]));
}

function comparableFields(buildings: readonly BoundBuilding[], title = '已披露建筑和空间参数'): PageDraft | null {
  const observations = buildings.flatMap(building => building.technical?.value.length ? [building.technical] : []);
  const column = (field: { label: string; unit?: string }) => field.unit ? `${field.label}（${field.unit}）` : field.label;
  const fields = [...new Set(observations.flatMap(item => item.value.map(column)))];
  if (!fields.length) return null;
  const evidence = [...buildings.map(building => building.identity), ...observations];
  if (fields.length > 11) {
    const rows = buildings.flatMap(building => building.technical?.value.map(field => [building.name, field.label, field.value, field.unit ?? null]) ?? []);
    return tablePage(title, ['项目', '参数', '数值或说明', '单位'], rows, evidence);
  }
  return tablePage(title, ['项目', ...fields], buildings.map(building => [building.name,
    ...fields.map(field => building.technical?.value.find(item => column(item) === field)?.value ?? null),
  ]), evidence);
}

function photoGroups(buildings: readonly BoundBuilding[], title: string): PageDraft[] {
  const photos = buildings.flatMap(building => {
    const photo = building.photos?.find(photo => photo.value.kind === 'exterior');
    return photo ? [{ ...photo, value: { ...photo.value, block: { ...photo.value.block, alt: building.name } } }] : [];
  });
  const result: PageDraft[] = [];
  for (let i = 0; i < photos.length; i += 4) result.push(photoPage(title, photos.slice(i, i + 4), `已取得实景照片 ${photos.length}/${buildings.length}`)!);
  return result;
}

export function stackingPage(building: BoundBuilding): PageDraft | null {
  const plan = building.stackingPlan;
  if (!plan) return null;
  const shape = plan.value.blocks.find(block => block.kind === 'table' || block.kind === 'image');
  if (!shape || (shape.kind === 'image' && (shape.mediaAssetId !== plan.visual?.id || shape.mediaVersion !== plan.visual.version))) return null;
  const { sourceIds, ...block } = shape;
  const evidence = { ...plan, sources: plan.value.sources.filter(source => sourceIds.includes(source.id)) };
  if (!evidence.sources.length) return null;
  const subtitle = plan.value.businessDate ? `历史数据截至 ${plan.value.businessDate} · 实际可租条件以业主确认为准`
    : '历史楼层资料 · 各份资料日期及条件见原始记录';
  return block.kind === 'table' ? { title: `${building.name}获权楼层分布`, subtitle, composition: 'data-table', blocks: [bind(block, [evidence])] }
    : { title: `${building.name}获权楼层分布`, subtitle, composition: 'hero-caption', blocks: [bind(block, [evidence]), prose('请按原件所列楼座、楼层范围及历史占用条件使用。', [evidence])] };
}

export function leasingDrafts(data: ProposalData, target: BoundBuilding, period: Period): Record<string, PageDraft | readonly PageDraft[] | null> {
  const peers = data.buildings.filter(building => building.id !== target.id);
  const rent = comparisonPage(data.buildings, 'netEffectiveRent', target.id);
  const vacancy = comparisonPage(data.buildings, 'vacancyRate', target.id);
  const matrix = positioningMatrix(officialRows(data.buildings), '目标与竞品');
  const market = data.market;
  const history = (['netEffectiveRent', 'vacancyRate'] as const).flatMap(key => {
    const result = historicalMetric(market?.history ?? [], key, period);
    return result ? [result] : [];
  });
  const industries = data.leases?.industries;
  const rankedIndustries = industries?.value.rows.filter(item => typeof item.value === 'number' && Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)) ?? [];
  const topIndustries = rankedIndustries.filter(item => item.value === rankedIndustries[0]?.value).map(item => item.label);
  const marketTitle = target.submarket ?? market?.name ?? '目标子市场';
  const planningBasis = [target.identity, ...(target.quarter ? [target.quarter] : []), ...(target.technical ? [target.technical] : []), ...(target.stackingPlan ? [target.stackingPlan] : [])];
  const competitionParameters = comparableFields(peers, '竞品核心参数');
  const caseBlock = data.case;
  const team = data.team;
  return {
    cover: cover(`${target.name}招商代理提案`, target, period),
    summary: textPage('招商推进以竞品、可租条件和带看反馈为依据', [
      ...(target.quarter ? levelsSummary(target.quarter, undefined, '') : []),
      `分析边界 · ${periodLabel(period)}的获权市场样本`,
      '建议 · 首先确认委托范围、可租单元、交付时间及报价审批口径',
    ], [target.identity, ...(target.quarter ? [target.quarter] : [])]),
    mandate: data.customerBrief?.value.requirements.length ? textPage('委托范围与招商约束', data.customerBrief.value.requirements, [target.identity, data.customerBrief]) : null,
    profile: fieldPage(`${target.name}项目概况`, target.profile),
    arrival: location(`${target.name}的区位与到达`, data.maps?.target, [target], '项目登记点位'),
    submarket: market ? metricPage(`${marketTitle}写字楼市场`, market.quarter, ['netEffectiveRent', 'vacancyRate', 'sampleCount'], periodLabel(period)) : null,
    'submarket-research': market?.spotlight ? {
      ...textPage(`${marketTitle}区域研究`, [market.spotlight.value.observation, ...(market.spotlight.value.details ?? [])], [market.spotlight]),
      subtitle: `已发布区域概况 · ${market.spotlight.sources[0].dataAsOf}`,
    } : null,
    history: history.length === 2 && history.every(item => item.block.block.kind === 'chart')
      ? { title: `${marketTitle}的租金与空置率历史变化`, subtitle: history[0].coverage + ' ／ ' + history[1].coverage, composition: 'chart-stack', blocks: history.map(entry => entry.block) }
      : history.map(entry => ({ title: entry.title, subtitle: entry.coverage, composition: entry.block.block.kind === 'chart' ? 'chart-insight' : 'data-table', blocks: [entry.block] })),
    'competition-map': peers.length ? location('目标项目与竞品区位', data.maps?.candidates, data.buildings) : null,
    'comparable-properties': [
      ...photoGroups(peers, '竞品建筑实景'),
      ...(competitionParameters ? [competitionParameters] : []),
    ],
    'rent-position': rent,
    'vacancy-position': vacancy,
    'positioning-matrix': matrix ? { title: matrix.title, subtitle: matrix.subtitle, composition: 'data-table', blocks: [matrix.block] } : null,
    availability: stackingPage(target),
    'industry-demand': industries ? distributionPage('获权租赁成交的行业分布', industries, 'bar') : null,
    'target-tenants': topIndustries.length && industries ? textPage('优先验证已有成交记录行业的选址需求', [
      `建议 · 将${topIndustries.slice(0, 3).join('、')}等披露样本中的行业纳入访谈和渠道验证`,
      '观察项 · 确认企业选址时点、可接受面积和交付条件，按反馈筛选实际线索',
    ], [industries, target.identity], 'pros-cons') : null,
    'offer-strategy': target.quarter || target.technical || target.stackingPlan ? textPage('按可交付单元和竞品报价测试招商方案', [
      '建议 · 按可实际交付面积及单元组合安排带看，向业主确认拆分和交付限制',
      '建议 · 以获权净有效租金作为市场参照，另行询证报价、物业费、免租期及成交口径',
    ], planningBasis, 'problem-solution') : null,
    implementation: textPage('从条件核验到首轮带看与复盘', [
      '建议 · 首轮核验楼层、单元、交付及商务条件',
      '建议 · 按获权竞品、行业与渠道名单组织询盘和带看',
      '建议 · 记录实际报价与客户异议，按反馈调整产品呈现和推广节奏',
    ], [target.identity], 'agenda-rail'),
    team: team ? { title: '经批准展示的项目团队', composition: 'team-profile', blocks: [bind(team.value, [team])] } : null,
    case: caseBlock ? { title: caseBlock.value.title, composition: 'case-study', blocks: [bind(caseBlock.value, [caseBlock])] } : null,
    'next-steps': textPage('先确认首批可推单元与报价口径', [
      '建议 · 由业主确认可租清单及对外口径',
      '建议 · 由招商团队补充竞品询价并提交首轮带看计划',
    ], [target.identity], 'pros-cons'),
  };
}

export function shortlistDrafts(data: ProposalData, period: Period): Record<string, PageDraft | readonly PageDraft[] | null> {
  const buildings = data.buildings;
  const evidence = buildings.map(building => building.identity);
  const briefing = data.customerBrief;
  const scorecard = data.scoreWeights ? scorecardPage(buildings, data.scoreWeights) : null;
  const scope = projectList(buildings, `${buildings.length} 个候选项目及筛选范围`);
  if (briefing?.value.selectionBasis.length) scope.subtitle = briefing.value.selectionBasis.join(' · ');
  if (briefing?.value.selectionBasis.length) scope.blocks.forEach(block => { block.evidence = [...block.evidence, briefing]; });
  const knownRents = buildings.flatMap(building => {
    const value = building.quarter && metricValue(building.quarter.value, 'netEffectiveRent');
    return value == null ? [] : [{ value, building }];
  }).sort((a, b) => a.value - b.value);
  return {
    cover: { title: '写字楼选址对比', subtitle: periodLabel(period), composition: 'cover', blocks: [prose(`${buildings.length} 个候选项目`, evidence)] },
    requirements: textPage(briefing?.value.requirements.length ? '已确认的客户选址需求' : '选址条件待客户确认', briefing?.value.requirements.length
      ? [...briefing.value.requirements]
      : ['待确认 · 面积、预算与通勤起点', '待确认 · 入驻时间与交付标准'], briefing ? [briefing] : evidence),
    scope,
    projects: photoGroups(buildings, '候选楼宇建筑实景'),
    arrival: location('候选项目区位与已披露交通', data.maps?.candidates, buildings, '候选项目区位'),
    parameters: comparableFields(buildings),
    'candidate-spaces': stackingPage(buildings[0]),
    'rent-position': comparisonPage(buildings, 'netEffectiveRent'),
    'vacancy-position': comparisonPage(buildings, 'vacancyRate'),
    tradeoffs: knownRents.length > 1 ? textPage('租金、实际交付和通勤条件应分别核验', [
      `已披露净有效租金最低值为 ${displayMetric(knownRents[0].value, 'netEffectiveRent')}，对应楼宇数 ${knownRents.filter(item => item.value === knownRents[0].value).length}`,
      '建议 · 对短名单逐一获取同日全口径报价、可租楼层和通勤时段信息',
    ], knownRents.flatMap(({ building }) => [building.identity, building.quarter!]), 'pros-cons') : null,
    scorecard: scorecard ? { ...scorecard, composition: 'table-insight' } : null,
    'next-steps': textPage('补齐客户条件后安排第一轮现场踏勘', ['建议 · 确认客户限选条件和各评分维度权重', '建议 · 对符合条件的候选楼宇签收书面报价并核验可交付单元'], evidence, 'pros-cons'),
  };
}

export function brochureDrafts(data: ProposalData, target: BoundBuilding, period: Period): Record<string, PageDraft | readonly PageDraft[] | null> {
  const inside = target.photos?.filter(photo => ['lobby', 'amenity', 'office'].includes(photo.value.kind)) ?? [];
  const evidence = [target.identity, ...(data.contact ? [data.contact] : [])];
  return {
    cover: cover(`${target.name}项目推介`, target, period),
    profile: fieldPage(`${target.name}楼宇概况`, target.profile),
    arrival: location('项目区位和到达方式', data.maps?.target, [target], '楼宇登记点位'),
    parameters: fieldPage('建筑产品与技术参数', target.technical),
    spaces: photoPage('大堂、公共配套与办公实景', inside),
    'leasing-evidence': [
      target.quarter ? metricPage('该季度正式租赁市场指标', target.quarter, ['netEffectiveRent', 'vacancyRate', 'trackedArea'], '统计数据 · 实际可租单元及条件以业主确认为准') : null,
      stackingPage(target),
    ].filter((page): page is PageDraft => page !== null),
    'occupier-fit': target.technical?.value.length ? textPage('先按空间需求核对标准层和交付条件', [
      '建议 · 带看时复核适用面积、楼层组合和实际交付边界',
      '建议 · 确认电梯、停车和必要物业条件能否覆盖日常使用',
    ], [target.identity, target.technical], 'pros-cons') : null,
    'next-steps': textPage(data.contact ? '预约看楼与书面条件确认' : '下一步确认可看楼层与交付条件', [
      ...(data.contact ? [data.contact.value] : []),
      '建议 · 在踏勘前明确所需面积及预计入驻日期',
    ], evidence),
  };
}
