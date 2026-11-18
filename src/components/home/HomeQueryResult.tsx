'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { z } from 'zod';
import { Button } from '@/src/components/ui/Button';
import { cellText, resultScopeText, resultSummary, units, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { quarterSchema } from '@/src/lib/intelligence/query/contracts';
import { researchAnalysisSchema, type ResearchAnalysis } from '@/src/lib/intelligence/query/researchAnalysisView';
import { metricLabels, resultMetrics, resultMetricColumns, resultMetricAnalysis } from '@/src/lib/intelligence/query/multiMetricView';
import { resultAvailability } from '@/src/lib/intelligence/query/resultAvailability';
import { resultBuildingRows } from '@/src/lib/intelligence/query/buildingCards';
import type { QueryClientScope } from '@/src/services/trustedQueryClient';
import { useQueryPresentationReceipt } from './useQueryPresentationReceipt';
import { HomeQueryArtifacts } from './HomeQueryArtifacts';
import { HomeQueryInsights } from './HomeQueryInsights';
import styles from './HomeQuery.module.css';
import experienceStyles from './HomeQueryResultExperience.module.css';

const HomeQueryBuildings = dynamic(() => import('./HomeQueryBuildings').then(module => module.HomeQueryBuildings), {
  loading: () => <p role="status">正在打开楼宇信息…</p>,
});

export const HomeQueryResult = React.memo(function HomeQueryResult({ result, requestId, scope, delivery, internalExport = false, presentation = 'expanded', onExpand, visible = true }: {
  result: QueryResultView; requestId?: string; scope?: QueryClientScope; delivery?: object; internalExport?: boolean;
  presentation?: 'compact' | 'expanded'; onExpand?: () => void; visible?: boolean;
}) {
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<{ ids: readonly string[]; label: string } | null>(null);
  const [sourcePage, setSourcePage] = React.useState(0);
  const [actionContainer, setActionContainer] = React.useState<HTMLDivElement | null>(null);
  const resultPanel = React.useRef<HTMLElement>(null);
  const sourcePanel = React.useRef<HTMLElement>(null);
  const returnFocus = React.useRef<HTMLButtonElement | null>(null);
  const summary = resultSummary(result);
  const availability = resultAvailability(result);
  const hasBuildings = React.useMemo(() => resultBuildingRows(result).length > 0, [result]);
  const metrics = resultMetrics(result);
  const multipleMetrics = metrics.length > 1;
  const research = React.useMemo(() => {
    const parsed = researchAnalysisSchema.safeParse(result.parameters.researchAnalysis);
    if (!parsed.success) return null;
    const knownSources = new Set(result.sources.map(source => source.id));
    return parsed.data.findings.every(finding => finding.sourceIds.every(id => knownSources.has(id))) ? parsed.data : null;
  }, [result]);
  const primaryFinding = multipleMetrics ? undefined : research?.findings.find(finding => finding.kind === 'trend');
  const [inlineExpanded, setInlineExpanded] = React.useState(false);
  // Shape and information density determine the preview, never question length.
  // Small tables, short trends and single metrics stay usable on the homepage.
  const complex = result.table.rows.length > 8 || (research?.series.length ?? 0) > 4 || (research?.findings.length ?? 0) > 6;
  const condensed = presentation === 'compact' && complex && !inlineExpanded;
  const [detailsMounted, setDetailsMounted] = React.useState(!condensed);
  // Once revealed, retain the exact child instances, including their chart
  // request, pagination and selected metric when the workspace contracts.
  if (!condensed && !detailsMounted) setDetailsMounted(true);
  const scalarColumn = result.operation === 'aggregate' && result.table.rows.length === 1 && result.table.columns.length === 1 ? result.table.columns[0] : null;
  const scalar = scalarColumn ? result.table.rows[0].cells[scalarColumn.key] : null;
  // Choose an existing, attributed result statement before method text. These
  // are display values from the saved result, never new client calculations.
  const conclusionIndex = result.operation === 'distribution' || result.operation === 'relationship' ? 1 : 0;
  const aggregateConclusion = multipleMetrics && result.operation === 'aggregate' && result.table.rows.length === 1
    ? metrics.map(metric => {
      const key = resultMetricColumns(result, metric).value;
      const column = result.table.columns.find(item => item.key === key);
      const cell = result.table.rows[0].cells[key];
      return column && cell ? `${metricLabels[metric]}为 ${cellText(cell, column.unit)}${cell.kind === 'number' ? ` ${units[column.unit ?? ''] ?? column.unit ?? ''}` : ''}` : null;
    }).filter(Boolean).join('；') : null;
  const conclusion = primaryFinding?.text ?? (aggregateConclusion ? `${aggregateConclusion}。` : summary[conclusionIndex] ?? summary[0]);
  const context = summary.filter((line, index) => (primaryFinding || index !== conclusionIndex) && line !== conclusion);
  const rows = result.table.rows.slice(page * 25, (page + 1) * 25);
  const sourceMap = React.useMemo(() => new Map(result.sources.map(source => [source.id, source])), [result]);
  const sources = selected ? selected.ids.flatMap(id => sourceMap.has(id) ? [sourceMap.get(id)!] : []) : [];
  useQueryPresentationReceipt(scope, delivery, { surface: 'answer_table', page, pageSize: 25, sourceIds: sources.slice(sourcePage * 10, (sourcePage + 1) * 10).map(source => source.id) }, visible && (!condensed || !!scalar || !!selected));
  function showSources(ids: readonly string[], label: string, trigger: HTMLButtonElement) {
    returnFocus.current = trigger; setSelected({ ids: [...new Set(ids)], label }); setSourcePage(0);
  }
  React.useEffect(() => {
    if (!selected) return;
    // This focus change follows an explicit source action, never a query result
    // refresh. Keep the expanded details visible without moving the composer.
    sourcePanel.current?.focus({ preventScroll: true });
    sourcePanel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  return <section ref={resultPanel} tabIndex={-1} className={`${styles.result} ${experienceStyles.result}`} aria-label="查询结果" data-presentation={presentation}>
    {availability && <section className={styles.emptyState} aria-label="查询数据状态"><h3>{availability.title}</h3><p>{availability.description}</p></section>}
    <div className={experienceStyles.answer}>
      <p className={experienceStyles.conclusion}>{conclusion}
        {primaryFinding && <button type="button" className={experienceStyles.citation} aria-label="查看结论依据"
          onClick={event => showSources(primaryFinding.sourceIds, primaryFinding.title, event.currentTarget)}>依据</button>}
      </p>
      <p className={experienceStyles.scope}>{resultScopeText(result)}</p>
      {scalar && scalarColumn && <section className={`${styles.metric} ${experienceStyles.metric}`} aria-label="核心指标">
        <h3>{scalarColumn.label}</h3>
        <div className={experienceStyles.metricReading}><button type="button" className={scalar.kind === 'number' ? `${styles.metricValue} ${experienceStyles.metricValue}` : styles.metricUnknown}
          aria-label={`查看来源：${scalarColumn.label} ${cellText(scalar, scalarColumn.unit)}`}
          onClick={event => showSources(scalar.sourceIds, scalarColumn.label, event.currentTarget)}>{cellText(scalar, scalarColumn.unit)}</button>
        {scalar.kind === 'number' && <span className={experienceStyles.metricUnit}>{units[scalarColumn.unit ?? ''] ?? scalarColumn.unit}</span>}</div>
      </section>}
      {multipleMetrics && result.operation === 'aggregate' && result.table.rows.length === 1 && <div className={`${styles.multiMetrics} ${experienceStyles.metrics}`}>
        {metrics.map(metric => {
          const key = resultMetricColumns(result, metric).value;
          const column = result.table.columns.find(item => item.key === key);
          const cell = result.table.rows[0].cells[key];
          return column && cell ? <section className={styles.metricComparison} aria-label={`${metricLabels[metric]}指标`} key={metric}>
            <h3>{metricLabels[metric]}</h3>
            <div className={experienceStyles.metricReading}><button type="button" className={cell.kind === 'number' ? experienceStyles.metricValue : styles.metricUnknown} aria-label={`查看来源：${metricLabels[metric]} ${cellText(cell, column.unit)}`}
              onClick={event => showSources(cell.sourceIds, metricLabels[metric], event.currentTarget)}>{cellText(cell, column.unit)}</button>
            {cell.kind === 'number' && <span className={experienceStyles.metricUnit}>{units[column.unit ?? ''] ?? column.unit}</span>}</div>
          </section> : null;
        })}
      </div>}
      <SourceOverview result={result} research={research} onSource={showSources} />
    </div>
    {condensed && <div className={experienceStyles.preview}>
      <p>完整分析包含 {result.table.rows.length} 条结果，可查看图表、项目明细及逐项来源。</p>
      <Button variant="secondary" data-result-expand onClick={() => { if (onExpand) onExpand(); else setInlineExpanded(true); }}>{onExpand ? '在全屏中查看完整分析' : '展开完整分析'}</Button>
    </div>}
    {detailsMounted && <div hidden={condensed} className={experienceStyles.details}>
    {requestId && scope && <HomeQueryArtifacts result={result} requestId={requestId} scope={scope} internalExport={internalExport} onSource={showSources} visible={visible && !condensed} actionContainer={actionContainer} />}
    {research && <HomeQueryInsights research={research} primaryFindingId={primaryFinding?.id} onSource={showSources} />}
    {hasBuildings && requestId && scope && <HomeQueryBuildings result={result} requestId={requestId} scope={scope} onSource={showSources} />}
    {!scalar && result.table.rows.length > 0 && <>
      <div className={`${styles.tableScroll} ${experienceStyles.table}`} tabIndex={0} aria-label="查询结果表，可横向滚动">
        <table><caption className="sr-only">本次结果的完整表格，分页不改变统计范围</caption><thead><tr>{result.table.columns.map(column =>
          <th key={column.key} scope="col" className={column.unit ? styles.number : undefined}>{column.label}{column.unit ? `（${units[column.unit] ?? column.unit}）` : ''}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.entityId}>{result.table.columns.map(column => {
            const cell = row.cells[column.key];
            const value = cellText(cell, column.unit);
            return <td key={column.key} className={cell.kind === 'number' ? styles.number : undefined}>
              <button type="button" className={styles.cell} aria-label={`查看来源：${column.label} ${value}`}
                onClick={event => showSources(cell.sourceIds, `${column.label}：${value}`, event.currentTarget)}>{value}</button>
            </td>;
          })}</tr>)}</tbody></table>
      </div>
      <div className={styles.tableFooter}><p>第 {page * 25 + 1}–{Math.min((page + 1) * 25, result.table.rows.length)} 条，共 {result.table.rows.length} 条。点选单元格查看来源。</p>
        {result.table.rows.length > 25 && <div className={styles.actions}>
          <Button variant="ghost" disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一页</Button>
          <Button variant="ghost" disabled={(page + 1) * 25 >= result.table.rows.length} onClick={() => setPage(value => value + 1)}>下一页</Button>
        </div>}
      </div>
    </>}
    </div>}
    <section className={experienceStyles.sourceSummary} aria-label="数据来源">
      <h3>数据来源</h3>
      <button type="button" className={experienceStyles.sourceLink} onClick={event => showSources(result.sources.map(source => source.id), '全部获权候选来源（含未参与计算的记录）', event.currentTarget)}>查看 {result.sources.length} 条获权来源</button>
      <p>数值可逐项追溯；来源清单包含未参与计算的候选记录。</p>
    </section>
    {(context.length > 0 || result.limitations.length > 0) && <section className={`${styles.limitations} ${experienceStyles.limitations}`} aria-label="统计口径与限制">
      <h3>统计口径与限制</h3>
      {[...new Set([...context, ...result.limitations])].map(line => <p key={line}>{line}</p>)}
    </section>}
    <details className={`${styles.trace} ${experienceStyles.provenance}`}>
      <summary>来源、口径与结果版本</summary>
      <details className={styles.trace}><summary>实际执行条件</summary>
        <pre className={styles.auditJson}>{JSON.stringify({
          operation: result.operation,
          ...Object.fromEntries(Object.entries(result.parameters).filter(([key]) =>
            ['scope', 'field', 'fields', 'metric', 'metrics', 'mode', 'period', 'start', 'end', 'base', 'current', 'groupBy', 'dimensions', 'rowDimension', 'columnDimension', 'filters', 'where', 'direction', 'limit', 'timeResolution'].includes(key))),
          ...(result.parameters.executedPlan && typeof result.parameters.executedPlan === 'object' && !Array.isArray(result.parameters.executedPlan)
            ? result.parameters.executedPlan : {}),
        }, null, 2)}</pre>
      </details>
      <p>使用的数据表与字段：{[...new Set(result.sources.map(source => `${source.table}.${source.field}`))].join('；') || '未取得可用来源记录。'}</p>
      <p>结果生成于 {new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(result.createdAt))}（北京时间）。恢复结果保留原快照，不代表最新数据。</p>
      <dl><dt>结果编号</dt><dd>{result.resultId}</dd><dt>数据版本</dt><dd>{result.dataVersion}</dd><dt>字段口径</dt><dd>{result.registryVersion}</dd></dl>
      <Button variant="secondary" onClick={event => showSources(result.sources.map(source => source.id), '全部获权候选来源（含未参与计算的记录）', event.currentTarget)}>查看全部来源</Button>
    </details>
    <div ref={setActionContainer} className={experienceStyles.resultActions} />
    {selected && <section ref={sourcePanel} tabIndex={-1} className={`${styles.sources} ${experienceStyles.sources}`} aria-label="来源详情">
      <div className={styles.sourceHeading}><h3>{selected.label}</h3><Button variant="ghost" onClick={() => {
        setSelected(null);
        const previous = returnFocus.current;
        const destination = previous?.isConnected && !previous.closest('[hidden]') ? previous
          : resultPanel.current?.querySelector<HTMLButtonElement>('[data-result-expand]') ?? resultPanel.current;
        destination?.focus({ preventScroll: true });
      }}>关闭来源</Button></div>
      {!sources.length ? <p>该项没有关联的数据库来源。季度标签来自本次查询条件；指标值和参与样本请查看对应单元格的来源。</p> : <>
        {sources.slice(sourcePage * 10, (sourcePage + 1) * 10).map(source => <dl className={styles.source} key={source.id}>
          <dt>数据库位置</dt><dd>{source.table} / {source.recordId} / {source.field}</dd>
          <dt>原始记录值</dt><dd>{source.rawValue === null || source.rawValue === undefined ? '未填写' : typeof source.rawValue === 'string' ? source.rawValue : JSON.stringify(source.rawValue)}</dd>
          <dt>期间与单位</dt><dd>{source.period ? `${source.period.year} 年第 ${source.period.quarter} 季度` : '不属于季度指标'}；{units[source.unit] ?? source.unit}</dd>
          <dt>原始资料</dt><dd>{source.original ? `${source.original.documentId}，版本 ${source.original.version}${source.original.page ? `，第 ${source.original.page} 页` : ''}${source.original.sheet ? `，表 ${source.original.sheet}` : ''}${source.original.row ? `，第 ${source.original.row} 行` : ''}` : '尚未关联原件，仅能溯源到数据库记录。'}</dd>
          <dt>核验状态</dt><dd>{{ database_only: '仅数据库记录', verified_original: '已核验原件', unreviewed: '未核验', historical: '历史来源' }[source.verification]}</dd>
          <dt>业务截至</dt><dd>{source.businessAsOf ?? '未知，不能用入库时间替代。'}</dd>
          <dt>记录版本</dt><dd>{source.recordVersion}</dd>
        </dl>)}
        <div className={styles.tableFooter}><p>来源 {sourcePage * 10 + 1}–{Math.min((sourcePage + 1) * 10, sources.length)}，共 {sources.length} 条</p>
          {sources.length > 10 && <div className={styles.actions}><Button variant="ghost" disabled={!sourcePage} onClick={() => setSourcePage(value => value - 1)}>上一组来源</Button><Button variant="ghost" disabled={(sourcePage + 1) * 10 >= sources.length} onClick={() => setSourcePage(value => value + 1)}>下一组来源</Button></div>}
        </div>
      </>}
    </section>}
  </section>;
});

const analysisCoverageSchema = z.object({ coverage: z.object({ valid: z.number().int().nonnegative() }) });
export function SourceOverview({ result, research, onSource }: { result: QueryResultView; research: ResearchAnalysis | null;
  onSource?: (ids: readonly string[], label: string, trigger: HTMLButtonElement) => void }) {
  const periods = ['period', 'start', 'end', 'base', 'current'].flatMap(key => {
    const parsed = quarterSchema.safeParse(result.parameters[key]);
    return parsed.success ? [`${parsed.data.year} Q${parsed.data.quarter}`] : [];
  });
  const period = [...new Set(periods)].join(result.operation === 'compare' ? ' 与 ' : ' 至 ');
  const hasQuarter = result.sources.some(source => source.period !== null) || periods.length > 0;
  const scope = z.object({ inventory: z.string().optional() }).safeParse(result.parameters.scope);
  const tracked = scope.success && scope.data.inventory === 'tracked';
  const source = hasQuarter ? `${period ? `${period} ` : ''}${tracked ? '季度跟踪样本' : '季度数据'}` : result.sources.some(item => item.table === 'building_brochure_data') ? '楼宇目录及楼书参数' : '当前获权楼宇目录';
  const sourceLabel = <p>数据来源：{onSource ? <button type="button" className={experienceStyles.sourceLink}
    onClick={event => onSource(result.sources.map(item => item.id), '全部获权候选来源（含未参与计算的记录）', event.currentTarget)}>{source}</button> : source}</p>;
  const metrics = resultMetrics(result);
  if (metrics.length > 1) return <section className={`${experienceStyles.basis} ${experienceStyles.multipleBasis}`} aria-label="数据依据摘要">
    {sourceLabel}
    <p>各指标分别核验有效样本，样本数量和面积分母可能不同。</p>
    {metrics.map(metric => {
      const series = research?.series.filter(item => item.metric === metric) ?? [];
      const coverage = analysisCoverageSchema.safeParse(resultMetricAnalysis(result, metric));
      const latest = series.length === 1 ? series[0].periods.at(-1) : null;
      const sample = latest ? `${latest.usedCount} 栋（${latest.period.year} Q${latest.period.quarter}）`
        : coverage.success ? `${coverage.data.coverage.valid} 栋`
          : series.length ? series.slice(0, 4).map(item => `${item.label || '当前范围'} ${item.periods.at(-1)?.usedCount ?? 0} 栋`).join('；') + (series.length > 4 ? `；其余 ${series.length - 4} 组见计算明细` : '')
            : '各组分别核验，参与数量和分母见结果表';
      return <section key={metric} aria-label={`${metricLabels[metric]}依据`} className={experienceStyles.basisMetric}>
        <h3>{metricLabels[metric]}</h3><p>有效样本：{sample}</p>
        <p>统计方式：{metricMethod(metric)}</p>
      </section>;
    })}
  </section>;
  const coverage = analysisCoverageSchema.safeParse(result.analysis);
  const single = research?.series.length === 1 ? research.series[0] : null;
  const latest = single?.periods.at(-1);
  const sample = latest ? `${latest.period.year} Q${latest.period.quarter} ${latest.usedCount} 栋`
    : coverage.success ? `${coverage.data.coverage.valid} 栋` : research && research.series.length > 1 ? '各组独立统计，见分析明细' : null;
  const method = metrics.length === 1 ? metricMethod(metrics[0]) : null;
  return <section className={experienceStyles.basis} aria-label="数据依据摘要">
    {sourceLabel}{sample && <p>有效样本：{sample}</p>}{method && <p>统计方式：{method}</p>}
  </section>;
}

function metricMethod(metric: 'rent' | 'vacancy' | 'totalArea'): string {
  return metric === 'rent' ? '按有效总面积加权' : metric === 'vacancy' ? '有效空置面积合计 ÷ 有效总面积合计' : '有效季度总面积求和';
}
