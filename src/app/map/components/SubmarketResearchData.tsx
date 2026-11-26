'use client';

import { useMemo, type ReactNode } from 'react';
import type { SubmarketTrendPoint, SubmarketTrendSeries } from '../model/submarketMarketTrend';
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
const numberUnit = (value: number, unit: string) => `${researchNumber(value)}${unit === '%' ? '' : ' '}${unit}`;
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
  const period = periods.length === 1 ? periods[0] : periods.length > 1 ? '混合季度' : null;
  return <div className={styles.metric}>
    <dt>{label}</dt>
    <dd><MetricValue value={value} unit={unit} /></dd>
    <dd className={styles.metricDetail}>{period ? `${period} · ` : ''}{count(sampleCount)}有效样本</dd>
    {benchmark && <dd className={styles.metricDetail}>
      北京同筛选样本 {numberUnit(benchmark.cityValue, unit)}<br />较北京 {delta(benchmark.difference, unit === '%' ? '百分点' : unit)}
    </dd>}
  </div>;
}

function SourceDisclosure({ children, label = '数据口径与来源' }: { children: ReactNode; label?: string }) {
  return <details className={styles.source}><summary>{label}</summary><div>{children}</div></details>;
}

export function SubmarketResearchOverview({
  name, summary, buildings, trendData = emptyTrend, trendState = 'ready', futureState, futureCount, futureArea,
  futureAreaSamples, beijingBenchmarkBuildings, showQuarterlySummary = true,
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
}) {
  const current = useMemo(() => describeCurrentResearchMarket(name, buildings, beijingBenchmarkBuildings), [name, buildings, beijingBenchmarkBuildings]);
  const quarterly = useMemo(() => trendState === 'ready' ? describeQuarterlyResearchMarket(trendData) : null, [trendData, trendState]);
  const showFutureArea = futureState === 'ready' && available(futureArea) && futureArea >= 0 && futureAreaSamples != null
    && futureAreaSamples > 0 && futureAreaSamples <= futureCount;
  const hasBenchmark = Boolean(current.rent.benchmark || current.vacancyPct.benchmark);
  return <div className={styles.research}>
    <section data-workspace-summary aria-label="市场核心指标">
      <p className={styles.scope}>当前筛选 · 甲乙级存量 · 各楼宇最新发布记录</p>
      <dl className={styles.metrics}>
        <CurrentMetric label="平均净有效租金" value={summary.rent} unit="元/㎡/月" sampleCount={summary.rentSampleCount} context={current.rent} />
        <CurrentMetric label="平均空置率" value={summary.vacancyPct} unit="%" sampleCount={summary.vacancySampleCount} context={current.vacancyPct} />
        <div className={styles.metric}>
          <dt>甲乙级项目</dt>
          <dd><MetricValue value={summary.officeCount} precision={0} unit="个" /></dd>
        </div>
      </dl>
    </section>
    <section aria-label="市场观察" className={styles.block}>
      <h3>市场观察</h3>
      <p>{submarketResearchObservation(name, summary, current, quarterly)}</p>
    </section>
    {showQuarterlySummary && (trendState === 'ready' ? <MarketTrendSummary data={trendData} /> : <section aria-label="季度变化" className={styles.block}>
      <h3>季度变化</h3>
      <p role="status" className={styles.secondary}>{trendState === 'loading' ? '正在读取季度行情…' : '季度行情暂不可用。'}</p>
    </section>)}
    <section aria-label="楼宇构成" className={styles.block}>
      <h3>楼宇构成</h3>
      <MarketComposition segments={[
        { label: '甲级写字楼', count: summary.gradeACount },
        { label: '乙级写字楼', count: summary.gradeBCount },
        { label: '产业园', count: summary.parkCount },
      ]} />
      <dl className={styles.supplement}>
        {summary.areaSamples > 0 && available(summary.stockArea) && summary.stockArea >= 0 && <div>
          <dt>甲乙级已知存量面积</dt><dd>{researchNumber(summary.stockArea, 0)} ㎡（{count(summary.areaSamples)}有面积记录）</dd>
        </div>}
        {futureState === 'ready' && <div><dt>未来供应（另计）</dt><dd>{count(futureCount)}</dd></div>}
        {futureState === 'error' && <div><dt>未来供应（另计）</dt><dd role="status">暂不可用</dd></div>}
        {showFutureArea && <div><dt>未来供应已知面积</dt><dd>{researchNumber(futureArea, 0)} ㎡（{count(futureAreaSamples)}有面积记录）</dd></div>}
      </dl>
    </section>
    <SourceDisclosure>
      <p>核心指标与地图气泡口径一致：平台收录且命中当前筛选的甲乙级存量，按每栋楼最新已发布的季度记录面积加权；同一指标可能包含多个季度。超甲级计入甲级；产业园和未来供应不纳入甲乙级统计。</p>
      {(current.rent.periods.length > 1 || current.vacancyPct.periods.length > 1) && <p>
        {current.rent.periods.length > 1 && `净有效租金样本季度：${current.rent.periods.join('、')}。`}
        {current.vacancyPct.periods.length > 1 && `空置率样本季度：${current.vacancyPct.periods.join('、')}。`}
      </p>}
      <p>净有效租金有效面积覆盖：{summary.rentCoverage.area == null ? '未收录' : numberUnit(summary.rentCoverage.area * 100, '%')}；空置率有效面积覆盖：{summary.vacancyCoverage.area == null ? '未收录' : numberUnit(summary.vacancyCoverage.area * 100, '%')}。分母为甲乙级已知存量面积。</p>
      {hasBenchmark && <p>北京比较仅解除当前研究子市场的限制，保留其他筛选，使用平台收录的甲乙级项目（含本子市场）。同一指标在本区和北京均须来自同一正式季度、各至少两个有效样本，且北京样本须包含其他具名子市场的有效观测。</p>}
      <p>季度比较使用完整授权子市场同季度已锁定、非草稿的楼宇季度记录。环比和同比要求相隔一个和四个真实季度，且比较的两期各至少有两个有效样本；各期样本可能不同。</p>
    </SourceDisclosure>
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
      <p className={styles.secondary}>完整授权子市场 · {gradeLabel} · 不随地图筛选变化</p>
      {state === 'loading' ? <p role="status" className={styles.chartStatus}>正在读取季度数据…</p>
        : state === 'error' ? <div className={styles.chartStatus}>
          <p role="status">历史行情暂不可用。</p>
          {onRetry && <button type="button" className={styles.retry} onClick={onRetry}>重新加载</button>}
        </div>
          : <SubmarketTrendChart data={data} range={range} onRangeChange={onRangeChange} active={active} />}
      {state === 'ready' && series && <MarketGradeComparison series={series} />}
    </section>
    {state === 'ready' && data.some(row => row.rent != null || row.vacancyPct != null) && <SourceDisclosure label="季度行情口径与来源">
      <p>完整历史覆盖本次读取范围内的正式季度记录（当年及前四个日历年），历史按当前楼宇归属及等级统计。各指标保留自己的有效季度，缺失季度留空。</p>
      <p>环比、同比对应相隔一季和四季的正式观测。每期至少两个有效样本才显示变化。面积覆盖以当期已知存量面积为分母，两期相差至少 10 个百分点时提示覆盖变化。</p>
      <p>市场样本变化使用各期面积加权值。同样本变化只用两期均有效的共同项目重新计算，至少需要两个共同项目。空置率差值以百分点表示。</p>
    </SourceDisclosure>}
  </div>;
}
