import { quarterLabel } from './quarterlyFacts';
import type { SubmarketTrendPoint, SubmarketTrendSeries } from './submarketMarketTrend';
import {
  canCompareMarketSamples, marketSampleCoverageChanged, marketTrendMetrics, pointKey, trendSamples, trendValue,
  type MarketTrendMetric,
} from './submarketTrendDigest';

export const marketTrendLabels = {
  rent: { name: '净有效租金', unit: '元/㎡/月', changeUnit: '元/㎡/月' },
  vacancyPct: { name: '空置率', unit: '%', changeUnit: '百分点' },
} as const;

export type TrendQuarter = { key: number; period: string; point: SubmarketTrendPoint | null };
export type MarketTrendReading = 'overview' | 'research';
export type MarketTrendRange = 'default' | 'history';
type ChartKind = 'empty' | 'value' | 'comparison' | 'line' | 'scatter';

export function buildTrendTimeline(data: readonly SubmarketTrendPoint[]): TrendQuarter[] {
  const byQuarter = new Map<number, SubmarketTrendPoint>();
  for (const point of data) {
    const key = pointKey(point);
    if (key != null) byQuarter.set(key, point);
  }
  if (!byQuarter.size) return [];
  const first = Math.min(...byQuarter.keys()), last = Math.max(...byQuarter.keys());
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const key = first + index;
    return { key, period: quarterLabel(key), point: byQuarter.get(key) ?? null };
  });
}

function observed(quarter: TrendQuarter, metric: MarketTrendMetric) {
  return trendValue(quarter.point, metric) != null;
}

/** Market change uses Phase 01 minima. Only explicit one- and four-quarter offsets have calendar comparison labels. */
export function compareTrendQuarters(metric: MarketTrendMetric, latest: TrendQuarter, earlier: TrendQuarter | undefined, yearOverYear = false) {
  if (!earlier || !canCompareMarketSamples(latest.point, earlier.point, metric)) return null;
  const offset = latest.key - earlier.key;
  if (offset <= 0) return null;
  const identity = metric === 'rent' ? 'rent' : 'vacancy';
  const reportedChange = offset === 1 && latest.point?.sampleChanged?.[identity] === true;
  const scopeChanged = trendSamples(earlier.point, metric) !== trendSamples(latest.point, metric)
    || marketSampleCoverageChanged(earlier.point, latest.point, metric);
  const sameSample = offset === 1 ? latest.point?.sameSampleQoq?.[identity]
    : offset === 4 ? latest.point?.sameSampleYoy?.[identity] : undefined;
  const before = trendValue(earlier.point, metric)!;
  const after = trendValue(latest.point, metric)!;
  return {
    label: offset === 1 ? '环比' : offset === 4 && yearOverYear ? '同比' : `${earlier.period} 至 ${latest.period}变化`,
    difference: after - before,
    relative: metric === 'rent' && before > 0 ? (after / before - 1) * 100 : null,
    sampleChanged: reportedChange || scopeChanged,
    sameSample: sameSample && sameSample.samples >= 2 ? sameSample : undefined,
  };
}

function decideMetric(timeline: readonly TrendQuarter[], metric: MarketTrendMetric, reading: MarketTrendReading, range: MarketTrendRange) {
  const observations = timeline.filter(quarter => observed(quarter, metric));
  const latest = observations.at(-1);
  const previous = observations.at(-2);
  const latestChange = latest && compareTrendQuarters(metric, latest, previous);
  const yearAgo = latest && timeline.find(quarter => quarter.key === latest.key - 4);
  const yearlyChange = latest && yearAgo !== previous ? compareTrendQuarters(metric, latest, yearAgo, true) : null;
  const quality = latest && trendSamples(latest.point, metric) < 2 ? '仅 1 个有效样本'
    : latestChange?.sampleChanged ? '样本构成或覆盖有变'
      : previous && !latestChange ? '两期有效样本不足，无法比较' : null;

  let kind: ChartKind = 'empty';
  let axis: readonly TrendQuarter[] = observations;
  let keepsOtherObservations = false;
  let offersHistory = false;
  if (latest && observations.length < 3) {
    kind = previous ? 'comparison' : 'value';
  } else if (latest) {
    const limit = reading === 'overview' ? 5 : 8;
    const first = observations[0];
    let recentStart = latest.key;
    for (let index = observations.length - 2; index >= 0 && observations[index].key === recentStart - 1; index--) {
      recentStart--;
    }
    const recentContinuous = latest.key - recentStart >= 2;
    const start = Math.max(recentContinuous ? recentStart : first.key, latest.key - limit + 1);
    // If an old, sparse series has fewer than three recent values, retain the earlier observations in the plot.
    const plotStart = observations.filter(quarter => quarter.key >= start).length >= 3 ? start : first.key;
    const defaultAxis = timeline.filter(quarter => quarter.key >= plotStart && quarter.key <= latest.key);
    offersHistory = defaultAxis.length < timeline.length;
    axis = range === 'history' ? timeline : defaultAxis;
    const shown = observations.filter(quarter => quarter.key >= axis[0].key && quarter.key <= axis.at(-1)!.key);
    keepsOtherObservations = shown.length < observations.length;
    kind = shown.at(-1)!.key - shown[0].key + 1 === shown.length ? 'line' : 'scatter';
  }
  return { metric, kind, axis, observations, latest, previous, latestChange, yearlyChange, quality, offersHistory, keepsOtherObservations };
}

export type MarketTrendPresentation = ReturnType<typeof decideMetric>;

const hasPlot = (presentation: MarketTrendPresentation) => presentation.kind === 'line' || presentation.kind === 'scatter';

export function designMarketTrends(timeline: readonly TrendQuarter[], reading: MarketTrendReading, range: MarketTrendRange = 'default') {
  const plots = marketTrendMetrics.map(metric => decideMetric(timeline, metric, reading, range));
  const [rent, vacancy] = plots;
  if (reading === 'research' && range === 'default' && hasPlot(rent) && hasPlot(vacancy)) {
    const first = Math.min(rent.axis[0].key, vacancy.axis[0].key);
    const last = Math.max(rent.axis.at(-1)!.key, vacancy.axis.at(-1)!.key);
    const shared = timeline.filter(quarter => quarter.key >= first && quarter.key <= last);
    // A shared axis helps compare broadly overlapping plots without filling a panel with empty quarters.
    if (plots.every(plot => shared.length - plot.axis.length <= 1)) {
      return plots.map(plot => ({
        ...plot, axis: shared,
        offersHistory: shared.length < timeline.length,
        keepsOtherObservations: plot.observations.some(quarter => quarter.key < first || quarter.key > last),
      }));
    }
  }
  return plots;
}

export function marketTrendAxisDensity(width: number, length: number) {
  const left = width < 360 ? 6 : 12;
  const right = width < 360 ? 12 : 20;
  const labelSlots = Math.max(2, Math.floor((width - left - right - 42) / 67));
  return {
    left, right,
    interval: Math.max(1, Math.ceil((length - 1) / (labelSlots - 1))),
    splitNumber: width < 360 ? 3 : 4,
  };
}

export function latestGradeComparisons(series: Pick<SubmarketTrendSeries, 'a' | 'b'>) {
  const gradeA = buildTrendTimeline(series.a);
  const gradeB = new Map(buildTrendTimeline(series.b).map(row => [row.key, row]));
  return marketTrendMetrics.flatMap(metric => {
    const a = gradeA.findLast(row => canCompareMarketSamples(row.point, gradeB.get(row.key)?.point ?? null, metric));
    const b = a && gradeB.get(a.key);
    return a && b ? [{ metric, a, b, difference: trendValue(a.point, metric)! - trendValue(b.point, metric)! }] : [];
  });
}
