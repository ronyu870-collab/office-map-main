'use client';

import type { SubmarketTrendPoint, SubmarketTrendSeries } from '../model/submarketMarketTrend';
import { MIN_RESEARCH_MARKET_SAMPLES } from '../model/submarketMarketTrend';
import { latestProductComparison, latestProductObservation, representativeResearchMetric, type MarketProducts, type ResearchProduct } from '../model/submarketProductResearch';
import { researchNumber, signedResearchNumber } from '../model/submarketResearch';
import type { ResearchMarketType } from '../model/submarketResearchPresentation';
import { ResearchCoreMetrics, type ResearchCoreMetric } from './SubmarketResearchPresentation';
import type { SubmarketResearchTrendState } from './SubmarketResearchData';

const label = (product: ResearchProduct) => product === 'park' ? '产业园' : '甲乙级办公';
const products = (type: ResearchMarketType): ResearchProduct[] => type === 'mixed' ? ['office', 'park'] : ['park'];
const points = (series: SubmarketTrendSeries | undefined, product: ResearchProduct) => (product === 'park' ? series?.park : series?.all) ?? [];
const formatChange = (value: number | null | undefined, unit: string, period: string) => value != null && Number.isFinite(value) ? `${period} ${signedResearchNumber(value)}${unit}` : '';

function metricContext(point: SubmarketTrendPoint, metric: 'rent' | 'vacancyPct', measured: boolean) {
  const key = metric === 'rent' ? 'rent' : 'vacancy';
  const count = metric === 'rent' ? point.rentSamples : point.vacancySamples;
  const unit = metric === 'rent' ? '%' : '个百分点';
  const qoq = point.sameSampleQoq?.[key], yoy = point.sameSampleYoy?.[key];
  const changeValue = (change: typeof qoq) => change && change.samples >= MIN_RESEARCH_MARKET_SAMPLES ? (metric === 'rent' ? change.rentPct : change.vacancyPp) : null;
  return [point.period + ` · ${count} 个样本`, measured && formatChange(changeValue(qoq), unit, '同样本环比'),
    measured && formatChange(changeValue(yoy), unit, '同样本同比')].filter(Boolean).join(' · ');
}

export function ProductResearchCore({ type, inventory, filteredOfficeCount, filteredParkCount, series, state, measured }: {
  type: ResearchMarketType; inventory?: MarketProducts; filteredOfficeCount: number; filteredParkCount: number;
  series?: SubmarketTrendSeries; state: SubmarketResearchTrendState; measured: boolean;
}) {
  return <div className="submarket-product-core" aria-label="分产品市场行情">
    {products(type).map(product => {
      const name = label(product);
      const count = product === 'park' ? inventory?.parkCount ?? filteredParkCount : inventory?.officeCount ?? filteredOfficeCount;
      // New product market figures require the complete authorized stock contract.
      const data = state === 'ready' && inventory ? points(series, product) : [];
      const items: ResearchCoreMetric[] = [{ key: 'projects', label: product === 'park' ? '产业园项目' : '甲乙级项目', value: count, unit: '个', precision: 0 }];
      const rent = latestProductObservation(data, 'rent'), vacancy = latestProductObservation(data, 'vacancyPct');
      const rentValue = representativeResearchMetric(rent, 'rent'), vacancyValue = representativeResearchMetric(vacancy, 'vacancyPct');
      if (rent && rentValue != null) items.push({ key: 'rent', label: '净有效租金', value: rentValue, unit: '元/㎡/月', context: metricContext(rent, 'rent', measured) });
      if (vacancy && vacancyValue != null) items.push({ key: 'vacancy', label: '空置率', value: vacancyValue, unit: '%', context: metricContext(vacancy, 'vacancyPct', measured) });
      const area = data.findLast(point => (point.stockSamples ?? 0) > 0 && (point.stockArea ?? 0) > 0);
      if (area && area.stockArea != null) items.push({ key: 'area', label: '已知存量面积', value: area.stockArea / 10000, unit: '万㎡',
        context: `${area.period} · ${area.stockSamples}/${count} 个项目` });
      const limited = [rent && rentValue == null && `${rent.period} 租金仅 ${rent.rentSamples} 个有效样本`,
        vacancy && vacancyValue == null && `${vacancy.period} 空置率仅 ${vacancy.vacancySamples} 个有效样本`].filter(Boolean);
      return <div key={product} className="submarket-product-section" data-research-product={product}>
        <ResearchCoreMetrics measured={false} label={type === 'park' ? '市场核心指标' : name + '核心指标'}
          scope={(inventory ? '完整子市场' : '当前筛选') + ' · ' + name} items={items} />
        {limited.length > 0 ? <p className="submarket-v3-context">{limited.join('；')}，暂不形成区域行情。</p>
          : state === 'ready' && !rent && !vacancy ? <p className="submarket-v3-context">暂无正式季度行情。</p>
            : state === 'loading' ? <p role="status" className="submarket-v3-context">正在读取季度行情…</p>
              : state === 'error' ? <p role="status" className="submarket-v3-context">季度行情暂不可用。</p> : null}
      </div>;
    })}
  </div>;
}

export function ProductResearchStructure({ type, series, state }: {
  type: ResearchMarketType; series?: SubmarketTrendSeries; state: SubmarketResearchTrendState;
}) {
  if (state !== 'ready') return null;
  const cohorts = products(type).flatMap(product => {
    const data = points(series, product);
    const rent = data.findLast(point => point.rentDistribution != null && representativeResearchMetric(point, 'rent') != null);
    const size = data.findLast(point => point.sizeDistribution != null);
    return rent || size ? [{ product, rent, size }] : [];
  });
  const comparisons = type === 'mixed' ? (['rent', 'vacancyPct'] as const).flatMap(metric => {
    const match = latestProductComparison(points(series, 'office'), points(series, 'park'), metric);
    return match ? [{ metric, ...match }] : [];
  }) : [];
  if (!cohorts.length && !comparisons.length) return null;
  return <div className="submarket-product-structure">
    {comparisons.length > 0 && <section className="submarket-v3-chapter" aria-label="同季度产品比较">
      <h3>商务办公与研发园区</h3>
      <dl className="submarket-product-comparison">
        {comparisons.map(({ metric, period, office, park }) => <div key={metric}>
          <dt>{metric === 'rent' ? '净有效租金' : '空置率'} · {period}</dt>
          <dd>甲乙级办公 <strong>{researchNumber(office)}{metric === 'rent' ? ' 元/㎡/月' : '%'}</strong></dd>
          <dd>产业园 <strong>{researchNumber(park)}{metric === 'rent' ? ' 元/㎡/月' : '%'}</strong></dd>
        </div>)}
      </dl>
    </section>}
    {cohorts.map(({ product, rent, size }) => <section key={product} className="submarket-v3-chapter" aria-label={label(product) + '产品结构'}>
      <h3>{label(product)}产品结构</h3>
      <dl className="submarket-product-comparison">
        {rent?.rentDistribution && <div>
          <dt>项目租金中间50%区间</dt>
          <dd><strong>{researchNumber(rent.rentDistribution.p25)}–{researchNumber(rent.rentDistribution.p75)}</strong> 元/㎡/月</dd>
          <dd className="submarket-v3-context">{rent.period} · {rent.rentDistribution.samples} 个有效项目 · 中位数 {researchNumber(rent.rentDistribution.median)}</dd>
        </div>}
        {size?.sizeDistribution && <div>
          <dt>项目规模中间50%区间</dt>
          <dd><strong>{researchNumber(size.sizeDistribution.p25 / 10000)}–{researchNumber(size.sizeDistribution.p75 / 10000)}</strong> 万㎡</dd>
          <dd className="submarket-v3-context">{size.period} · {size.sizeDistribution.samples} 个项目 · 最大 {researchNumber(size.sizeDistribution.max / 10000)} 万㎡</dd>
        </div>}
      </dl>
    </section>)}
  </div>;
}
