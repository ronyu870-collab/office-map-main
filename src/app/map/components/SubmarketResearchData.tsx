'use client';

import { useMemo } from 'react';
import type { SubmarketTrendPoint, SubmarketTrendSeries } from '../model/submarketMarketTrend';
import { normalizeMapSubmarket, officeGrade } from '../model/marketIdentity';
import { aggregateMarket } from '../model/marketStatistics';
import type { MarketBuilding, SubmarketSummary } from '../model/submarketOverview';
import {
  describeCurrentResearchMarket, describeQuarterlyResearchMarket, researchNumber,
  signedResearchNumber, submarketResearchObservation,
} from '../model/submarketResearch';
import type { MarketTrendRange } from '../model/marketTrendPresentation';
import { MarketComposition } from './MarketComposition';
import { MarketTrendSummary } from './MarketTrendSummary';
import { MarketGradeComparison, SubmarketTrendChart } from './SubmarketTrendChart';
import styles from './SubmarketResearchData.module.css';

export type SubmarketResearchTrendState = 'loading' | 'error' | 'ready';
export type SubmarketResearchFutureState = 'disabled' | 'loading' | 'error' | 'ready';
const emptyTrend: readonly SubmarketTrendPoint[] = [];
const available = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);
const count = (value: number) => `${researchNumber(value, 0)} 个`;
const delta = (value: number, unit: string) => `${signedResearchNumber(value)}${unit === '%' ? '' : ' '}${unit}`;

function MetricValue({ value, precision = 1, unit }: { value: number | null; precision?: number; unit: string }) {
  return <div className={styles.metricValue}>{available(value) ? <>
    <strong>{researchNumber(value, precision)}</strong><span>{unit}</span>
  </> : <span>未收录</span>}</div>;
}

type MetricContext = ReturnType<typeof describeCurrentResearchMarket>['rent'];
function CurrentMetric({ label, value, unit, sampleCount, context }: {
  label: string; value: number | null; unit: string; sampleCount: number; context: MetricContext;
}) {
  const { periods, benchmark } = context;
  const contextText = [periods.length > 1 ? '混合季度' : periods[0], sampleCount === 1 && '单项目样本'].filter(Boolean).join(' · ');
  return <div className={styles.metric}>
    <dt>{label}</dt>
    <dd><MetricValue value={value} unit={unit} /></dd>
    {contextText && <dd className={styles.metricDetail}>{contextText}</dd>}
    {benchmark && <dd className={styles.metricDetail}>
      较北京同口径 {delta(benchmark.difference, unit === '%' ? '百分点' : unit)}
    </dd>}
  </div>;
}

export function SubmarketResearchOverview({
  name, summary, buildings, trendData = emptyTrend, trendState = 'ready', futureState, futureCount, futureArea,
  futureAreaSamples, beijingBenchmarkBuildings, showQuarterlySummary = true,
  structured = false, parkOnly = false, part = 'all',
}: {
  name: string;
  summary: SubmarketSummary;
  buildings: readonly MarketBuilding[];
  trendData?: readonly SubmarketTrendPoint[];
  trendState?: SubmarketResearchTrendState;
  futureState: SubmarketResearchFutureState;
  futureCount: number;
  futureArea?: number | null;
  futureAreaSamples?: number;
  beijingBenchmarkBuildings?: readonly MarketBuilding[];
  showQuarterlySummary?: boolean;
  structured?: boolean;
  parkOnly?: boolean;
  part?: 'all' | 'composition' | 'future';
}) {
  const current = useMemo(() => describeCurrentResearchMarket(name, buildings, beijingBenchmarkBuildings), [name, buildings, beijingBenchmarkBuildings]);
  const quarterly = useMemo(() => trendState === 'ready' ? describeQuarterlyResearchMarket(trendData) : null, [trendData, trendState]);
  const park = useMemo(() => parkOnly ? aggregateMarket(buildings.filter(building =>
    normalizeMapSubmarket(building.submarket) === name && officeGrade(building.grade) === 'park')) : null,
  [buildings, name, parkOnly]);
  const onlyFuture = parkOnly || part === 'future';
  const showFutureArea = futureState === 'ready' && available(futureArea) && futureArea >= 0 && futureAreaSamples != null
    && futureAreaSamples > 0 && futureAreaSamples <= futureCount;
  return <div className={styles.research}>
    {part === 'all' && (park ? <section data-workspace-summary aria-label="市场核心指标">
      <p className={styles.scope}>当前筛选 · 产业园存量</p>
      <dl className={styles.metrics}>
        <div className={styles.metric}><dt>产业园项目</dt><dd><MetricValue value={park.projectCount} unit="个" precision={0} /></dd></div>
        {park.areaSamples > 0 ? <div className={styles.metric}>
          <dt>已知面积</dt><dd><MetricValue value={park.stockArea} unit="㎡" precision={0} /></dd>
        </div> : null}
      </dl>
    </section> : <section data-workspace-summary aria-label="市场核心指标">
      <p className={styles.scope}>当前筛选 · 甲乙级存量</p>
      <dl className={styles.metrics}>
        <CurrentMetric label="平均净有效租金" value={summary.rent} unit="元/㎡/月" sampleCount={summary.rentSampleCount} context={current.rent} />
        <CurrentMetric label="平均空置率" value={summary.vacancyPct} unit="%" sampleCount={summary.vacancySampleCount} context={current.vacancyPct} />
        <div className={styles.metric}>
          <dt>甲乙级项目</dt>
          <dd><MetricValue value={summary.officeCount} precision={0} unit="个" /></dd>
        </div>
      </dl>
    </section>)}
    {part === 'all' && !structured ? <section aria-label="市场观察" className={styles.block}>
      <h3>市场观察</h3>
      <p>{submarketResearchObservation(name, summary, current, quarterly)}</p>
    </section> : null}
    {part === 'all' && showQuarterlySummary && !parkOnly && (
      trendState === 'ready' ? <MarketTrendSummary data={trendData} /> : <section aria-label="季度变化" className={styles.block}>
        <h3>季度变化</h3>
        <p role="status" className={styles.secondary}>{trendState === 'loading' ? '正在读取季度行情…' : '季度行情暂不可用。'}</p>
      </section>
    )}
    {(!onlyFuture || (futureState === 'ready' && futureCount > 0) || futureState === 'error') ? <section aria-label={onlyFuture ? '未来供应' : '楼宇构成'} className={styles.block}>
      <h3>{onlyFuture ? '未来供应' : '楼宇构成'}</h3>
      {!onlyFuture && <MarketComposition segments={[
        { label: '甲级写字楼', count: summary.gradeACount },
        { label: '乙级写字楼', count: summary.gradeBCount },
        { label: '产业园', count: summary.parkCount },
      ]} />}
      <dl className={styles.supplement}>
        {!onlyFuture && summary.areaSamples > 0 && available(summary.stockArea) && summary.stockArea >= 0 && <div>
          <dt>甲乙级已知存量面积</dt><dd>{researchNumber(summary.stockArea, 0)} ㎡（{count(summary.areaSamples)}有面积记录）</dd>
        </div>}
        {futureState === 'ready' && <div><dt>未来供应（另计）</dt><dd>{count(futureCount)}</dd></div>}
        {futureState === 'error' && <div><dt>未来供应（另计）</dt><dd role="status">暂不可用</dd></div>}
        {showFutureArea && <div><dt>未来供应已知面积</dt><dd>{researchNumber(futureArea, 0)} ㎡（{count(futureAreaSamples)}有面积记录）</dd></div>}
      </dl>
    </section> : null}
  </div>;
}

export function SubmarketResearchTrend({ data, state, gradeLabel, series, active, range, onRangeChange, onRetry }: {
  data: readonly SubmarketTrendPoint[];
  state: SubmarketResearchTrendState;
  gradeLabel: string;
  series?: SubmarketTrendSeries;
  active: boolean;
  range: MarketTrendRange;
  onRangeChange: (range: MarketTrendRange) => void;
  onRetry?: () => void;
}) {
  return <div className={styles.research}>
    <section className={styles.trendSection} aria-label="季度行情">
      <p className={styles.secondary}>完整子市场 · {gradeLabel}</p>
      {state === 'loading' ? <p role="status" className={styles.chartStatus}>正在读取季度数据…</p>
        : state === 'error' ? <div className={styles.chartStatus}>
          <p role="status">历史行情暂不可用。</p>
          {onRetry && <button type="button" className={styles.retry} onClick={onRetry}>重新加载</button>}
        </div>
          : <SubmarketTrendChart data={data} range={range} onRangeChange={onRangeChange} active={active} />}
      {state === 'ready' && series && <MarketGradeComparison series={series} />}
    </section>
  </div>;
}
