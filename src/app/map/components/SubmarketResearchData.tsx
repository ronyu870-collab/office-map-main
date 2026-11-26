'use client';

import dynamic from 'next/dynamic';
import { useMemo, type ReactNode } from 'react';
import type { SubmarketTrendPoint } from '../model/submarketMarketTrend';
import { normalizeMapSubmarket, officeGrade } from '../model/marketIdentity';
import { aggregateMarket } from '../model/marketStatistics';
import type { MarketBuilding, SubmarketSummary } from '../model/submarketOverview';
import {
  describeCurrentResearchMarket, describeQuarterlyResearchMarket, researchNumber,
  signedResearchNumber, submarketResearchObservation,
} from '../model/submarketResearch';
import styles from './SubmarketResearchData.module.css';

export type SubmarketResearchTrendState = 'loading' | 'error' | 'ready';
export type SubmarketResearchFutureState = 'disabled' | 'loading' | 'error' | 'ready';
const emptyTrend: readonly SubmarketTrendPoint[] = [];
const LazyTrendChart = dynamic(() => import('./SubmarketTrendChart').then(module => module.SubmarketTrendChart), {
  ssr: false,
  loading: () => <p className={styles.chartStatus} role="status">正在准备趋势图…</p>,
});

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

function ChangeRow({ label, period, qoq, yoy }: { label: string; period: string; qoq: string | null; yoy: string | null }) {
  return <div className={styles.changeRow}>
    <dt>{label} <span className={styles.secondary}>{period}</span></dt>
    <dd>环比 {qoq ?? '不可比'}</dd>
    <dd>同比 {yoy ?? '不可比'}</dd>
  </div>;
}

type QuarterlyMarket = ReturnType<typeof describeQuarterlyResearchMarket>;
function QuarterlyChanges({ quarterly, state, title = '季度变化', scope }: {
  quarterly: QuarterlyMarket | null; state: SubmarketResearchTrendState; title?: string; scope?: string;
}) {
  const rent = quarterly?.rent;
  const vacancy = quarterly?.vacancy;
  const rentQoq = rent?.qoqAbsolute != null ? `${delta(rent.qoqAbsolute, '元/㎡/月')}${rent.qoqPct != null ? `（${delta(rent.qoqPct, '%')}）` : ''}` : null;
  return <section aria-label={title} className={styles.block}>
    <h3>{title}</h3>
    {scope && <p className={styles.secondary}>{scope}</p>}
    {state === 'loading' ? <p role="status" className={styles.secondary}>正在读取季度行情…</p>
      : state === 'error' ? <p className={styles.secondary}>季度行情暂不可用。</p>
        : rent?.latest || vacancy?.latest ? <dl className={styles.changeList}>
          {rent?.latest && <ChangeRow label="净有效租金" period={rent.latest.period}
            qoq={rentQoq} yoy={rent.yoyPct != null ? delta(rent.yoyPct, '%') : null} />}
          {vacancy?.latest && <ChangeRow label="空置率" period={vacancy.latest.period}
            qoq={vacancy.qoqPp != null ? delta(vacancy.qoqPp, '百分点') : null}
            yoy={vacancy.yoyPp != null ? delta(vacancy.yoyPp, '百分点') : null} />}
        </dl> : <p className={styles.secondary}>暂无已发布的有效季度观测。</p>}
  </section>;
}

function SourceDisclosure({ children }: { children: ReactNode }) {
  return <details className={styles.source}><summary>数据口径与来源</summary><div>{children}</div></details>;
}

export function SubmarketResearchOverview({
  name, summary, buildings, trendData = emptyTrend, trendState = 'ready', futureState, futureCount, futureArea,
  futureAreaSamples, beijingBenchmarkBuildings, includeTrendSource = false, structured = false, hasResearchSignal = false, parkOnly = false,
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
  includeTrendSource?: boolean;
  structured?: boolean;
  hasResearchSignal?: boolean;
  parkOnly?: boolean;
}) {
  const current = useMemo(() => describeCurrentResearchMarket(name, buildings, beijingBenchmarkBuildings), [name, buildings, beijingBenchmarkBuildings]);
  const quarterly = useMemo(() => trendState === 'ready' ? describeQuarterlyResearchMarket(trendData) : null, [trendData, trendState]);
  const park = useMemo(() => parkOnly ? aggregateMarket(buildings.filter(building =>
    normalizeMapSubmarket(building.submarket) === name && officeGrade(building.grade) === 'park')) : null,
  [buildings, name, parkOnly]);
  const showFutureArea = futureState === 'ready' && available(futureArea) && futureArea >= 0 && futureAreaSamples != null
    && futureAreaSamples > 0 && futureAreaSamples <= futureCount;
  const hasBenchmark = Boolean(current.rent.benchmark || current.vacancyPct.benchmark);
  return <div className={styles.research}>
    {park ? <section data-workspace-summary aria-label="市场核心指标">
      <p className={styles.scope}>当前筛选 · 产业园存量</p>
      <dl className={styles.metrics}>
        <div className={styles.metric}><dt>产业园项目</dt><dd><MetricValue value={park.projectCount} unit="个" precision={0} /></dd></div>
        {park.areaSamples > 0 ? <div className={styles.metric}>
          <dt>已知面积</dt><dd><MetricValue value={park.stockArea} unit="㎡" precision={0} /></dd>
          <dd className={styles.metricDetail}>{count(park.areaSamples)}项目有正式面积记录</dd>
        </div> : null}
      </dl>
    </section> : <section data-workspace-summary aria-label="市场核心指标">
      <p className={styles.scope}>当前筛选 · 甲乙级存量 · 各楼宇最新发布记录</p>
      <dl className={styles.metrics}>
        <CurrentMetric label="平均净有效租金" value={summary.rent} unit="元/㎡/月" sampleCount={summary.rentSampleCount} context={current.rent} />
        <CurrentMetric label="平均空置率" value={summary.vacancyPct} unit="%" sampleCount={summary.vacancySampleCount} context={current.vacancyPct} />
        <div className={styles.metric}>
          <dt>甲乙级项目</dt>
          <dd><MetricValue value={summary.officeCount} precision={0} unit="个" /></dd>
        </div>
      </dl>
    </section>}
    {!structured ? <section aria-label="市场观察" className={styles.block}>
      <h3>市场观察</h3>
      <p>{submarketResearchObservation(name, summary, current, quarterly)}</p>
    </section> : null}
    {!parkOnly && !hasResearchSignal ? <QuarterlyChanges quarterly={quarterly} state={trendState} scope="完整授权甲乙级子市场 · 不随地图筛选变化" /> : null}
    {(!parkOnly || (futureState === 'ready' && futureCount > 0) || futureState === 'error') ? <section aria-label={parkOnly ? '未来供应' : '楼宇构成'} className={styles.block}>
      <h3>{parkOnly ? '未来供应' : '楼宇构成'}</h3>
      {!parkOnly ? <dl className={styles.facts}>
        <div><dt>甲级写字楼</dt><dd>{count(summary.gradeACount)}</dd></div>
        <div><dt>乙级写字楼</dt><dd>{count(summary.gradeBCount)}</dd></div>
        <div><dt>产业园</dt><dd>{count(summary.parkCount)}</dd></div>
      </dl> : null}
      <dl className={styles.supplement}>
        {summary.areaSamples > 0 && available(summary.stockArea) && summary.stockArea >= 0 && <div>
          <dt>甲乙级已知存量面积</dt><dd>{researchNumber(summary.stockArea, 0)} ㎡（{count(summary.areaSamples)}有面积记录）</dd>
        </div>}
        {futureState === 'ready' && <div><dt>未来供应（另计）</dt><dd>{count(futureCount)}</dd></div>}
        {futureState === 'error' && <div><dt>未来供应（另计）</dt><dd role="status">暂不可用</dd></div>}
        {showFutureArea && <div><dt>未来供应已知面积</dt><dd>{researchNumber(futureArea, 0)} ㎡（{count(futureAreaSamples)}有面积记录）</dd></div>}
      </dl>
    </section> : null}
    {parkOnly ? <SourceDisclosure><p>存量为当前筛选的园区项目。面积采用各楼宇最新已发布记录，可能跨季度。未来供应独立计算。</p></SourceDisclosure> : <SourceDisclosure>
      <p>核心指标与地图气泡口径一致：平台收录且命中当前筛选的甲乙级存量，按每栋楼最新已发布的季度记录面积加权；同一指标可能包含多个季度。超甲级计入甲级；产业园和未来供应不纳入甲乙级统计。</p>
      {(current.rent.periods.length > 1 || current.vacancyPct.periods.length > 1) && <p>
        {current.rent.periods.length > 1 && `净有效租金样本季度：${current.rent.periods.join('、')}。`}
        {current.vacancyPct.periods.length > 1 && `空置率样本季度：${current.vacancyPct.periods.join('、')}。`}
      </p>}
      <p>净有效租金有效面积覆盖：{summary.rentCoverage.area == null ? '未收录' : numberUnit(summary.rentCoverage.area * 100, '%')}；空置率有效面积覆盖：{summary.vacancyCoverage.area == null ? '未收录' : numberUnit(summary.vacancyCoverage.area * 100, '%')}。分母为甲乙级已知存量面积。</p>
      {hasBenchmark && <p>北京比较仅解除当前研究子市场的限制，保留其他筛选，使用平台收录的甲乙级项目（含本子市场）。同一指标在本区和北京均须来自同一正式季度、各至少两个有效样本，且北京样本须包含其他具名子市场的有效观测。</p>}
      <p>季度比较使用完整授权子市场同季度已锁定、非草稿的楼宇季度记录。环比和同比要求相隔一个和四个真实季度，且比较的两期各至少有两个有效样本；各期样本可能不同。</p>
      {includeTrendSource && <p>{trendSourceNotes}</p>}
    </SourceDisclosure>}
  </div>;
}

const trendSourceNotes = '各指标保留自己的最新有效季度；空白季度不补零或插值。历史按当前楼宇归属及等级统计；空置率变化以百分点表示。';

export function SubmarketResearchTrend({ data, state, gradeLabel, onRetry, showDigest = true, showSource = true }: {
  data: readonly SubmarketTrendPoint[];
  state: SubmarketResearchTrendState;
  gradeLabel: string;
  onRetry?: () => void;
  showDigest?: boolean;
  showSource?: boolean;
}) {
  const quarterly = useMemo(() => state === 'ready' ? describeQuarterlyResearchMarket(data) : null, [data, state]);
  const hasTrend = Boolean(quarterly?.rent.latest || quarterly?.vacancy.latest);
  return <div className={styles.research}>
    <section aria-label="季度行情">
      <p className={styles.scope}>完整授权子市场 · {gradeLabel} · 不随地图筛选变化</p>
      {state === 'loading' ? <p role="status" className={styles.chartStatus}>正在读取季度数据…</p>
        : state === 'error' ? <div className={styles.chartStatus}>
          <p role="status">历史行情暂不可用。</p>
          {onRetry && <button type="button" className={styles.retry} onClick={onRetry}>重新加载</button>}
        </div>
          : hasTrend ? <LazyTrendChart data={data} />
            : <p className={styles.chartStatus}>当前等级暂无已发布的有效季度观测。</p>}
    </section>
    {showDigest && hasTrend && <QuarterlyChanges quarterly={quarterly} state={state} title="最新季度变化" />}
    {showSource && <SourceDisclosure>
      <p>趋势来自已锁定、非草稿的楼宇季度记录，各期样本可能不同。{trendSourceNotes}</p>
      <p>环比、同比须相隔一个、四个真实季度，且比较两期各至少有两个有效样本。</p>
    </SourceDisclosure>}
  </div>;
}
