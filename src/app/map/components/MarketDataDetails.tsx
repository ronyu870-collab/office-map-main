import type { ReactNode } from 'react';
import { compactMarketArea, marketObservationLabel } from '../model/mapMetricPresentation';
import type { MapStatsState } from '../model/mapDomain';
import { describeCurrentResearchMarket, researchNumber } from '../model/submarketResearch';
import type { MarketBuilding, SubmarketSummary } from '../model/submarketOverview';
import { MapDisclosure } from './MapDisclosure';
import styles from './SubmarketResearchData.module.css';

export const marketDataLabel = '数据与统计口径';

const latestMethod = '存量数据采用各楼宇最新已发布的季度观测，可能跨季度。净有效租金按有效观测面积加权。空置率为有效空置面积与对应总面积之比，当前存量可用已录空置率折算空置面积。缺失面积与指标不计入相应分母。';
const formalSource = '来源为平台楼宇季度记录，须已锁定且非草稿。';

export function MapMarketDataDetails({ title, stats, active }: { title: string; stats: MapStatsState; active: boolean }) {
  const period = marketObservationLabel(stats.periods);
  const area = compactMarketArea(stats).exact;
  return <MapDisclosure className="map-context-disclosure" width={384} active={active} heading={marketDataLabel}
    label={<>
      <h1 title={title}>{title}</h1>
      <span className="map-market-context" id="map-market-context">
        {Object.keys(stats.periods ?? {}).length > 1 ? '当前存量 · 跨季度' : period}
      </span>
      <span className="sr-only">，{marketDataLabel}</span>
    </>}>
    <div className={styles.methodology}>
      <p>{period}</p>
      {area && <p>已知存量面积 {area} ㎡</p>}
      <p>范围为平台收录、命中当前筛选的存量项目，含产业园。地图项目数包含当前地图显示的未来供应。</p>
      <p>{latestMethod}</p>
      {stats.rentSample && stats.vacancySample && <>
        <dl className={styles.methodologySamples}>
          <MetricSample label="净有效租金" {...stats.rentSample} />
          <MetricSample label="空置率" {...stats.vacancySample} />
        </dl>
        <p>面积覆盖以筛选范围内已知存量面积为分母。</p>
      </>}
      <p>{formalSource}</p>
    </div>
  </MapDisclosure>;
}

export function MarketDataDetails({ children }: { children: ReactNode }) {
  return <details className={styles.source}>
    <summary>{marketDataLabel}</summary>
    {children}
  </details>;
}

type ResearchDetailsProps = {
  name: string;
  summary: SubmarketSummary;
  buildings: readonly MarketBuilding[];
  benchmarkBuildings?: readonly MarketBuilding[];
  parkOnly: boolean;
};

/** Compute the metric-specific dates only when the reader opens the methods. */
export function SubmarketMarketDataDetails(props: ResearchDetailsProps) {
  return <MapDisclosure label={marketDataLabel} heading={marketDataLabel} width={428} className="map-methodology-trigger">
    <ResearchMethodology {...props} />
  </MapDisclosure>;
}

function ResearchMethodology({ name, summary, buildings, benchmarkBuildings, parkOnly }: ResearchDetailsProps) {
  const current = parkOnly ? null : describeCurrentResearchMarket(name, buildings, benchmarkBuildings);
  return <div className={styles.methodology}>
    <section>
      <h3>当前筛选的存量</h3>
      <p>{parkOnly ? '统计命中筛选的产业园项目及已知面积，面积采用各楼宇最新已发布记录。' : '统计平台收录且命中筛选的甲乙级项目，超甲级计入甲级。产业园和未来供应另计。'}</p>
      {current && <>
        <p>{latestMethod}</p>
        <dl className={styles.methodologySamples}>
          <MetricSample label="净有效租金" periods={current.rent.periods} count={summary.rentSampleCount}
            area={summary.rentSampleArea} coverage={summary.rentCoverage} />
          <MetricSample label="空置率" periods={current.vacancyPct.periods} count={summary.vacancySampleCount}
            area={summary.vacancySampleArea} coverage={summary.vacancyCoverage} />
        </dl>
        <p>面积覆盖以已知存量面积为分母。</p>
        {(current.rent.benchmark || current.vacancyPct.benchmark) && <p>
          北京同口径：{[
            current.rent.benchmark && `净有效租金 ${researchNumber(current.rent.benchmark.cityValue)} 元/㎡/月`,
            current.vacancyPct.benchmark && `空置率 ${researchNumber(current.vacancyPct.benchmark.cityValue)}%`,
          ].filter(Boolean).join('、')}。北京样本保留其他筛选，含本区及其他有有效观测的子市场。比较取同季度，本区、北京各至少两个有效样本。
        </p>}
      </>}
    </section>
    <section>
      <h3>完整子市场的季度行情</h3>
      <p>按所选等级读取完整授权子市场，当年及前四个日历年各季度独立计算。历史按当前楼宇归属及等级统计。仅纳入有效正面积，租金须大于零，空置率使用当季记录的有效空置面积。缺失季度留空。</p>
      <p>环比、同比相隔一季和四季，每期至少两个有效样本。同样本变化以至少两个两期均有效的共同项目重新加权。面积覆盖相差至少 10 个百分点时提示。空置率变化用百分点表示。</p>
      <p>{formalSource}</p>
    </section>
  </div>;
}

function MetricSample({ label, periods, count, area, coverage }: {
  label: string; periods?: string[]; count: number; area: number; coverage: SubmarketSummary['rentCoverage'];
}) {
  const percentage = (ratio: number | null) => ratio == null ? '未收录' : `${researchNumber(ratio * 100)}%`;
  return <div>
    <dt>{label}</dt>
    <dd>{periods && `${periods.length ? periods.join('、') : '暂无有效季度'} · `}{researchNumber(count, 0)} 个有效样本</dd>
    {count > 0 && <dd>{researchNumber(area, 0)} ㎡ · 项目覆盖 {percentage(coverage.count)} · 面积覆盖 {percentage(coverage.area)}</dd>}
  </div>;
}
