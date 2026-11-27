'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { MAP_SUBMARKETS, MAP_SUBMARKETS_SECONDARY } from '../model/mapDomain';
import { normalizeMapSubmarket, officeGrade } from '../model/marketIdentity';
import { quarterLabel } from '../model/quarterlyFacts';
import { researchNumber } from '../model/submarketResearch';
import { analyzeMarketAssets, latestAssetQuarter, productNames, RESEARCH_PRODUCTS, summarizeResearchSupply,
  type AssetObservation, type MarketAssetResearchPayload, type ResearchProductScope } from '../model/marketAssetAnalytics';
import type { MarketBuilding } from '../model/marketStatistics';
import { fetchMarketAssetResearch } from '@/src/services/map/marketAssetResearchClient';
import styles from './MarketAssetAnalytics.module.css';

const Scatter = dynamic(() => import('./MarketAssetScatter').then(m => m.MarketAssetScatter), { ssr: false });
const markets = [...MAP_SUBMARKETS, ...MAP_SUBMARKETS_SECONDARY].filter(name => name !== '其他');
const fmt = (value: number | null, decimals = 1) => value === null ? '—' : researchNumber(value, decimals);
const number = (value: number, decimals = 0) => researchNumber(value, decimals);
type Analysis = ReturnType<typeof analyzeMarketAssets>;
type Comparison = { label: string; analysis: Analysis };

function Bar({ value, max, vacancy = false }: { value: number; max: number; vacancy?: boolean }) {
  return <span className={styles.bar + (vacancy ? ' ' + styles.vacancyBar : '')} aria-hidden="true"><i style={{ width: Math.max(0, Math.min(100, value / Math.max(1, max) * 100)) + '%' }} /></span>;
}
function ProjectList({ points, onOpen }: { points: readonly AssetObservation[]; onOpen: (id: string) => void }) {
  return <div className={styles.projectList}>{points.map(point => <button key={point.id} type="button" onClick={() => onOpen(point.id)}>
    <span>{point.name} · {productNames[point.grade]}</span><span>{fmt(point.rent)}{point.vacancy !== null ? ' / ' + fmt(point.vacancy) + '%' : ''}</span>
  </button>)}</div>;
}

function Distribution({ analysis, onOpen }: { analysis: Analysis; onOpen: (id: string) => void }) {
  const { distribution, statistics } = analysis;
  const [selected, setSelected] = React.useState<number | null>(null);
  if (!distribution) return null;
  const { count, min, max, q1, median, q3, bins, observations } = distribution;
  const selectedIds = selected !== null && bins[selected] ? new Set(bins[selected].ids) : null;
  return <section className={styles.section} aria-label="租金价格分布">
    <div className={styles.heading}><h4>租金价格分布</h4><span className={styles.subtle}>{count} 个楼宇样本 · 元/㎡/月</span></div>
    <dl className={styles.stats}>
      <div><dt>楼宇中位数</dt><dd>{fmt(median)}</dd></div>
      <div><dt>主流区间（中间50%）</dt><dd>{fmt(q1)}–{fmt(q3)}</dd></div>
      <div><dt>最低–最高</dt><dd>{fmt(min)}–{fmt(max)}</dd></div>
      <div><dt>面积加权平均</dt><dd>{fmt(statistics.rent)}</dd></div>
    </dl>
    {bins.length ? <>
      <div className={styles.bins} role="group" aria-label="选择租金区间查看楼宇">{bins.map((bin, index) =>
        <button type="button" key={bin.low} className={styles.bin} disabled={!bin.ids.length} aria-pressed={selected === index}
          onClick={() => setSelected(selected === index ? null : index)}>
          <span>{number(bin.low, 2)}–{number(bin.high, 2)}{bin.last ? '' : '未含上限'}</span>
          <Bar value={bin.ids.length} max={Math.max(...bins.map(b => b.ids.length))} /><span>{bin.ids.length}</span>
        </button>)}</div>
      {selectedIds && <><div className={styles.heading}><p>{selectedIds.size} 个区间内项目</p><button type="button" className={styles.action} onClick={() => setSelected(null)}>清除区间</button></div>
        <ProjectList points={observations.filter(p => selectedIds.has(p.id))} onOpen={onOpen} /></>}
    </> : <ProjectList points={observations} onOpen={onOpen} />}
  </section>;
}

function Matrix({ rows, heading, representative = false }: { rows: Comparison[]; heading: string; representative?: boolean }) {
  const rentMax = Math.max(1, ...rows.map(row => row.analysis.statistics.rent ?? 0));
  return <section className={styles.section} aria-label={heading}><h4>{heading}</h4><div className={styles.tableWrap}>
    <table className={styles.matrix} aria-label={heading}><thead><tr><th scope="col">范围</th><th scope="col">净有效租金<br />元/㎡/月</th><th scope="col">空置率<br />%</th><th scope="col">项目</th><th scope="col">当季已知面积<br />万㎡</th></tr></thead>
      <tbody>{rows.map(({ label, analysis }) => {
        const { statistics: s, distribution } = analysis;
        const example = distribution?.observations.reduce<AssetObservation | null>((best, p) => !best || Math.abs(p.rent! - distribution.median) < Math.abs(best.rent! - distribution.median) ? p : best, null);
        return <tr key={label}><th scope="row">{label}{representative && example && <span className={styles.subtle}> · {example.name}</span>}</th>
          <td>{fmt(s.rent)}{s.rent !== null && <><Bar value={s.rent} max={rentMax} /><span>{s.rentSampleCount} 样本</span></>}</td>
          <td>{fmt(s.vacancyPct)}{s.vacancyPct !== null && <><Bar value={s.vacancyPct} max={100} vacancy /><span>{s.vacancySampleCount} 样本</span></>}</td>
          <td>{s.projectCount}</td><td>{s.areaSamples ? fmt(s.stockArea / 10000) : '—'}{s.areaSamples > 0 && <span>{s.areaSamples} 项</span>}</td></tr>;
      })}</tbody>
    </table></div></section>;
}

function Supply({ payload, name }: { payload: MarketAssetResearchPayload; name: string }) {
  const supply = React.useMemo(() => payload.supplies === null ? null : summarizeResearchSupply(payload.supplies, name), [payload.supplies, name]);
  if (!supply || !supply.count) return null;
  return <section className={styles.section} aria-label="未来供应分析"><div className={styles.heading}><h4>未来供应</h4><span className={styles.subtle}>当前预计入市项目</span></div>
    <dl className={styles.stats}><div><dt>项目</dt><dd>{supply.count} 个</dd></div><div><dt>已知供应面积</dt><dd>{supply.area === null ? '—' : fmt(supply.area / 10000) + ' 万㎡'}（{supply.known} 项）</dd></div></dl>
    <div className={styles.groupRows}>{supply.years.map(row => <div key={row.label}><span>{row.label === '待定' ? '时间待定' : row.label + '年'}</span>
      <Bar value={row.count} max={Math.max(...supply.years.map(y => y.count))} /><span>{row.count} 个{row.area !== null && ' · ' + fmt(row.area / 10000) + ' 万㎡'}</span></div>)}</div>
    <p className={styles.subtle}>{supply.products.map(row => row.label + ' ' + row.count + ' 个').join(' · ')}</p>
    <details><summary>查看预计入市项目</summary><div className={styles.tableWrap}><table className={styles.matrix}><thead><tr><th>项目</th><th>预计入市</th><th>面积㎡</th></tr></thead><tbody>{supply.projects.map(p =>
      <tr key={p.id}><th scope="row">{p.name}<span className={styles.subtle}> · {p.product}</span></th><td>{p.period}</td><td>{fmt(p.area, 0)}</td></tr>)}</tbody></table></div></details>
  </section>;
}

function Demand({ payload, name }: { payload: MarketAssetResearchPayload; name: string }) {
  const demand = payload.demand[name];
  if (!payload.demandAvailable || !demand) return null;
  const groups = [{ label: '面积区间', rows: demand.size }, { label: '行业需求', rows: demand.industries },
    { label: '租赁类型', rows: demand.types }, { label: '季度成交', rows: demand.quarters }];
  return <section className={styles.section} aria-label="租赁需求与成交"><div className={styles.heading}><h4>租赁需求与成交</h4><span className={styles.subtle}>{demand.year}年 · 平台收录成交</span></div>
    <dl className={styles.stats}><div><dt>有效成交</dt><dd>{demand.count} 笔</dd></div><div><dt>收录成交面积</dt><dd>{fmt(demand.area / 10000)} 万㎡</dd></div></dl>
    {groups.filter(group => group.rows.length).map(group => <div key={group.label}><h4>{group.label}（按面积）</h4><div className={styles.groupRows}>
      {group.rows.map(row => <div key={row.label}><span>{row.label}</span><Bar value={row.area} max={demand.area} /><span>{fmt(row.area / 10000)} 万㎡ · {row.count} 笔</span></div>)}
    </div></div>)}
    <p className={styles.subtle}>仅含当年正式收录且精确关联楼宇的当前成交；非全市场成交量。少量个别案例不单列。</p>
  </section>;
}

export function MarketAssetAnalytics({ buildings, submarket, onOpen }: { buildings: readonly MarketBuilding[]; submarket: string; onOpen: (id: string) => void }) {
  const name = normalizeMapSubmarket(submarket);
  const latest = React.useMemo(() => latestAssetQuarter(buildings, name), [buildings, name]);
  const [opened, setOpened] = React.useState(false);
  const [offset, setOffset] = React.useState(0);
  const [others, setOthers] = React.useState<string[]>([]);
  const [product, setProduct] = React.useState<ResearchProductScope>(() => buildings.some(b => ['a', 'b'].includes(officeGrade(b.grade))) ? 'office' : 'park');
  const [retry, setRetry] = React.useState(0);
  const [read, setRead] = React.useState<{ key: string; data: MarketAssetResearchPayload | null; error: boolean } | null>(null);
  const period = latest === null ? null : latest - offset;
  const chosen = [name, ...others.filter(Boolean)];
  const key = JSON.stringify([period, chosen, retry]);
  React.useEffect(() => {
    if (!opened || period === null) return;
    const controller = new AbortController();
    const [, selected] = JSON.parse(key) as [number, string[]];
    void fetchMarketAssetResearch(selected, period, controller.signal).then(data => {
      if (!controller.signal.aborted) setRead({ key, data, error: false });
    }).catch(() => { if (!controller.signal.aborted) setRead({ key, data: null, error: true }); });
    return () => controller.abort();
  }, [opened, period, key]);
  const payload = read?.key === key ? read.data : null;
  const productRows = React.useMemo(() => !payload || period === null ? [] : RESEARCH_PRODUCTS.map(grade => ({
    label: productNames[grade], analysis: analyzeMarketAssets(payload.assets, name, period, grade),
  })).filter(row => row.analysis.statistics.projectCount > 0), [payload, name, period]);
  const analysis = React.useMemo(() => payload && period !== null ? analyzeMarketAssets(payload.assets, name, period, product) : null, [payload, name, period, product]);
  const comparison = React.useMemo(() => !payload || period === null ? [] : (JSON.parse(key)[1] as string[]).map(market => ({
    label: market, analysis: analyzeMarketAssets(payload.assets, market, period, product),
  })), [payload, period, product, key]);
  if (latest === null || !markets.includes(name)) return null;
  return <section className={styles.analytics} aria-label="市场深度分析">
    <button className={styles.action} type="button" aria-expanded={opened} onClick={() => setOpened(value => !value)}>{opened ? '收起市场深度分析' : '市场深度分析与区域比较'}</button>
    {opened && <>
      <div className={styles.toolbar}>
        <label>行情季度<select value={offset} onChange={event => setOffset(Number(event.target.value))}>
          {Array.from({ length: 8 }, (_, index) => <option key={index} value={index}>{quarterLabel(latest - index)}</option>)}
        </select></label>
        <label>产品范围<select value={product} onChange={event => setProduct(event.target.value as ResearchProductScope)}>
          {(['office', ...RESEARCH_PRODUCTS] as const).map(grade => <option key={grade} value={grade}>{productNames[grade]}</option>)}
        </select></label>
        {others.map((market, index) => <div key={index}><label>比较区域 {index + 1}<select value={market} onChange={event => setOthers(old => old.map((value, i) => i === index ? event.target.value : value))}>
          <option value="">选择区域</option>{markets.filter(item => item !== name && (!others.includes(item) || item === market)).map(item => <option key={item}>{item}</option>)}
        </select></label><button type="button" className={styles.action} onClick={() => setOthers(old => old.filter((_, i) => i !== index))}>移除比较区域 {index + 1}</button></div>)}
        {others.length < 2 && <button type="button" className={styles.action} onClick={() => setOthers(old => [...old, ''])}>添加比较区域</button>}
      </div>
      <p className={styles.subtle}>{name} · {quarterLabel(period!)} · 完整授权子市场，不改变地图筛选</p>
      {!payload ? read?.key === key && read.error ? <div role="status">分析暂不可用。<button type="button" className={styles.action} onClick={() => setRetry(value => value + 1)}>重试</button></div>
        : <p role="status">正在读取同季度行情…</p> : <>
        {comparison.length > 1 && <Matrix rows={comparison} heading="子市场同季度比较" representative />}
        {productRows.length > 1 && <Matrix rows={productRows} heading="产品结构与行情比较" />}
        {analysis?.distribution ? <Distribution key={key + product} analysis={analysis} onOpen={onOpen} /> : <p className={styles.subtle}>当前产品在该季度暂无有效租金观测。</p>}
        {analysis && analysis.paired.length > 0 && <section className={styles.section} aria-label="租金与空置率关联">
          <div className={styles.heading}><h4>租金与空置率</h4><span className={styles.subtle}>{analysis.paired.length} 个同季度配对项目</span></div>
          {analysis.paired.length >= 3 ? <>
            <p className={styles.subtle}>横轴净有效租金（元/㎡/月） · 纵轴空置率（%）</p>
            <div className={styles.legend}>{RESEARCH_PRODUCTS.map(grade => <span key={grade}><i aria-hidden="true" />{productNames[grade]}</span>)}</div>
            <Scatter points={analysis.paired} onOpen={onOpen} />
            <p className={styles.subtle}>点大小反映已知面积{analysis.paired.length >= 5 ? '；虚线为配对样本中位数' : ''}。</p>
            <details><summary>查看散点对应楼宇</summary><ProjectList points={analysis.paired} onOpen={onOpen} /></details>
          </> : <ProjectList points={analysis.paired} onOpen={onOpen} />}
        </section>}
        <Demand payload={payload} name={name} />
        <Supply payload={payload} name={name} />
      </>}
    </>}
  </section>;
}
