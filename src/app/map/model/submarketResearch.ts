import { normalizeMapSubmarket, officeGrade } from './marketIdentity';
import { aggregateMarket, type MarketBuilding } from './marketStatistics';
import { latestFormalMetric, quarterKey, quarterLabel } from './quarterlyFacts';
import type { SubmarketTrendPoint } from './submarketMarketTrend';
import type { SubmarketSummary } from './submarketOverview';
import { marketSampleCoverageChanged, summarizeSubmarketTrend } from './submarketTrendDigest';

const metrics = ['rent', 'vacancyPct'] as const;
type Metric = typeof metrics[number];
type Benchmark = { period: string; cityValue: number; difference: number };
type CurrentMetric = { periods: string[]; benchmark: Benchmark | null };
type PeriodStats = Pick<ReturnType<typeof aggregateMarket>, 'rent' | 'rentSampleCount' | 'vacancyPct' | 'vacancySampleCount'>;
const samples = (stats: PeriodStats, metric: Metric) => metric === 'rent' ? stats.rentSampleCount : stats.vacancySampleCount;

/** Period membership is metric-specific: a building without a valid value cannot date that KPI. */
export function describeCurrentResearchMarket(name: string, buildings: readonly MarketBuilding[], beijingBenchmarkBuildings?: readonly MarketBuilding[]) {
  const normalized = normalizeMapSubmarket(name);
  const byPeriod = new Map<number, { city: MarketBuilding[]; local: MarketBuilding[]; other: MarketBuilding[] }>();
  function collect(rows: readonly MarketBuilding[], scope: 'local' | 'city') {
    const seen = new Set<string>();
    for (const building of rows) {
      if (!building.id || seen.has(building.id)) continue;
      seen.add(building.id);
      const grade = officeGrade(building.grade);
      if (grade !== 'a' && grade !== 'b') continue;
      const submarket = normalizeMapSubmarket(building.submarket);
      if (scope === 'local' && submarket !== normalized) continue;
      const latest = latestFormalMetric(building.metrics);
      const period = latest ? quarterKey(latest) : null;
      if (!latest || period == null) continue;
      const group = byPeriod.get(period) ?? { city: [], local: [], other: [] };
      const selected = { id: building.id, grade, metrics: [latest] };
      group[scope].push(selected);
      if (scope === 'city' && submarket && submarket !== normalized && submarket !== '其他') group.other.push(selected);
      byPeriod.set(period, group);
    }
  }
  collect(buildings, 'local');
  if (beijingBenchmarkBuildings) collect(beijingBenchmarkBuildings, 'city');
  const observations = [...byPeriod].sort(([a], [b]) => a - b).map(([key, group]) => ({
    period: quarterLabel(key), local: aggregateMarket(group.local),
    city: beijingBenchmarkBuildings ? aggregateMarket(group.city) : null,
    other: beijingBenchmarkBuildings ? aggregateMarket(group.other) : null,
  }));
  function metricContext(metric: Metric): CurrentMetric {
    const localPeriods = observations.filter(row => samples(row.local, metric) > 0);
    const cityPeriods = observations.filter(row => row.city && samples(row.city, metric) > 0);
    const [row] = localPeriods;
    const localValue = row?.local[metric];
    const cityValue = row?.city?.[metric];
    const benchmark = normalized && normalized !== '其他'
      && localPeriods.length === 1 && cityPeriods.length === 1 && cityPeriods[0] === row
      && row.city && row.other && samples(row.local, metric) >= 2 && samples(row.city, metric) >= 2
      && samples(row.other, metric) > 0 && localValue != null && Number.isFinite(localValue)
      && cityValue != null && Number.isFinite(cityValue)
      ? { period: row.period, cityValue, difference: localValue - cityValue }
      : null;
    return { periods: localPeriods.map(point => point.period), benchmark };
  }
  return { rent: metricContext(metrics[0]), vacancyPct: metricContext(metrics[1]) };
}

/** Apply Phase 01 comparisons separately at the latest observation of each metric. */
export function describeQuarterlyResearchMarket(data: readonly SubmarketTrendPoint[]) {
  const dated = data.filter(point => quarterKey({ record_year: point.year, record_quarter: point.quarter }) != null);
  const { latestRent, latestVacancy } = summarizeSubmarketTrend(dated);
  const through = (point: SubmarketTrendPoint | null) => summarizeSubmarketTrend(point
    ? dated.filter(row => row.year * 4 + row.quarter <= point.year * 4 + point.quarter) : []);
  const rent = through(latestRent);
  const vacancy = latestVacancy === latestRent ? rent : through(latestVacancy);
  return {
    rent: { latest: latestRent, qoqAbsolute: rent.rentChange, qoqPct: rent.rentQoqPct, yoyPct: rent.rentYoyPct,
      scopeChanged: Boolean(latestRent?.sampleChanged?.rent) || marketSampleCoverageChanged(rent.previous, latestRent, 'rent') },
    vacancy: { latest: latestVacancy, qoqPp: vacancy.vacancyChange, yoyPp: vacancy.vacancyYoyPp,
      scopeChanged: Boolean(latestVacancy?.sampleChanged?.vacancy) || marketSampleCoverageChanged(vacancy.previous, latestVacancy, 'vacancyPct') },
  };
}

export const researchNumber = (value: number, decimals = 1) => value.toLocaleString('zh-CN', {
  minimumFractionDigits: decimals, maximumFractionDigits: decimals,
});

/** Keep the sign and narrative consistent with the displayed precision, including minus zero. */
function direction(value: number) {
  return Math.sign(Number(value.toFixed(1)));
}

export function signedResearchNumber(value: number) {
  const rounded = Number(value.toFixed(1));
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${researchNumber(Math.abs(rounded))}`;
}

export function submarketResearchObservation(
  name: string,
  summary: SubmarketSummary,
  current: ReturnType<typeof describeCurrentResearchMarket>,
  quarterly: ReturnType<typeof describeQuarterlyResearchMarket> | null,
) {
  const rent = quarterly?.rent;
  const vacancy = quarterly?.vacancy;
  const rentPeriod = rent?.latest?.period;
  const changeWord = (value: number) => direction(value) > 0 ? '上升' : direction(value) < 0 ? '下降' : '持平';
  if (rentPeriod && rentPeriod === vacancy?.latest?.period && rent?.qoqAbsolute != null && vacancy.qoqPp != null) {
    const changed = rent.scopeChanged || vacancy.scopeChanged;
    const note = changed ? '两期样本构成或覆盖有变。' : '';
    return `${rentPeriod} 完整甲乙级子市场${changed ? '市场样本中' : '的'}净有效租金环比${changeWord(rent.qoqAbsolute)}，空置率环比${changeWord(vacancy.qoqPp)}。${note}`;
  }
  const benchmarkFacts: string[] = [];
  for (const metric of metrics) {
    const benchmark = current[metric].benchmark;
    if (!benchmark) continue;
    const label = metric === 'rent' ? '净有效租金' : '空置率';
    const relation = direction(benchmark.difference);
    benchmarkFacts.push(`${benchmark.period} ${label}${relation > 0 ? '高于' : relation < 0 ? '低于' : '与'}北京同口径${relation === 0 ? '水平相当' : '水平'}`);
  }
  if (benchmarkFacts.length) return `${name}在当前筛选下，${benchmarkFacts.join('，')}。`;
  if (summary.officeCount > 0) {
    return `当前筛选的甲乙级项目中，甲级按项目数占 ${researchNumber(summary.gradeACount / summary.officeCount * 100)}%。`;
  }
  return '当前筛选未收录甲乙级项目。';
}
