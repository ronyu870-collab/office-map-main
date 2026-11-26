'use client';

import dynamic from 'next/dynamic';
import { useId, useMemo } from 'react';
import type { SubmarketTrendPoint, SubmarketTrendSeries } from '../model/submarketMarketTrend';
import {
  buildTrendTimeline, designMarketTrends, latestGradeComparisons, marketTrendLabels,
  type MarketTrendPresentation, type MarketTrendRange, type TrendQuarter,
} from '../model/marketTrendPresentation';
import { marketTrendChangeText, marketTrendValueText, sameSampleChangeText } from '../model/marketTrendText';
import { researchNumber, signedResearchNumber } from '../model/submarketResearch';
import { marketTrendMetrics, trendCoverage, trendSamples, trendValue, type MarketTrendMetric } from '../model/submarketTrendDigest';
import styles from './SubmarketResearchData.module.css';

const MarketChartCanvas = dynamic(() => import('./MarketChartCanvas').then(module => module.MarketChartCanvas), {
  ssr: false,
  loading: () => <div aria-hidden="true" className={styles.chartCanvas} />,
});

function QuarterValue({ quarter, metric }: { quarter: TrendQuarter; metric: MarketTrendMetric }) {
  return <span className={styles.quarterValue}>
    <span className={styles.secondary}>{quarter.period}</span>
    <strong>{marketTrendValueText(trendValue(quarter.point, metric)!, metric)}</strong>
  </span>;
}

const isPlot = ({ kind }: MarketTrendPresentation) => kind === 'line' || kind === 'scatter';

function MetricPlot({ plot, active, group }: { plot: MarketTrendPresentation; active: boolean; group?: string }) {
  const { metric, latest, previous, kind, axis, latestChange, yearlyChange, quality, keepsOtherObservations } = plot;
  const { name } = marketTrendLabels[metric];
  const plotted = isPlot(plot);
  const sameSample = latestChange?.sampleChanged ? sameSampleChangeText(latestChange, metric) : null;
  const sameYearSample = yearlyChange?.sampleChanged ? sameSampleChangeText(yearlyChange, metric) : null;
  return <figure className={styles.chartFigure}>
    <figcaption className={styles.chartCaption}>
      <h4>{name}</h4>
      {latest && <div className={styles.latestValues}>
        {kind === 'comparison' && previous && <QuarterValue quarter={previous} metric={metric} />}
        <QuarterValue quarter={latest} metric={metric} />
      </div>}
    </figcaption>
    {plotted && <p className={styles.chartRange}>
      {axis[0].period} 至 {axis.at(-1)!.period}
      {keepsOtherObservations && ' · 另有早期观测'}{kind === 'scatter' && ' · 离散观测'}
    </p>}
    {plotted && <MarketChartCanvas presentation={plot} label={`${name}季度趋势图`} active={active} group={group} />}
    {!latest && <p className={styles.secondary}>暂无已发布的有效季度观测。</p>}
    {(latestChange || yearlyChange || quality) && <ul className={styles.changeNotes}>
      {latestChange && <li>{marketTrendChangeText(latestChange, metric, true)}</li>}
      {sameSample && <li>{sameSample}</li>}
      {latestChange?.sampleChanged && !sameSample && <li className={styles.secondary}>同期同样本变化不可比</li>}
      {yearlyChange && <li>{marketTrendChangeText(yearlyChange, metric, true)}</li>}
      {sameYearSample && <li>{sameYearSample}</li>}
      {quality && <li className={styles.secondary}>{quality}</li>}
    </ul>}
  </figure>;
}

function QuarterData({ timeline }: { timeline: readonly TrendQuarter[] }) {
  return <details className={styles.quarterData}>
    <summary>查看季度数据</summary>
    <table aria-label="季度租金与空置率">
      <thead><tr><th scope="col">季度</th><th scope="col">净有效租金<br />元/㎡/月</th><th scope="col">空置率<br />%</th></tr></thead>
      <tbody>{timeline.map(({ key, point, period }) => <tr key={key}>
        <th scope="row">{period}</th>
        {marketTrendMetrics.map(metric => {
          const value = trendValue(point, metric), coverage = trendCoverage(point, metric);
          const area = metric === 'rent' ? point?.rentArea : point?.vacancyArea;
          return <td key={metric}>
            {value == null ? '未收录' : researchNumber(value)}
            <span>{trendSamples(point, metric)} 个样本</span>
            {value != null && area != null && area > 0 && <span>{researchNumber(area, 0)} ㎡</span>}
            {coverage != null && <span>面积覆盖 {researchNumber(coverage * 100)}%</span>}
          </td>;
        })}
      </tr>)}</tbody>
    </table>
  </details>;
}

export function MarketGradeComparison({ series }: { series: Pick<SubmarketTrendSeries, 'a' | 'b'> }) {
  const comparisons = useMemo(() => latestGradeComparisons(series), [series]);
  if (!comparisons.length) return null;
  return <details className={styles.quarterData}>
    <summary>比较甲级与乙级</summary>
    <table aria-label="同季度甲乙级比较">
      <thead><tr><th scope="col">指标与季度</th><th scope="col">甲级</th><th scope="col">乙级</th></tr></thead>
      <tbody>{comparisons.map(({ metric, a, b, difference }) => <tr key={metric}>
        <th scope="row">
          {marketTrendLabels[metric].name}<span>{a.period}</span>
          <span className={styles.secondary}>甲级较乙级 {signedResearchNumber(difference)} {marketTrendLabels[metric].changeUnit}</span>
        </th>
        {[a, b].map((row, index) => <td key={index}>
          {marketTrendValueText(trendValue(row.point, metric)!, metric)}
          <span>{trendSamples(row.point, metric)} 个样本</span>
        </td>)}
      </tr>)}</tbody>
    </table>
  </details>;
}

export function SubmarketTrendChart({ data, range = 'default', onRangeChange, active = true }: {
  data: readonly SubmarketTrendPoint[]; range?: MarketTrendRange;
  onRangeChange?: (range: MarketTrendRange) => void; active?: boolean;
}) {
  const timeline = useMemo(() => buildTrendTimeline(data), [data]);
  const defaults = useMemo(() => designMarketTrends(timeline, 'research'), [timeline]);
  const offersHistory = defaults.some(plot => plot.offersHistory);
  const showHistory = offersHistory && range === 'history';
  const plots = useMemo(() => showHistory ? designMarketTrends(timeline, 'research', 'history') : defaults,
    [defaults, showHistory, timeline]);
  const groupId = useId();
  const [rent, vacancy] = plots;
  const group = isPlot(rent) && isPlot(vacancy) && rent.axis === vacancy.axis ? groupId : undefined;
  if (!plots.some(plot => plot.latest)) return <p className={styles.chartStatus}>当前等级暂无已发布的有效季度观测。</p>;
  return <>
    {offersHistory && onRangeChange && <button type="button" className={styles.rangeAction}
      onClick={() => onRangeChange(showHistory ? 'default' : 'history')}>
      {showHistory ? '返回默认区间' : '查看完整历史'}
    </button>}
    <section className={styles.charts} aria-label="指标走势">
      {plots.map(plot => <MetricPlot key={plot.metric} plot={plot} active={active} group={group} />)}
    </section>
    <QuarterData timeline={timeline} />
  </>;
}
