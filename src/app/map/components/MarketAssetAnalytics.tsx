'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { MAP_SUBMARKETS, MAP_SUBMARKETS_SECONDARY } from '../model/mapDomain';
import { normalizeMapSubmarket, officeGrade } from '../model/marketIdentity';
import { quarterLabel } from '../model/quarterlyFacts';
import { useMapObjectReadingState } from '../workspace/continuity';
import { classifyResearchMarket } from '../model/submarketProductResearch';
import type { ResearchMarketType } from '../model/submarketResearchPresentation';
import { MIN_RESEARCH_MARKET_SAMPLES } from '../model/submarketMarketTrend';
import { marketResearchArrangement, researchAnalysisModules, type ResearchAnalysisModule } from '../model/submarketResearchArrangement';
import { researchNumber } from '../model/submarketResearch';
import { analyzeMarketAssets, latestAssetQuarter, productNames, RESEARCH_PRODUCTS, summarizeResearchSupply,
  type AssetObservation, type MarketAssetResearchPayload, type ResearchProductScope } from '../model/marketAssetAnalytics';
import type { MarketBuilding } from '../model/marketStatistics';
import { fetchMarketAssetResearch } from '@/src/services/map/marketAssetResearchClient';
import { observeBusinessReading } from '@/src/utils/businessReadingAudit';
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
  if (count === 1) return <section className={styles.section} aria-label="租金价格分布"><h4>单项目租金观测</h4><p className={styles.subtle}>元/㎡/月 · 不代表区域租金分布</p><ProjectList points={observations} onOpen={onOpen} /></section>;
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
          <span>{number(bin.low, 2)}–{bin.last ? '' : '<'}{number(bin.high, 2)}</span>
          <Bar value={bin.ids.length} max={Math.max(...bins.map(b => b.ids.length))} /><span>{bin.ids.length}</span>
        </button>)}</div>
      {selectedIds && <><div className={styles.heading}><p>{selectedIds.size} 个区间内项目</p><button type="button" className={styles.action} onClick={() => setSelected(null)}>清除区间</button></div>
        <ProjectList points={observations.filter(p => selectedIds.has(p.id))} onOpen={onOpen} /></>}
    </> : <ProjectList points={observations} onOpen={onOpen} />}
  </section>;
}

function Matrix({ rows, heading }: { rows: Comparison[]; heading: string }) {
  const rentMax = Math.max(1, ...rows.map(row => row.analysis.statistics.rentSampleCount >= MIN_RESEARCH_MARKET_SAMPLES ? row.analysis.statistics.rent ?? 0 : 0));
  return <section className={styles.section} aria-label={heading}><h4>{heading}</h4><div className={styles.tableWrap}>
    <table className={styles.matrix} aria-label={heading}><thead><tr><th scope="col">范围</th><th scope="col">净有效租金<br />元/㎡/月</th><th scope="col">空置率<br />%</th><th scope="col">楼宇租金中位数<br />元/㎡/月</th><th scope="col">当前跟踪项目</th><th scope="col">当季已知面积<br />万㎡</th></tr></thead>
      <tbody>{rows.map(({ label, analysis }) => {
        const { statistics: s, distribution } = analysis;
        const rent = s.rentSampleCount >= MIN_RESEARCH_MARKET_SAMPLES ? s.rent : null;
        const vacancy = s.vacancySampleCount >= MIN_RESEARCH_MARKET_SAMPLES ? s.vacancyPct : null;
        return <tr key={label}><th scope="row">{label}</th>
          <td>{fmt(rent)}{rent !== null ? <><Bar value={rent} max={rentMax} /><span>{s.rentSampleCount} 样本</span></> : s.rentSampleCount === 1 ? <span>单项目观测</span> : null}</td>
          <td>{fmt(vacancy)}{vacancy !== null ? <><Bar value={vacancy} max={100} vacancy /><span>{s.vacancySampleCount} 样本</span></> : s.vacancySampleCount === 1 ? <span>单项目观测</span> : null}</td>
          <td>{distribution && distribution.count >= MIN_RESEARCH_MARKET_SAMPLES ? fmt(distribution.median) : '—'}{distribution && distribution.count >= MIN_RESEARCH_MARKET_SAMPLES && <span>中间50% {fmt(distribution.q1)}–{fmt(distribution.q3)}</span>}</td>
          <td>{s.projectCount}</td><td>{s.areaSamples ? fmt(s.stockArea / 10000) : '—'}{s.areaSamples > 0 && <span>{s.areaSamples} 项</span>}</td></tr>;
      })}</tbody>
    </table></div></section>;
}

function Supply({ payload, name }: { payload: MarketAssetResearchPayload; name: string }) {
  const supply = React.useMemo(() => payload.supplies === null ? null : summarizeResearchSupply(payload.supplies, name), [payload.supplies, name]);
  if (!supply) return <p role="status" className={styles.subtle}>未来供应暂不可用。</p>;
  if (!supply.count && !supply.enteredCount) return null;
  return <section className={styles.section} aria-label="未来供应分析"><div className={styles.heading}><h4>未来供应</h4><span className={styles.subtle}>当前供应状态 · 非历史快照</span></div>
    <dl className={styles.stats}><div><dt>预计供应项目</dt><dd>{supply.count} 个</dd></div><div><dt>已知供应面积</dt><dd>{supply.area === null ? '—' : fmt(supply.area / 10000) + ' 万㎡'}（{supply.known} 项）</dd></div>{supply.enteredCount > 0 && <div><dt>原供应已入市</dt><dd>{supply.enteredCount} 个</dd></div>}</dl>
    <div className={styles.groupRows}>{supply.years.map(row => <div key={row.label}><span>{row.label === '待定' ? '时间待定' : row.label + '年'}</span>
      <Bar value={row.count} max={Math.max(...supply.years.map(y => y.count))} /><span>{row.count} 个{row.area !== null && ' · ' + fmt(row.area / 10000) + ' 万㎡'}</span></div>)}</div>
    <p className={styles.subtle}>{supply.products.map(row => row.label + ' ' + row.count + ' 个').join(' · ')}</p>
    {supply.projects.length > 0 && <details><summary>查看预计入市项目</summary><div className={styles.tableWrap}><table className={styles.matrix}><thead><tr><th>项目</th><th>预计入市</th><th>面积㎡</th></tr></thead><tbody>{supply.projects.map(p =>
      <tr key={p.id}><th scope="row">{p.name}<span className={styles.subtle}> · {p.product}</span></th><td>{p.period}</td><td>{fmt(p.area, 0)}</td></tr>)}</tbody></table></div></details>}
  </section>;
}

function Demand({ payload, name, onOpen }: { payload: MarketAssetResearchPayload; name: string; onOpen: (id: string) => void }) {
  const demand = payload.demand[name];
  if (!payload.demandAvailable) return <p role="status" className={styles.subtle}>成交分析暂不可用。</p>;
  if (!demand) return null;
  const groups = [{ label: '面积区间', rows: demand.size }, { label: '行业需求', rows: demand.industries },
    { label: '租赁类型', rows: demand.types }, { label: '季度成交', rows: demand.quarters }];
  return <section className={styles.section} aria-label="租赁需求与成交"><div className={styles.heading}><h4>租赁需求与成交</h4><span className={styles.subtle}>{demand.year}年 · 平台收录成交</span></div>
    <dl className={styles.stats}><div><dt>有效成交</dt><dd>{demand.count} 笔</dd></div><div><dt>收录成交面积</dt><dd>{fmt(demand.area / 10000)} 万㎡</dd></div></dl>
    {groups.filter(group => group.rows.length).map(group => <div key={group.label}><h4>{group.label}（按面积）</h4><div className={styles.groupRows}>
      {group.rows.map(row => <div key={row.label}><span>{row.label}</span><Bar value={row.area} max={demand.area} /><span>{fmt(row.area / 10000)} 万㎡ · {row.count} 笔</span></div>)}
    </div></div>)}
    {!!demand.projects?.length && <div><h4>典型楼宇成交样本</h4><div className={styles.projectList}>
      {demand.projects.flatMap(project => {
        const asset = payload.assets.find(item => item.id === project.buildingId && item.submarket === name);
        return asset ? [<button type="button" key={project.buildingId} onClick={() => onOpen(project.buildingId)}>
          <span>{asset.name}</span><span>{project.count} 笔 · {fmt(project.area / 10000)} 万㎡</span>
        </button>] : [];
      })}
    </div></div>}
    <p className={styles.subtle}>平台当年收录、精确关联楼宇的成交；非全市场成交量。个别交易及过少样本不单列。</p>
  </section>;
}

function MarketContexts({ payload, names, product, period, onOpen }: {
  payload: MarketAssetResearchPayload; names: string[]; product: ResearchProductScope; period: number; onOpen: (id: string) => void;
}) {
  const regions = names.flatMap(name => {
    const context = payload.contexts?.[name];
    const members = payload.assets.filter(asset => asset.submarket === name);
    const rows = RESEARCH_PRODUCTS.map(grade => ({ grade, count: members.filter(asset => officeGrade(asset.grade) === grade).length })).filter(row => row.count);
    const selected = analyzeMarketAssets(members, name, period, product).distribution;
    const example = selected ? selected.observations.reduce<AssetObservation | null>((best, point) => !best || Math.abs(point.rent! - selected.median) < Math.abs(best.rent! - selected.median) ? point : best, null) : null;
    const curated = context?.projects ?? [];
    if (!context && !rows.length && !example) return [];
    return [{ name, context, rows, example, curated }];
  });
  if (!regions.length) return null;
  return <section className={styles.section} aria-label={names.length > 1 ? '区域特点与代表项目' : '研究项目与选址特点'}>
    <h4>{names.length > 1 ? '区域特点与代表项目' : '研究项目与选址特点'}</h4>
    <div className={styles.contextRows}>{regions.map(({ name, context, rows, example, curated }) => <article key={name}>
      {names.length > 1 && <h4>{name}</h4>}
      {context?.positioning && <p>{context.positioning}</p>}
      {rows.length > 0 && <p className={styles.subtle}>{rows.map(row => productNames[row.grade] + ' ' + row.count + ' 个').join(' · ')}（当前跟踪）</p>}
      {curated.map(project => {
        const asset = payload.assets.find(item => item.id === project.buildingId && item.submarket === name);
        return asset ? <div key={project.buildingId}><button type="button" className={styles.action} onClick={() => onOpen(asset.id)}>{asset.name} · {project.role}</button><p>{project.reason}</p></div> : null;
      })}
      {example && !curated.some(project => project.buildingId === example.id) && <button type="button" className={styles.action} onClick={() => onOpen(example.id)}>
        {example.name} · {productNames[example.grade]}{example.rent === null ? '' : ' · ' + fmt(example.rent) + ' 元/㎡/月'}
      </button>}
    </article>)}</div>
  </section>;
}

type AnalysisReading = { opened: boolean; period: number | null; others: string[]; product: ResearchProductScope };
export function MarketAssetAnalytics({ buildings, submarket, onOpen, identity, active = true, marketType, authorizedQuarter }: {
  buildings: readonly MarketBuilding[]; submarket: string; onOpen: (id: string) => void;
  identity?: string; active?: boolean; marketType?: ResearchMarketType; authorizedQuarter?: number | null;
}) {
  const name = normalizeMapSubmarket(submarket);
  const catalogQuarter = React.useMemo(() => latestAssetQuarter(buildings, name), [buildings, name]);
  const latest = authorizedQuarter ?? catalogQuarter;
  const type = marketType ?? classifyResearchMarket(name, buildings.flatMap(b => b.id && normalizeMapSubmarket(b.submarket) === name ? [{ id: b.id, grade: b.grade }] : [])).type;
  const [reading, setReading] = useMapObjectReadingState<AnalysisReading>('marketAnalysis', identity ?? name, {
    opened: false, period: null, others: [], product: type === 'park' ? 'park' : 'office',
  });
  const { opened, others } = reading;
  const plan = marketResearchArrangement(name);
  const allowedProducts: readonly ResearchProductScope[] = type === 'park' ? ['park'] : type === 'office' ? ['office', 'a', 'b'] : ['office', ...RESEARCH_PRODUCTS];
  const product = allowedProducts.includes(reading.product) ? reading.product : allowedProducts[0];
  const [showOther, setShowOther] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  const [read, setRead] = React.useState<{ key: string; data: MarketAssetResearchPayload | null; error: boolean } | null>(null);
  const now = new Date();
  const baseQuarter = latest ?? now.getUTCFullYear() * 4 + Math.floor(now.getUTCMonth() / 3);
  const period = reading.period ?? baseQuarter;
  const chosen = [name, ...others.filter(value => markets.includes(value) && value !== name)];
  const key = JSON.stringify([period, [...new Set(chosen)].slice(0, 3), retry]);
  React.useEffect(() => {
    if (!active || !opened || !markets.includes(name)) return;
    const controller = new AbortController();
    const [, selected] = JSON.parse(key) as [number, string[]];
    void fetchMarketAssetResearch(selected, period, controller.signal).then(data => {
      if (!controller.signal.aborted) {
        setRead({ key, data, error: false });
        for (const market of selected) observeBusinessReading('VIEW_SUBMARKET', 'map', { target_table: 'submarket_profiles', target_id: market, submarket: market, section: 'market_analysis', observation: 'view_displayed' }, 'submarket');
      }
    }).catch(() => { if (!controller.signal.aborted) setRead({ key, data: null, error: true }); });
    return () => controller.abort();
  }, [active, opened, period, key, name]);
  const payload = active && read?.key === key ? read.data : null;
  const productRows = React.useMemo(() => !payload ? [] : RESEARCH_PRODUCTS.map(grade => ({
    label: productNames[grade], analysis: analyzeMarketAssets(payload.assets, name, period, grade),
  })).filter(row => row.analysis.statistics.projectCount > 0), [payload, name, period]);
  const analysis = React.useMemo(() => payload ? analyzeMarketAssets(payload.assets, name, period, product) : null, [payload, name, period, product]);
  const comparison = React.useMemo(() => !payload ? [] : (JSON.parse(key)[1] as string[]).map(market => ({
    label: market, analysis: analyzeMarketAssets(payload.assets, market, period, product),
  })), [payload, period, product, key]);
  if (!markets.includes(name)) return null;
  const quarters = [...new Set([period, ...Array.from({ length: 8 }, (_, index) => baseQuarter - index)])].sort((a, b) => b - a);
  const updateOthers = (next: string[]) => setReading(previous => ({ ...previous, others: next }));
  return <section className={styles.analytics} aria-label="市场深度分析">
    <button className={styles.action} type="button" aria-expanded={opened} onClick={() => {
      setRead(null); setReading(previous => ({ ...previous, opened: !previous.opened }));
    }}>{opened ? '收起市场深度分析' : (plan?.analysisTitle ?? '市场深度分析与区域比较')}</button>
    {opened && <>
      <div className={styles.toolbar}>
        <label>查询季度<select value={period} onChange={event => setReading(previous => ({ ...previous, period: Number(event.target.value) }))}>
          {quarters.map(value => <option key={value} value={value}>{quarterLabel(value)}</option>)}
        </select></label>
        <label>产品范围<select value={product} onChange={event => setReading(previous => ({ ...previous, product: event.target.value as ResearchProductScope }))}>
          {allowedProducts.map(grade => <option key={grade} value={grade}>{productNames[grade]}</option>)}
        </select></label>
        {others.map((market, index) => <div key={index}><label>比较区域 {index + 1}<select value={market} onChange={event => updateOthers(others.map((value, i) => i === index ? event.target.value : value))}>
          <option value="">选择区域</option>{markets.filter(item => item !== name && (!others.includes(item) || item === market)).map(item => <option key={item}>{item}</option>)}
        </select></label><button type="button" className={styles.action} onClick={() => updateOthers(others.filter((_, i) => i !== index))}>移除比较区域 {index + 1}</button></div>)}
        {others.length < 2 && <button type="button" className={styles.action} onClick={() => updateOthers([...others, ''])}>添加比较区域</button>}
      </div>
      <p className={styles.subtle}>{name} · {quarterLabel(period)} · 完整授权子市场，不改变地图筛选</p>
      {!payload ? read?.key === key && read.error ? <div role="status">分析暂不可用。<button type="button" className={styles.action} onClick={() => setRetry(value => value + 1)}>重试</button></div>
        : <p role="status">正在读取同季度行情…</p> : <>
        {comparison.length > 1 && <Matrix rows={comparison} heading="子市场同季度比较" />}
        {(() => {
          const modules: Record<ResearchAnalysisModule, React.ReactNode> = {
            product: productRows.length > 1 ? <Matrix rows={productRows} heading="产品结构与行情比较" /> : null,
            distribution: analysis?.distribution ? <Distribution key={key + product} analysis={analysis} onOpen={onOpen} /> : null,
            scatter: analysis && analysis.paired.length > 0 && <section className={styles.section} aria-label="租金与空置率关联">
          <div className={styles.heading}><h4>租金与空置率</h4><span className={styles.subtle}>{analysis.paired.length} 个同季度配对项目</span></div>
          {analysis.paired.length >= 3 ? <>
            <p className={styles.subtle}>横轴净有效租金（元/㎡/月） · 纵轴空置率（%）</p>
            <div className={styles.legend}>{RESEARCH_PRODUCTS.filter(grade => analysis.paired.some(point => point.grade === grade)).map(grade => <span data-grade={grade} key={grade}><i aria-hidden="true" />{productNames[grade]}</span>)}</div>
            <Scatter points={analysis.paired} onOpen={onOpen} />
            <p className={styles.subtle}>点大小反映已知面积{analysis.paired.length >= 5 ? '；虚线为配对样本中位数' : ''}。</p>
            <details><summary>查看散点对应楼宇</summary><ProjectList points={analysis.paired} onOpen={onOpen} /></details>
          </> : <ProjectList points={analysis.paired} onOpen={onOpen} />}
        </section>,
            context: <MarketContexts payload={payload} names={comparison.map(row => row.label)} product={product} period={period} onOpen={onOpen} />,
            demand: !payload.demandAvailable || payload.demand[name] ? <Demand payload={payload} name={name} onOpen={onOpen} /> : null,
            supply: payload.supplies === null || (() => { const summary = summarizeResearchSupply(payload.supplies, name); return summary.count > 0 || summary.enteredCount > 0; })()
              ? <Supply payload={payload} name={name} /> : null,
          };
          const order = plan?.analysis ?? researchAnalysisModules;
          const more = researchAnalysisModules.filter(module => !order.includes(module) && modules[module]);
          return <>
            {order.map(module => <React.Fragment key={module}>{modules[module]}</React.Fragment>)}
            {order.includes('distribution') && !analysis?.distribution && (plan?.benchmark || !plan) && <p className={styles.subtle}>当前产品在该季度暂无有效租金观测。</p>}
            {!!more.length && <button type="button" className={styles.action} aria-expanded={showOther} onClick={() => setShowOther(value => !value)}>{showOther ? '收起其他分析' : '其他可用分析'}</button>}
            {showOther && more.map(module => <React.Fragment key={module}>{modules[module]}</React.Fragment>)}
          </>;
        })()}
      </>}
    </>}
  </section>;
}
