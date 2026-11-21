'use client';

import * as React from 'react';
import { Button } from '@/src/components/ui/Button';
import { agentChartDescriptorSchema } from '@/src/lib/intelligence/query/chartProtocol';
import { renderChartSvg, type ChartRequest, type ResultChart } from '@/src/lib/intelligence/query/charts';
import { units, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { trustedQueryClient, type QueryClientScope } from '@/src/services/trustedQueryClient';
import { useQueryPresentationReceipt } from './useQueryPresentationReceipt';
import styles from './HomeQuery.module.css';
import workspaceStyles from './HomeQueryChartWorkspace.module.css';

type Props = { result: QueryResultView; requestId: string; scope: QueryClientScope; internalExport: boolean; visible?: boolean;
  initialRequest?: ChartRequest; onSource: (ids: readonly string[], label: string, trigger: HTMLButtonElement) => void };

/** Same fixed SVG geometry as downloaded SVG/PNG. No model-supplied markup. */
export function HomeQueryChartWorkspace({ result, requestId, scope, internalExport, onSource, visible = true, initialRequest }: Props) {
  const descriptor = React.useMemo(() => agentChartDescriptorSchema.safeParse(result.parameters.agentChart).data, [result]);
  const initial = initialRequest ?? descriptor?.request;
  const [chart, setChart] = React.useState<ResultChart | null>(null);
  const [draft, setDraft] = React.useState<ChartRequest | undefined>(initial);
  const [message, setMessage] = React.useState(''), [busy, setBusy] = React.useState(false), [page, setPage] = React.useState(0);
  const [selectedPoint, setSelectedPoint] = React.useState<number | null>(null);
  const [minimum, setMinimum] = React.useState(initial?.yAxis?.min?.toString() ?? '');
  const [maximum, setMaximum] = React.useState(initial?.yAxis?.max?.toString() ?? '');
  const [ticks, setTicks] = React.useState(initial?.yAxis?.ticks ?? 5);
  const active = React.useRef<AbortController | null>(null), started = React.useRef(false);
  const numeric = result.table.columns.filter(c => c.unit && result.table.rows.every(row => row.cells[c.key].kind !== 'text'));
  useQueryPresentationReceipt(scope, chart, chart ? { surface: 'chart', page: 0, pageSize: 25, layout: 'workspace_all' } : null, visible);
  React.useEffect(() => () => { active.current?.abort(); }, [requestId, result.resultId, scope.actorId, scope.effectiveId, scope.sessionId, scope.targetId]);
  const draw = React.useCallback(async (request: ChartRequest) => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setMessage('正在核对权限并绘制…');
    try {
      const next = await trustedQueryClient.chart(scope, requestId, result, request, controller.signal);
      if (controller.signal.aborted) return;
      setChart(next); setDraft(request); setPage(0); setSelectedPoint(null); setMessage('');
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '图表未完成，请调整规格重试。'); }
    finally { if (!controller.signal.aborted) setBusy(false); if (active.current === controller) active.current = null; }
  }, [result, requestId, scope]);
  React.useEffect(() => {
    let disposed = false;
    if (visible && initial && !started.current) queueMicrotask(() => {
      if (disposed || started.current) return;
      started.current = true; void draw(initial);
    });
    return () => { disposed = true; };
  }, [initial, draw, visible]);
  const svg = React.useMemo(() => chart ? renderChartSvg(chart) : '', [chart]);
  if (!initial) return null;
  async function download(format: 'png_zip' | 'svg_zip') {
    if (active.current || !chart) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setMessage('正在核对导出权限并生成图片与来源包…');
    try {
      const file = await trustedQueryClient.download(scope, { requestId, resultId: result.resultId, action: 'export', format, chart: chart.request }, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(file.blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = file.filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      void trustedQueryClient.reportDelivery(scope, file, 'browser_download_dispatched');
      setMessage('浏览器已发起图片与来源包下载；尚未确认文件已实际保存。仅供内部分析。');
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '图片下载未完成，请重试。'); }
    finally { if (!controller.signal.aborted) setBusy(false); if (active.current === controller) active.current = null; }
  }
  function apply(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const min = minimum.trim() ? Number(minimum) : undefined, max = maximum.trim() ? Number(maximum) : undefined;
    if (min !== undefined && !Number.isFinite(min) || max !== undefined && !Number.isFinite(max)) { setMessage('坐标范围须填写有限数值，留空使用默认范围。'); return; }
    void draw({ ...draft, yAxis: { ...draft.yAxis, min, max, ticks } });
  }
  return <section className={workspaceStyles.workspace} aria-label="专业图表工作区">
    <div className={styles.actions}>
      {descriptor?.format && <span>服务器已生成{descriptor.format === 'png_zip' ? ' PNG' : ' SVG'} 与来源包</span>}
      {internalExport && <><Button variant="ghost" disabled={busy || !chart} onClick={() => void download('png_zip')}>下载 PNG 与来源</Button>
        <Button variant="ghost" disabled={busy || !chart} onClick={() => void download('svg_zip')}>下载 SVG 与来源</Button></>}
      {!chart && <Button variant="ghost" disabled={busy} onClick={() => void draw(initial)}>生成图表</Button>}
    </div>
    <p role="status" className={styles.notice}>{message}</p>
    {chart && <figure className={workspaceStyles.figure}>
      <figcaption>{chart.title}　{chart.yLabel}（{units[chart.yUnit] ?? chart.yUnit}）</figcaption>
      <div className={workspaceStyles.canvas} tabIndex={0} aria-label="图表画布，可滚动查看完整图形；逐点数值与来源在下方"
        onClick={event => {
          const point = (event.target as Element).closest?.('[data-entity][data-key]');
          if (!point) return;
          const index = chart.points.findIndex(p => p.yCell.entityId === point.getAttribute('data-entity') && p.yCell.key === point.getAttribute('data-key'));
          if (index >= 0) setSelectedPoint(index);
        }} dangerouslySetInnerHTML={{ __html: svg }} />
      <p className={styles.notice}>有效图示 {chart.renderedCount} 项，未知 {chart.unknownCount} 项。未知不按零绘制；调整图形不改变原表数值。</p>
      {selectedPoint !== null && chart.points[selectedPoint] && <div className={styles.actions}><span>{chart.points[selectedPoint].label}：{chart.points[selectedPoint].yText}</span><Button variant="ghost" onClick={event => { const point = chart.points[selectedPoint]; onSource([...new Set([...point.yCell.sourceIds, ...(point.xCell?.sourceIds ?? [])])], `${point.label}：${point.xText}，${point.yText}`, event.currentTarget); }}>查看图元来源</Button></div>}
      <details><summary>图示数值与来源</summary>
        <div className={styles.tableScroll} tabIndex={0} aria-label="图示数值与来源表，可横向滚动"><table><thead><tr><th>对象</th><th>{chart.xLabel}</th><th>{chart.yLabel}</th></tr></thead>
          <tbody>{chart.points.slice(page * 25, (page + 1) * 25).map((point, i) => <tr key={`${page}:${i}`}><th scope="row">{point.label}</th><td>{point.xCell ? <button type="button" className={styles.cell} onClick={event => onSource(point.xCell!.sourceIds, `${point.label}：${point.xText}`, event.currentTarget)}>{point.xText}</button> : point.xText}</td><td><button type="button" className={styles.cell}
            onClick={event => onSource(point.yCell.sourceIds, `${point.label}：${point.yText}`, event.currentTarget)}>{point.yText}</button></td></tr>)}</tbody></table></div>
        <div className={styles.actions}><span>第 {chart.points.length ? page * 25 + 1 : 0}–{Math.min((page + 1) * 25, chart.points.length)} 项，共 {chart.points.length} 项；画布与导出包含全部图示。</span>
          <Button variant="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页数值</Button>
          <Button variant="ghost" disabled={(page + 1) * 25 >= chart.points.length} onClick={() => setPage(p => p + 1)}>下一页数值</Button></div>
      </details>
    </figure>}
    <details><summary>调整图表</summary><form onSubmit={apply} className={workspaceStyles.controls}>
      {draft?.kind === 'plot' && <>
        <label>图表类型<select value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value as typeof draft.type })}>
          <option value="bar">柱状图</option><option value="horizontal_bar">横向条形图</option><option value="line">折线图</option><option value="scatter">散点图</option></select></label>
        <label>X 轴字段<select value={draft.x} onChange={event => setDraft({ ...draft, x: event.target.value })}>{result.table.columns.map(c => <option key={c.key} value={c.key}>{c.label}{c.unit ? `（${units[c.unit] ?? c.unit}）` : ''}</option>)}</select></label>
        <label>Y 轴字段<select value={draft.y[0]} onChange={event => setDraft({ ...draft, y: [event.target.value, ...draft.y.slice(1).filter(key => key !== event.target.value)] })}>{numeric.map(c => <option key={c.key} value={c.key}>{c.label}（{units[c.unit!] ?? c.unit}）</option>)}</select></label>
        <label>排序<select value={draft.sort ? `${draft.sort.field}:${draft.sort.direction}` : ''} onChange={event => {
          const [field, direction] = event.target.value.split(':');
          setDraft({ ...draft, sort: field ? { field, direction: direction as 'asc' | 'desc' } : undefined });
        }}><option value="">沿用正式结果顺序</option>{result.table.columns.flatMap(c => ['asc', 'desc'].map(d => <option key={`${c.key}:${d}`} value={`${c.key}:${d}`}>{c.label} · {d === 'asc' ? '升序' : '降序'}</option>))}</select></label>
      </>}
      <label>数值轴最小值<input inputMode="decimal" value={minimum} onChange={event => setMinimum(event.target.value)} placeholder="默认范围" /></label>
      <label>数值轴最大值<input inputMode="decimal" value={maximum} onChange={event => setMaximum(event.target.value)} placeholder="默认范围" /></label>
      <label>数值轴刻度数<select value={ticks} onChange={event => setTicks(Number(event.target.value))}>{[3, 4, 5, 6, 8, 10, 12].map(n => <option key={n}>{n}</option>)}</select></label>
      <label>图例<input type="checkbox" checked={draft?.legend !== false} onChange={event => draft && setDraft({ ...draft, legend: event.target.checked })} /></label>
      <Button variant="secondary" disabled={busy} type="submit">应用图表配置</Button>
    </form></details>
  </section>;
}
