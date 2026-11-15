'use client';

import * as React from 'react';
import { Button } from '@/src/components/ui/Button';
import { trustedQueryClient, type QueryClientScope } from '@/src/services/trustedQueryClient';
import { chartBounds, distributionGeometry, chartFacets, heatmapFill, heatmapLegend, lineGeometry, type ChartRequest, type ResultChart } from '@/src/lib/intelligence/query/charts';
import { distributionStatLabels } from '@/src/lib/intelligence/query/distribution';
import { formatExact, units, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { useQueryPresentationReceipt } from './useQueryPresentationReceipt';
import styles from './HomeQuery.module.css';

type Props = { result: QueryResultView; requestId: string; scope: QueryClientScope; internalExport: boolean;
  onSource: (ids: readonly string[], label: string, trigger: HTMLButtonElement) => void };
export function HomeQueryArtifacts({ result, requestId, scope, internalExport, onSource }: Props) {
  const numeric = React.useMemo(() => result.table.columns.filter(c => c.unit && result.table.rows.every(r => r.cells[c.key]?.kind !== 'text')), [result]);
  const [field, setField] = React.useState(numeric[0]?.key ?? '');
  const [chart, setChart] = React.useState<ResultChart | null>(null);
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [page, setPage] = React.useState(0);
  useQueryPresentationReceipt(scope, chart, chart ? { surface: 'chart', page, pageSize: 25, layout: chart.kind === 'histogram'?'histogram_all':chart.kind === 'box_plot'?'box_plot_all':chart.kind === 'heatmap'?'heatmap_all':chart.kind === 'faceted_line'?'faceted_line_all':chart.kind === 'line'?'line_all':chart.kind === 'scatter' ? 'scatter_all' : 'bar_page' } : null);
  const active = React.useRef<AbortController | null>(null);
  const completedRequest = React.useRef<string | null>(null);
  React.useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const isTrend = result.operation === 'trend' || result.operation === 'group_trend';
  const isCross = result.operation === 'cross_aggregate';
  const isDistribution = result.operation === 'distribution';
  const isRelationship = result.operation === 'relationship';
  const request: ChartRequest = React.useMemo(() => isDistribution?{kind:'histogram'}:isRelationship?{kind:'scatter',x:'rent',y:'vacancy'}:isCross?{kind:'heatmap'}:result.operation==='group_trend'?{kind:'grouped_time_series'}:result.operation==='trend'?{kind:'time_series'}:result.operation === 'compare' ? { kind: 'period_comparison' } : { kind: 'bar', field }, [isDistribution, isRelationship, isCross, result.operation, field]);
  const run = React.useCallback(async (input: ChartRequest | 'xlsx' | 'csv_zip' | 'svg_zip') => {
    if (active.current || (typeof input !== 'string' && completedRequest.current === JSON.stringify(input))) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage(typeof input === 'string' ? '正在核对导出权限并生成文件…' : '正在核对权限并生成同源图表…');
    try {
      if (typeof input === 'string') {
        const file = await trustedQueryClient.download(scope, { requestId, resultId: result.resultId, action: 'export', format: input,
          ...(input === 'svg_zip' ? { chart: chart?.request ?? request } : {}) }, controller.signal);
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(file.blob), anchor = document.createElement('a');
        anchor.href = url; anchor.download = file.filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
        void trustedQueryClient.reportDelivery(scope, file, 'browser_download_dispatched');
        // Give the browser time to take ownership of the download, then release it.
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
        setMessage('文件已交给浏览器下载；包含原结果与来源。尚未确认本机保存完成，仅供内部分析。');
      } else {
        const next = await trustedQueryClient.chart(scope, requestId, result, input, controller.signal);
        if (controller.signal.aborted) return;
        completedRequest.current = JSON.stringify(input);
        setChart(next); setPage(0); setMessage('');
      }
    } catch (error) {
      if (!controller.signal.aborted) { if (typeof input !== 'string') { setChart(null); completedRequest.current = null; } setMessage(error instanceof Error ? error.message : '图表或下载未完成，请重试。'); }
    } finally { if (!controller.signal.aborted) setBusy(false); if (active.current === controller) active.current = null; }
  }, [scope, requestId, result, chart, request]);
  // Defer one microtask so StrictMode's discarded setup cannot dispatch a chart.
  // Charts use the same authorized result; exports always require a user action.
  const automaticKey = `${requestId}:${result.resultId}:${field}`;
  const started = React.useRef<string | null>(null);
  const canAuto = result.operation !== 'aggregate' && result.operation !== 'list' && numeric.length > 0 && result.table.rows.some(row => row.cells[field]?.kind === 'number');
  React.useEffect(() => {
    let disposed = false;
    if (canAuto) queueMicrotask(() => {
      if (disposed || started.current === automaticKey) return;
      started.current = automaticKey;
      void run(request);
    });
    return () => { disposed = true; };
  }, [automaticKey, canAuto, request, run]);
  const shown = chart?.points.slice(page * 25, (page + 1) * 25) ?? [];
  const [min, max] = chart ? chartBounds(chart, 'y') : [0, 0];
  const span = max - min || 1;
  const position = (value: number) => (value - min) / span * 100;
  return <div className={styles.artifacts}>
    <div className={styles.actions}>
      {numeric.length > 1 && result.operation !== 'compare' && !isTrend && !isCross && !isRelationship && !isDistribution && <label className={styles.chartSelect}>图表指标<select value={field} disabled={busy} onChange={e => setField(e.target.value)}>{numeric.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>}
      {numeric.length > 0 && result.operation !== 'aggregate' && <Button variant="secondary" disabled={busy} onClick={() => void run(request)}>{isDistribution?'查看直方图':isRelationship?'查看散点图':isCross?'查看热力表':isTrend?'查看折线图':'查看柱状图'}</Button>}
      {isDistribution && <Button variant="ghost" disabled={busy} onClick={()=>void run({kind:'box_plot'})}>查看箱线图</Button>}
      {(isTrend || isCross) && <Button variant="ghost" disabled={busy} onClick={()=>void run({kind:'bar',field:'value'})}>查看柱状图</Button>}
      {result.operation === 'list' && numeric.length >= 2 && <Button variant="ghost" disabled={busy} onClick={() => void run({ kind: 'scatter', x: numeric[0].key, y: numeric[1].key })}>查看散点图</Button>}
      {chart && <Button variant="ghost" onClick={() => { setChart(null); completedRequest.current = null; }}>收起图表</Button>}
      {internalExport && <details className={styles.exportMenu}><summary>下载本次结果</summary><div className={styles.actions}>
        <Button variant="ghost" disabled={busy} onClick={() => void run('xlsx')}>Excel</Button>
        <Button variant="ghost" disabled={busy} onClick={() => void run('csv_zip')}>CSV 与来源</Button>
        {numeric.length > 0 && <Button variant="ghost" disabled={busy} onClick={() => void run('svg_zip')}>SVG 图与来源</Button>}
      </div></details>}
    </div>
    <p role="status" className={styles.notice}>{message}</p>
    {chart && <figure className={styles.chart} aria-label="同源查询图表">
      <figcaption>{chart.distribution ? `${chart.distribution.label}（${units[chart.distribution.unit]??chart.distribution.unit}），有效样本 ${chart.distribution.validCount} 栋，排除 ${chart.distribution.excludedCount} 栋。` : <>{chart.kind === 'scatter' ? `${chart.xLabel}（${units[chart.xUnit ?? ''] ?? chart.xUnit}）与${chart.yLabel}（${units[chart.yUnit] ?? chart.yUnit}）` : `${chart.yLabel}（${units[chart.yUnit] ?? chart.yUnit}）`}。有效图示 {chart.renderedCount} 项，未知 {chart.unknownCount} 项；未知不画成零。</>}</figcaption>
      {chart.kind === 'histogram'||chart.kind === 'box_plot' ? <DistributionPlot chart={chart} onSource={onSource}/> : chart.kind === 'heatmap' ? <Heatmap chart={chart} onSource={onSource}/> : chart.kind === 'bar' ? <>
        <p className={styles.notice}>统一零基线，数轴范围 {min}–{max}；点选数值查看来源。</p>
        <div>{shown.map((point, i) => <div className={styles.barRow} key={`${point.yCell.entityId}:${point.yCell.key}:${i}`}>
          <span>{point.label}</span><div className={styles.barTrack} aria-hidden="true"><i className={styles.zero} style={{ left: `${position(0)}%` }} />{point.y !== null && <i className={styles.bar} style={{ left: `${Math.min(position(0), position(point.y))}%`, width: `${Math.abs(position(point.y) - position(0))}%` }} />}</div>
          <button type="button" className={styles.cell} onClick={event => onSource(point.yCell.sourceIds, `${point.label}：${point.yText}`, event.currentTarget)}>{point.yText}</button>
        </div>)}</div>
        {chart.points.length > 25 && <div className={styles.tableFooter}><p>图示第 {page * 25 + 1}–{Math.min((page + 1) * 25, chart.points.length)} 条，共 {chart.points.length} 条；分页不改变统计范围。</p><div className={styles.actions}><Button variant="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页图示</Button><Button variant="ghost" disabled={(page + 1) * 25 >= chart.points.length} onClick={() => setPage(p => p + 1)}>下一页图示</Button></div></div>}
      </> : chart.kind==='faceted_line'?<><p className={styles.notice}>各组共用相同纵轴范围 {min}–{max}，缺期断线。数值和来源见下方原表。</p>{chartFacets(chart).map((part,i)=><div key={chart.facets![i].key}><p>{part.title}</p><TrendLine chart={part} height={250} bounds={[min,max]}/></div>)}</>:chart.kind==='line'?<TrendLine chart={chart}/>:<Scatter chart={chart} />}
      {(chart.kind==='line'||chart.kind==='faceted_line') && <p className={styles.notice}>季度连续排列，缺数据处断线；数值与来源见下方原表。横向滚动可查看全部季度。</p>}
      {chart.kind === 'scatter' && <p className={styles.notice}>仅绘制两个字段都有有效值的联合样本，不代表因果关系。各楼数值和可点选来源见下方原表。</p>}
    </figure>}
  </div>;
}
function Scatter({ chart }: { chart: ResultChart }) {
  const valid = chart.points.filter(p => p.state === 'valid');
  const [xmin, xmax] = chartBounds(chart, 'x'), [ymin, ymax] = chartBounds(chart, 'y');
  return <div className={styles.scatterScroll} tabIndex={0} aria-label="散点图，可横向滚动；明细见原表"><svg width="640" height="380" role="img" aria-label={`${chart.xLabel}与${chart.yLabel}，有效联合样本 ${valid.length}`}>
    <path d="M70 30 V320 H600" fill="none" stroke="#667085" />
    {valid.map((p, i) => <circle key={i} cx={70 + ((p.x as number) - xmin) / (xmax - xmin || 1) * 530} cy={320 - (p.y! - ymin) / (ymax - ymin || 1) * 290} r="4" fill="#003e7e"><title>{p.label}：{p.xText}，{p.yText}</title></circle>)}
    <text x="60" y="35" textAnchor="end">{ymax}</text><text x="60" y="320" textAnchor="end">{ymin}</text><text x="70" y="344">{xmin}</text><text x="600" y="344" textAnchor="end">{xmax}</text>
    <text x="70" y="370">{chart.xLabel}（{units[chart.xUnit ?? ''] ?? chart.xUnit}）</text>
  </svg></div>;
}

function TrendLine({chart,height=380,bounds}:{chart:ResultChart;height?:number;bounds?:[number,number]}) {
  const plot=lineGeometry(chart,undefined,height,bounds);
  return <div className={styles.scatterScroll} tabIndex={0} aria-label="季度趋势图，可横向滚动；缺期断线，来源见原表">
    <svg width={plot.width} height={plot.height} role="img" aria-label={`${chart.title}，${chart.yLabel}季度趋势，${chart.points.length}个季度，${chart.unknownCount}个季度未知`}>
      <path d={`M${plot.left} ${plot.top} V${plot.bottom} H${plot.right}`} fill="none" stroke="#667085"/>
      {plot.segments.map((segment,i)=><polyline key={i} points={segment} fill="none" stroke="#003e7e" strokeWidth="2"/>)}
      {plot.points.map(p=><g key={p.point.label}>{p.y!==null&&<circle cx={p.x} cy={p.y} r="4" fill="#003e7e"><title>{p.point.label}：{p.point.yText}</title></circle>}<text x={p.x} y={plot.bottom+26} textAnchor="middle">{p.point.label}</text></g>)}
      <text x={plot.left-10} y={plot.top+5} textAnchor="end">{plot.max}</text><text x={plot.left-10} y={plot.bottom} textAnchor="end">{plot.min}</text>
      <text x={plot.left} y={plot.height-8}>季度；{chart.yLabel}（{units[chart.yUnit]??chart.yUnit}）</text>
    </svg>
  </div>;
}

function Heatmap({chart,onSource}:{chart:ResultChart;onSource:Props['onSource']}) {
  const grid = chart.grid;
  if (!grid) return null;
  const bounds = chartBounds(chart, 'y');
  return <><p className={styles.notice}>{heatmapLegend(chart)}</p>
    <div className={styles.heatmapScroll} tabIndex={0} aria-label="子市场与等级热力表，可横向滚动">
      <table className={styles.heatmap}><caption>各子市场 × 等级的{chart.yLabel}（{units[chart.yUnit] ?? chart.yUnit}）</caption>
        <thead><tr><th scope="col">子市场 / 等级</th>{grid.columns.map(column=><th scope="col" key={column.key}>{column.label}</th>)}</tr></thead>
        <tbody>{grid.rows.map((row,i)=><tr key={row.key}><th scope="row">{row.label}</th>{grid.columns.map((column,j)=>{
          const point=chart.points[i*grid.columns.length+j];
          return <td key={column.key} style={{backgroundColor:heatmapFill(point.y,bounds)}}><button type="button" className={styles.cell}
            aria-label={`查看来源：${point.label}，${point.yText}，有效 ${point.sampleCount} 栋`}
            onClick={event=>onSource(point.yCell.sourceIds,`${point.label}：${point.yText}`,event.currentTarget)}>{point.y===null?'未知':point.yText}</button><p>有效 {point.sampleCount} 栋</p></td>;
        })}</tr>)}</tbody>
      </table>
    </div></>;
}

function DistributionPlot({chart,onSource}:{chart:ResultChart;onSource:Props['onSource']}) {
  const d=chart.distribution!;
  if(!d.stats)return <p>没有有效样本，无法绘制分布；未知未按零绘制。</p>;
  const g=distributionGeometry(chart),maxCount=Math.max(1,...chart.points.map(p=>p.y??0));
  const x=(key:keyof NonNullable<typeof d.stats>)=>g.scale(g.stat(key));
  const percent=(coordinate:number)=>`${coordinate/640*100}%`;
  return <>
    <div className={styles.scatterScroll} tabIndex={0} aria-label="分布图，可横向滚动；精确数值与来源见下方">
      {chart.kind==='histogram'?<svg width="640" height="320" role="img" aria-label={`${d.label}直方图，${d.validCount}栋有效样本`}>
        <path d="M50 20 V260 H620" fill="none" stroke="#667085"/>
        {chart.points.map((p,i)=>{const width=560/chart.points.length,left=55+i*width,height=(p.y??0)/maxCount*210;return <g key={p.yCell.entityId}><rect x={left} y={260-height} width={Math.max(1,width-2)} height={height} fill="#bacfe5"><title>{p.label}：{p.yText}栋</title></rect><text x={left+width/2} y={250-height} textAnchor="middle">{p.yText}</text><text x={left+width/2} y="284" textAnchor="middle">{i+1}</text></g>;})}
        <text x="50" y="310">区间编号（边界见下方）；纵向为楼宇数量</text>
      </svg>:<svg width="100%" height="200" role="img" aria-label={`${d.label}箱线图，${d.validCount}栋有效样本`}>
        <line x1={percent(x('lowerWhisker'))} x2={percent(x('upperWhisker'))} y1="80" y2="80" stroke="#667085"/>
        <rect x={percent(x('q1'))} y="55" width={percent(x('q3')-x('q1'))} height="50" fill="#bacfe5" stroke="#667085"/>
        {(['lowerWhisker','median','upperWhisker'] as const).map(key=><line key={key} x1={percent(x(key))} x2={percent(x(key))} y1="55" y2="105" stroke="#003e7e"/>)}
        {chart.points.filter(p=>p.outlier===true&&p.y!==null).map(p=><circle key={p.yCell.entityId} cx={percent(g.scale(p.y!))} cy="80" r="4" fill="#003e7e"><title>{p.label}：{p.yText}</title></circle>)}
        <text x={percent(70)} y="145">{g.min}</text><text x={percent(600)} y="145" textAnchor="end">{g.max}</text><text x={percent(70)} y="180">{d.label}（{units[d.unit]??d.unit}）</text>
      </svg>}
    </div>
    <details className={styles.trace}><summary>分位数与箱线数值</summary><div className={styles.tableScroll} tabIndex={0} aria-label="分布统计数值，可滚动"><table><caption className="sr-only">分位算法Type 7，数值与来源来自本次结果</caption><thead><tr><th>统计量</th><th>数值（{units[d.unit]??d.unit}）</th></tr></thead><tbody>{(Object.keys(distributionStatLabels) as (keyof typeof distributionStatLabels)[]).map(key=><tr key={key}><th scope="row">{distributionStatLabels[key]}</th><td className={styles.number}><button type="button" className={styles.cell} onClick={event=>onSource(d.sourceIds,`${distributionStatLabels[key]}：${formatExact(d.stats![key],d.unit)}`,event.currentTarget)}>{formatExact(d.stats![key],d.unit)}</button></td></tr>)}</tbody></table></div></details>
    {chart.kind==='histogram'?<div className={styles.tableScroll} tabIndex={0} aria-label="分箱边界与数量，可滚动"><table><caption className="sr-only">分箱边界与数量</caption><thead><tr><th>区间（{units[d.unit]??d.unit}）</th><th>楼宇数量</th></tr></thead><tbody>{chart.points.map(p=><tr key={p.yCell.entityId}><th scope="row">{p.label}</th><td className={styles.number}><button type="button" className={styles.cell} onClick={event=>onSource(p.yCell.sourceIds,`${p.label}：${p.yText}栋`,event.currentTarget)}>{p.yText} 栋</button></td></tr>)}</tbody></table></div>:<p>箱体为P25–P75，中线为中位数；须线到围栏内的实际记录，点为围栏外记录。{d.assessment==='insufficient_sample'?'不足4栋未判定离群，须线使用最小/最大值。':'离群值仍参与全部统计。'}</p>}
  </>;
}
