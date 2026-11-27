import { distributionPage, levelsSummary, metricPage, photoPage, tablePage, textPage, type PageDraft } from './drafts';
import { displayMetricNumber, historicalMetric, metricInfo, metricValue, positioningMatrix, type Metric } from './observations';
import { bind, periodLabel, periodOrder, prose } from './page-content';
import { stackingPage } from './property-pages';
import type { Market, MarketObservation, Evidence, Period, ProposalData } from './projection';

function segments(title: string, category: string, rows: readonly Evidence<MarketObservation>[] | undefined) {
  if (!rows?.some(row => metricValue(row.value, 'netEffectiveRent') !== null || metricValue(row.value, 'vacancyRate') !== null)) return null;
  const shown = (value: MarketObservation, key: Metric) => {
    const metric = metricValue(value, key);
    return metric === null ? null : displayMetricNumber(metric, key);
  };
  return tablePage(title, [category, '净有效租金（元/㎡/月）', '空置率（%）', '样本楼宇（栋）'], rows.map(({ value }) => [
    value.name,
    shown(value, 'netEffectiveRent'),
    shown(value, 'vacancyRate'),
    metricValue(value, 'sampleCount'),
  ]), rows, '— 表示该分组缺少可披露的数值');
}

export function marketDrafts(data: ProposalData, market: Market, period: Period): Record<string, PageDraft | null> {
  const quarter = market.quarter;
  const history = market.history ?? [];
  const previous = history.find(entry => periodOrder(entry.value.period) === periodOrder(period) - 1);
  const results = levelsSummary(quarter, previous, '上季度');
  const rent = historicalMetric([...history, quarter], 'netEffectiveRent', period);
  const vacancy = historicalMetric([...history, quarter], 'vacancyRate', period);
  const matrix = positioningMatrix(market.submarkets?.map((record, i) => ({ ...record, label: record.value.name, id: String(i) })) ?? [], '子市场');
  const spotlight = market.spotlight;
  const outlook = market.outlook;
  const subject = spotlight && data.buildings.find(building => building.submarket === spotlight.value.name);
  const map = data.maps?.market;
  const deals = data.leases?.deals;

  const trendPage = (result: ReturnType<typeof historicalMetric>): PageDraft | null => result ? ({
    title: result.title,
    subtitle: result.coverage,
    composition: result.block.block.kind === 'chart' ? 'chart-insight' : 'data-table',
    blocks: [result.block],
  }) : null;
  return {
    cover: { title: `${market.name}写字楼市场报告`, subtitle: periodLabel(period), composition: 'cover', blocks: [prose('正式季度研究', [quarter])] },
    'key-indicators': metricPage('本季度写字楼市场核心指标', quarter, ['netEffectiveRent', 'vacancyRate', 'trackedArea', 'sampleCount'], periodLabel(period)),
    summary: results.length && previous ? textPage('本季度租金与空置率的变化', results, [quarter, previous]) : null,
    'rent-trend': trendPage(rent),
    'vacancy-trend': trendPage(vacancy),
    submarkets: segments('各子市场的租金与空置率', '子市场', market.submarkets),
    grades: segments('物业等级之间的租金与空置率', '物业等级', market.grades),
    'positioning-matrix': matrix ? { title: matrix.title, subtitle: matrix.subtitle, composition: 'data-table', blocks: [matrix.block] } : null,
    'lease-trend': data.leases?.trend ? distributionPage('获权样本的租赁成交趋势', data.leases.trend, 'line') : null,
    'industry-demand': data.leases?.industries ? distributionPage('正式成交样本的行业构成', data.leases.industries, 'bar') : null,
    'lease-area': data.leases?.sizes ? distributionPage('正式成交样本的面积分布', data.leases.sizes, 'bar') : null,
    'lease-deals': deals?.value.length ? tablePage('观察时间内可披露的代表性成交', ['楼宇', '行业', '成交期间', '面积（㎡）'],
      deals.value.map(row => [row.building, row.industry, row.period, row.area]), [deals], '保留来源记录的期间精度') : null,
    'spatial-distribution': map ? (map.value.kind === 'map' ? { title: '获权市场样本的空间分布', composition: 'map-analysis', blocks: [bind(map.value, [map])] }
      : { title: '获权市场样本的空间分布', composition: 'hero-caption', blocks: [bind(map.value, [map]), prose('标注基于所选市场样本', [map])] }) : null,
    spotlight: spotlight ? textPage(`${spotlight.value.name}子市场专题`, [spotlight.value.observation], [spotlight]) : null,
    'spotlight-photos': subject ? photoPage(`${subject.name}建筑实景`, subject.photos?.filter(photo => photo.value.kind === 'exterior') ?? []) : null,
    'spotlight-spaces': subject ? stackingPage(subject) : null,
    outlook: outlook ? textPage(`${outlook.value.period}市场展望`, [
      `预测 · ${outlook.value.claim}`, `依据 · ${outlook.value.basis}`, `适用条件 · ${outlook.value.limitations.join('；')}`,
    ], [outlook], 'agenda-rail') : null,
    monitoring: (rent || vacancy) ? textPage('下一季度观察租金方向与空置样本变化', [
      `观察项 · 按${metricInfo.netEffectiveRent.label}和${metricInfo.vacancyRate.label}的同口径数据核验后续走势`,
      '观察项 · 跟踪成交样本覆盖与行业结构变化，更新判断前核实样本组成',
    ], [quarter], 'pros-cons') : null,
    methodology: textPage('样本范围与指标口径', [
      ...(market.methodology ? [market.methodology.value] : []),
      `${periodLabel(period)} · 城市指标采用已授权的正式汇总结果。分组比较、租赁成交和空间样本各有独立覆盖。`,
      '历史图保留缺失季度。空置率水平用百分比，季度变动用百分点。成交记录保留原始期间精度。',
    ], [quarter, ...(market.methodology ? [market.methodology] : [])]),
  };
}
