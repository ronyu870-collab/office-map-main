'use client';

import * as React from 'react';
import { Button } from '@/src/components/ui/Button';
import { trustedQueryClient, type QueryClientScope } from '@/src/services/trustedQueryClient';
import { chartBounds, lineGeometry, type ChartRequest, type ResultChart } from '@/src/lib/intelligence/query/charts';
import { units, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { useQueryPresentationReceipt } from './useQueryPresentationReceipt';
import styles from './HomeQuery.module.css';

type Props = { result: QueryResultView; requestId: string; scope: QueryClientScope; internalExport: boolean;
  onSource: (ids: readonly string[], label: string, trigger: HTMLButtonElement) => void };
export function HomeQueryArtifacts({ result, requestId, scope, internalExport, onSource }: Props) {
  const numeric = result.table.columns.filter(c => c.unit && result.table.rows.every(r => r.cells[c.key]?.kind !== 'text'));
  const [field, setField] = React.useState(numeric[0]?.key ?? '');
  const [chart, setChart] = React.useState<ResultChart | null>(null);
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [page, setPage] = React.useState(0);
  useQueryPresentationReceipt(scope, chart, chart ? { surface: 'chart', page, pageSize: 25, layout: chart.kind === 'line'?'line_all':chart.kind === 'scatter' ? 'scatter_all' : 'bar_page' } : null);
  const active = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const request: ChartRequest = result.operation==='trend'?{kind:'time_series'}:result.operation === 'compare' ? { kind: 'period_comparison' } : { kind: 'bar', field };
  async function run(input: ChartRequest | 'xlsx' | 'csv_zip' | 'svg_zip') {
    if (active.current) return;
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
        setChart(next); setPage(0); setMessage('图表沿用本次结果，未重新查询数据。');
      }
    } catch (error) {
      if (!controller.signal.aborted) { setChart(null); setMessage(error instanceof Error ? error.message : '图表或下载未完成，请重试。'); }
    } finally { if (!controller.signal.aborted) setBusy(false); if (active.current === controller) active.current = null; }
  }
  const shown = chart?.points.slice(page * 25, (page + 1) * 25) ?? [];
  const [min, max] = chart ? chartBounds(chart, 'y') : [0, 0];
  const span = max - min || 1;
  const position = (value: number) => (value - min) / span * 100;
  return <div className={styles.artifacts}>
    <div className={styles.actions}>
      {numeric.length > 1 && result.operation !== 'compare' && result.operation!=='trend' && <label className={styles.chartSelect}>图表指标<select value={field} disabled={busy} onChange={e => setField(e.target.value)}>{numeric.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>}
      {numeric.length > 0 && <Button variant="secondary" disabled={busy} onClick={() => void run(request)}>{result.operation==='trend'?(chart?'更新折线图':'查看折线图'):(chart ? '更新柱状图' : '查看柱状图')}</Button>}
      {result.operation==='trend' && <Button variant="ghost" disabled={busy} onClick={()=>void run({kind:'bar',field:'value'})}>查看柱状图</Button>}
      {result.operation === 'list' && numeric.length >= 2 && <Button variant="ghost" disabled={busy} onClick={() => void run({ kind: 'scatter', x: numeric[0].key, y: numeric[1].key })}>查看散点图</Button>}
      {chart && <Button variant="ghost" onClick={() => setChart(null)}>收起图表</Button>}
      {internalExport && <details className={styles.exportMenu}><summary>下载本次结果</summary><div className={styles.actions}>
        <Button variant="ghost" disabled={busy} onClick={() => void run('xlsx')}>Excel</Button>
        <Button variant="ghost" disabled={busy} onClick={() => void run('csv_zip')}>CSV 与来源</Button>
        {numeric.length > 0 && <Button variant="ghost" disabled={busy} onClick={() => void run('svg_zip')}>SVG 图与来源</Button>}
      </div></details>}
    </div>
    <p role="status" className={styles.notice}>{message}</p>
    {chart && <figure className={styles.chart} aria-label="同源查询图表">
      <figcaption>{chart.kind === 'scatter' ? `${chart.xLabel}与${chart.yLabel}` : chart.yLabel}（{units[chart.yUnit] ?? chart.yUnit}）。有效图示 {chart.renderedCount} 项，未知 {chart.unknownCount} 项；未知不画成零。</figcaption>
      {chart.kind === 'bar' ? <>
        <p className={styles.notice}>统一零基线，数轴范围 {min}–{max}；点选数值查看来源。</p>
        <div>{shown.map((point, i) => <div className={styles.barRow} key={`${point.yCell.entityId}:${point.yCell.key}:${i}`}>
          <span>{point.label}</span><div className={styles.barTrack} aria-hidden="true"><i className={styles.zero} style={{ left: `${position(0)}%` }} />{point.y !== null && <i className={styles.bar} style={{ left: `${Math.min(position(0), position(point.y))}%`, width: `${Math.abs(position(point.y) - position(0))}%` }} />}</div>
          <button type="button" className={styles.cell} onClick={event => onSource(point.yCell.sourceIds, `${point.label}：${point.yText}`, event.currentTarget)}>{point.yText}</button>
        </div>)}</div>
        {chart.points.length > 25 && <div className={styles.tableFooter}><p>图示第 {page * 25 + 1}–{Math.min((page + 1) * 25, chart.points.length)} 条，共 {chart.points.length} 条；分页不改变统计范围。</p><div className={styles.actions}><Button variant="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页图示</Button><Button variant="ghost" disabled={(page + 1) * 25 >= chart.points.length} onClick={() => setPage(p => p + 1)}>下一页图示</Button></div></div>}
      </> : chart.kind==='line'?<TrendLine chart={chart}/>:<Scatter chart={chart} />}
      {chart.kind==='line' && <p className={styles.notice}>季度连续排列，缺数据处断线；数值与来源见下方原表。横向滚动可查看全部季度。</p>}
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

function TrendLine({chart}:{chart:ResultChart}) {
  const plot=lineGeometry(chart);
  return <div className={styles.scatterScroll} tabIndex={0} aria-label="季度趋势图，可横向滚动；缺期断线，来源见原表">
    <svg width={plot.width} height={plot.height} role="img" aria-label={`${chart.yLabel}季度趋势，${chart.points.length}个季度，${chart.unknownCount}个季度未知`}>
      <path d={`M${plot.left} ${plot.top} V${plot.bottom} H${plot.right}`} fill="none" stroke="#667085"/>
      {plot.segments.map((segment,i)=><polyline key={i} points={segment} fill="none" stroke="#003e7e" strokeWidth="2"/>)}
      {plot.points.map(p=><g key={p.point.label}>{p.y!==null&&<circle cx={p.x} cy={p.y} r="4" fill="#003e7e"><title>{p.point.label}：{p.point.yText}</title></circle>}<text x={p.x} y={plot.bottom+26} textAnchor="middle">{p.point.label}</text></g>)}
      <text x={plot.left-10} y={plot.top+5} textAnchor="end">{plot.max}</text><text x={plot.left-10} y={plot.bottom} textAnchor="end">{plot.min}</text>
      <text x={plot.left} y={plot.height-8}>季度；{chart.yLabel}（{units[chart.yUnit]??chart.yUnit}）</text>
    </svg>
  </div>;
}
