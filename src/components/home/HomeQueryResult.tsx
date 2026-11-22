'use client';

import * as React from 'react';
import { z } from 'zod';
import { Button } from '@/src/components/ui/Button';
import { cellText, resultScopeText, units, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { researchAnalysisSchema, type ResearchAnalysis } from '@/src/lib/intelligence/query/researchAnalysisView';
import { metricLabels, resultMetrics, resultMetricColumns, resultMetricAnalysis } from '@/src/lib/intelligence/query/multiMetricView';
import { resultAvailability } from '@/src/lib/intelligence/query/resultAvailability';
import { composeResponse, responseResultContent, responseTableTitle } from '@/src/lib/intelligence/query/responsePresentation';
import type { QueryClientScope } from '@/src/services/trustedQueryClient';
import { useQueryPresentationReceipt } from './useQueryPresentationReceipt';
import { HomeQueryResearch } from './HomeQueryResearch';
import { responseBlockRenderers } from './HomeQueryResponseBlocks';
import { HomeQueryArtifacts } from './HomeQueryArtifacts';
import { HomeQueryInsights } from './HomeQueryInsights';
import { HomeQuerySources, SourceOverview } from './HomeQuerySources';
export { SourceOverview } from './HomeQuerySources';
import { useQueryDetail } from './HomeQueryDetailPanel';
import styles from './HomeQuery.module.css';
import experienceStyles from './HomeQueryResultExperience.module.css';

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
  const sectionId = React.useId();
  const sourceDetailId = `${result.resultId}-${sectionId}-sources`;
  const detail = useQueryDetail();
  const hasDetailPanel = !!detail;
  const blocks = React.useMemo(() => composeResponse(undefined, result).blocks, [result]);
  const availability = resultAvailability(result);
  const metrics = resultMetrics(result);
  const multipleMetrics = metrics.length > 1;
  const research = React.useMemo(() => {
    const parsed = researchAnalysisSchema.safeParse(result.parameters.researchAnalysis);
    if (!parsed.success) return null;
    const knownSources = new Set(result.sources.map(source => source.id));
    return parsed.data.findings.every(finding => finding.sourceIds.every(id => knownSources.has(id))) ? parsed.data : null;
  }, [result]);
  const { conclusion, context, primaryFinding } = React.useMemo(() => responseResultContent(result, research), [result, research]);
  const [inlineExpanded, setInlineExpanded] = React.useState(false);
  // Shape and information density determine the preview, never question length.
  // Small tables, short trends and single metrics stay usable on the homepage.
  const complex = result.table.rows.length > 8 || (research?.series.length ?? 0) > 4 || (research?.findings.length ?? 0) > 6;
  const condensed = presentation === 'compact' && complex && !inlineExpanded;
  const [detailsMounted, setDetailsMounted] = React.useState(!condensed || ['list', 'rank'].includes(result.operation));
  // Once revealed, retain the exact child instances, including their chart
  // request, pagination and selected metric when the workspace contracts.
  if (!condensed && !detailsMounted) setDetailsMounted(true);
  const scalarColumn = result.operation === 'aggregate' && result.table.rows.length === 1 && result.table.columns.length === 1 ? result.table.columns[0] : null;
  const scalar = scalarColumn ? result.table.rows[0].cells[scalarColumn.key] : null;
  const sourceMap = React.useMemo(() => new Map(result.sources.map(source => [source.id, source])), [result]);
  const sources = selected ? selected.ids.flatMap(id => sourceMap.has(id) ? [sourceMap.get(id)!] : []) : [];
  useQueryPresentationReceipt(scope, delivery, { surface: 'answer_table', page, pageSize: 25, sourceIds: sources.slice(sourcePage * 10, (sourcePage + 1) * 10).map(source => source.id) }, visible && (!condensed || !!scalar || !!selected));
  function showSources(ids: readonly string[], label: string, trigger: HTMLButtonElement) {
    returnFocus.current = trigger; setSelected({ ids: [...new Set(ids)], label }); setSourcePage(0);
    detail?.open(sourceDetailId, '数据依据', trigger);
  }
  React.useEffect(() => {
    if (!selected) return;
    // This focus change follows an explicit source action, never a query result
    // refresh. Keep the expanded details visible without moving the composer.
    sourcePanel.current?.focus({ preventScroll: true });
    if (!hasDetailPanel) sourcePanel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, hasDetailPanel]);
  const analysisSection = (requestId && scope || research) && <section id={`${sectionId}-analysis`} tabIndex={-1} className={experienceStyles.readingSection} aria-label="图表与分析">
    {requestId && scope && <HomeQueryArtifacts result={result} requestId={requestId} scope={scope} internalExport={internalExport} onSource={showSources} visible={visible && !condensed} actionContainer={actionContainer} />}
    {research && <HomeQueryInsights research={research} primaryFindingId={primaryFinding?.id} onSource={showSources} />}
    </section>;
  const renderers: Partial<Record<(typeof blocks)[number]['type'], () => React.ReactNode>> = {
    summary: () => (    <div className={experienceStyles.answer}>
      <p className={experienceStyles.conclusion}>{conclusion}
        {primaryFinding && <button type="button" className={experienceStyles.citation} aria-label="查看结论依据"
          onClick={event => showSources(primaryFinding.sourceIds, primaryFinding.title, event.currentTarget)}>依据</button>}
      </p>
      <p className={experienceStyles.scope}>{resultScopeText(result)}</p>
      <ResultBoundary result={result} research={research} />
    {complex && !condensed && !['list', 'rank'].includes(result.operation) && <nav className={experienceStyles.directory} aria-label="本条回答目录">
      {blocks.filter(block => ['analysis', 'building', 'table', 'sources'].includes(block.type)).map(block => <button key={block.type} type="button" onClick={() => {
        const name = block.type === 'analysis' ? 'analysis' : block.type === 'building' ? 'buildings' : block.type;
        const section = document.getElementById(`${sectionId}-${name}`); section?.focus({ preventScroll: true }); section?.scrollIntoView?.({ block: 'start' });
      }}>{({ analysis: '图表与分析', building: '相关楼宇', table: '结果明细', sources: '来源与口径' } as Record<string, string>)[block.type]}</button>)}
    </nav>}
    </div>),
    metrics: () => (<>      {scalar && scalarColumn && <section className={`${styles.metric} ${experienceStyles.metric}`} aria-label="核心指标">
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
</>),
    research: () => (<>    {result.parameters.researchTask != null && <HomeQueryResearch result={result} requestId={requestId} scope={scope} internalExport={internalExport}
      renderResult={child => <HomeQueryResult result={child} />} />}
</>),
    file: () => (requestId && scope && <responseBlockRenderers.file result={result} requestId={requestId} scope={scope} internalExport={internalExport} />),
    chart: () => (requestId && scope && <responseBlockRenderers.chart result={result} requestId={requestId} scope={scope} internalExport={internalExport} onSource={showSources} visible={visible} />),
    analysis: () => analysisSection,
    building: () => (<>    {requestId && scope && <section id={`${sectionId}-buildings`} tabIndex={-1} className={experienceStyles.readingSection} aria-label="相关楼宇"><responseBlockRenderers.building result={result} requestId={requestId} scope={scope} onSource={showSources} /></section>}
</>),
    table: () => (<>{!scalar && <section id={`${sectionId}-table`} tabIndex={-1} className={experienceStyles.readingSection} aria-label="结果明细">
      <h3 className={experienceStyles.sectionTitle}>{responseTableTitle(result)}</h3>
      <responseBlockRenderers.table result={result} requestId={requestId} scope={scope} internalExport={internalExport} onSource={showSources} onPage={setPage} preview={condensed && ['list', 'rank'].includes(result.operation)} />
    </section>}</>),
    sources: () => (<section id={`${sectionId}-sources`} tabIndex={-1} className={experienceStyles.sourceSummary} aria-label="数据来源">
      <button type="button" data-query-all-sources className={experienceStyles.sourceLink} onClick={event => showSources(result.sources.map(source => source.id), '全部获权候选来源（含未参与计算的记录）', event.currentTarget)}>数据依据</button>
      <SourceOverview result={result} research={research} />
      <span className={experienceStyles.scope}>{result.sources.length} 条候选来源 · 具体指标可逐项核验</span>
    </section>),
  };
  function closeSources() {
    setSelected(null);
    if (detail?.active?.id === sourceDetailId) detail.close();
    if (detail) return;
    const previous = returnFocus.current;
    const destination = previous?.isConnected && !previous.closest('[hidden]') ? previous
      : resultPanel.current?.querySelector<HTMLButtonElement>('[data-result-expand]') ?? resultPanel.current;
    destination?.focus({ preventScroll: true });
  }
  return <section ref={resultPanel} tabIndex={-1} className={`${styles.result} ${experienceStyles.result}`} aria-label="查询结果" data-presentation={presentation} data-result-id={result.resultId}>
    {availability && <section className={styles.emptyState} aria-label="查询数据状态"><h3>{availability.title}</h3><p>{availability.description}</p></section>}
    {blocks.map(block => {
      const secondary = ['analysis', 'building', 'table', 'research'].includes(block.type);
      return (!secondary || detailsMounted) && <div key={block.type} hidden={secondary && condensed && !(block.type === 'table' && ['list', 'rank'].includes(result.operation))} className={secondary ? experienceStyles.readingSection : undefined}>{renderers[block.type]?.()}</div>;
    })}
    {condensed && <div className={experienceStyles.preview}><p>完整分析包含 {result.table.rows.length} 条结果。</p><Button variant="secondary" data-result-expand onClick={() => { if (onExpand) onExpand(); else setInlineExpanded(true); }}>{onExpand ? '在全屏中查看完整分析' : '展开完整分析'}</Button></div>}
    <div ref={setActionContainer} className={experienceStyles.resultActions} />
    {selected && (!detail || detail.active?.id === sourceDetailId) && <HomeQuerySources detailId={sourceDetailId} result={result} context={context} selected={selected} sources={sources} sourcePage={sourcePage} setSourcePage={setSourcePage} onClose={closeSources} panelRef={sourcePanel} />}
  </section>;
});

/** Keep material uncertainty visible; detailed source and method prose can fold.
 * These signals come from typed cells/source metadata, never keyword matching. */
function ResultBoundary({ result, research }: { result: QueryResultView; research: ResearchAnalysis | null }) {
  const unknown = result.table.rows.reduce((count, row) => count + Object.values(row.cells).filter(cell => cell.kind === 'unknown').length, 0);
  const scope = z.object({ inventoryTime: z.string().optional() }).safeParse(result.parameters.scope).data;
  const historical = result.sources.some(source => source.verification === 'historical');
  const limited = research?.resourceUsage && research.resourceUsage.status !== 'complete';
  const coverageNotes = resultMetrics(result).flatMap(metric => {
    const coverage = z.object({ coverage: z.object({ total: z.number().int().nonnegative(), valid: z.number().int().nonnegative() }) })
      .safeParse(resultMetricAnalysis(result, metric)).data?.coverage;
    return coverage && coverage.valid < coverage.total ? [`${metricLabels[metric]}有效样本 ${coverage.valid}/${coverage.total} 栋。`] : [];
  });
  const incompletePeriods = research?.series.some(series => series.periods.some(period => period.coverage.valid < period.coverage.total));
  const notices = [...coverageNotes, unknown ? `${unknown} 个结果值未知，不按零处理。` : '',
    incompletePeriods ? '部分候选未参与计算，各期有效样本与缺失情况见明细。' : '',
    scope?.inventoryTime === 'current_catalog' && result.sources.some(source => source.period) ? '分类依据当前目录，不代表历史市场全集。' : '',
    result.sources.some(source => source.verification === 'unreviewed') ? '部分来源尚未核验。' : '',
    historical ? '含历史来源，不能确认当前有效性。' : '', limited ? '研究分析受资源范围限制，详见数据依据。' : ''].filter(Boolean);
  return notices.length ? <p className={experienceStyles.scope} aria-label="重要数据限制">{notices.join(' ')}</p> : null;
}
