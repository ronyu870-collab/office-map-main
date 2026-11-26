'use client';

import * as React from 'react';
import { z } from 'zod';
import { cellText, resultScopeText, units, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { researchAnalysisSchema, type ResearchAnalysis } from '@/src/lib/intelligence/query/researchAnalysisView';
import { metricLabels, resultMetrics, resultMetricAnalysis } from '@/src/lib/intelligence/query/multiMetricView';
import { resultAvailability } from '@/src/lib/intelligence/query/resultAvailability';
import { answerDisplayPreferences, composeResponse, responseDecision, responseFactCells, responseResultContent, responseTableTitle } from '@/src/lib/intelligence/query/responsePresentation';
import type { QueryClientScope } from '@/src/services/trustedQueryClient';
import { useQueryPresentationReceipt } from './useQueryPresentationReceipt';
import { HomeQueryResearch } from './HomeQueryResearch';
import { responseBlockRenderers } from './HomeQueryResponseBlocks';
import { HomeQueryResultActions } from './HomeQueryResultActions';
import { HomeQueryArtifacts } from './HomeQueryArtifacts';
import { HomeQueryInsights } from './HomeQueryInsights';
import { HomeQuerySources, SourceOverview } from './HomeQuerySources';
export { SourceOverview } from './HomeQuerySources';
import { useQueryDetail } from './HomeQueryDetailPanel';
import styles from './HomeQuery.module.css';
import experienceStyles from './HomeQueryResultExperience.module.css';

export const HomeQueryResult = React.memo(function HomeQueryResult({ result, requestId, scope, delivery, internalExport = false, presentation = 'expanded', visible = true, responseActions, answerTask, question }: {
  result: QueryResultView; requestId?: string; scope?: QueryClientScope; delivery?: object; internalExport?: boolean;
  presentation?: 'compact' | 'expanded'; onExpand?: () => void; visible?: boolean; responseActions?: React.ReactNode; answerTask?: string; question?: string;
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
  const blocks = React.useMemo(() => composeResponse(undefined, result, answerTask, question).blocks, [result, answerTask, question]);
  const availability = resultAvailability(result);
  const decision = React.useMemo(() => responseDecision(result, answerTask, question), [result, answerTask, question]);
  const facts = React.useMemo(() => responseFactCells(result, answerTask), [result, answerTask]);
  const research = React.useMemo(() => {
    const parsed = researchAnalysisSchema.safeParse(result.parameters.researchAnalysis);
    if (!parsed.success) return null;
    const knownSources = new Set(result.sources.map(source => source.id));
    return parsed.data.findings.every(finding => finding.sourceIds.every(id => knownSources.has(id))) ? parsed.data : null;
  }, [result]);
  const { conclusion, context, primaryFinding } = React.useMemo(() => responseResultContent(result, research), [result, research]);
  const [tableOpen, setTableOpen] = React.useState(false);
  const [insightsOpen, setInsightsOpen] = React.useState(() => answerDisplayPreferences(question).wantsSamples && result.table.rows.length > 2 && result.operation === 'compare');
  const sourceMap = React.useMemo(() => new Map(result.sources.map(source => [source.id, source])), [result]);
  const sources = selected ? selected.ids.flatMap(id => sourceMap.has(id) ? [sourceMap.get(id)!] : []) : [];
  useQueryPresentationReceipt(scope, delivery, { surface: 'answer_table', page, pageSize: 25, sourceIds: sources.slice(sourcePage * 10, (sourcePage + 1) * 10).map(source => source.id) }, visible);
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
  const analysisSection = (requestId && scope || research) && <section id={`${sectionId}-analysis`} tabIndex={-1} className={`${experienceStyles.readingSection} ${['rank', 'trend', 'compare', 'aggregate', 'list'].includes(result.operation) ? experienceStyles.readingVisual : ''}`} aria-label="图表与分析">
    {requestId && scope && <HomeQueryArtifacts autoChart={decision.primaryExpression === 'chart'} result={result} requestId={requestId} scope={scope} internalExport={internalExport} onSource={showSources} visible={visible} actionContainer={actionContainer} responseActions={responseActions} />}
    {research && <details className={experienceStyles.details} open={insightsOpen} onToggle={event => setInsightsOpen(event.currentTarget.open)}><summary>分析与样本核查</summary><div hidden={!insightsOpen}><HomeQueryInsights research={research} primaryFindingId={primaryFinding?.id} onSource={showSources} /></div></details>}
    </section>;
  const renderers: Partial<Record<(typeof blocks)[number]['type'], () => React.ReactNode>> = {
    summary: () => (    <div className={experienceStyles.answer}>
      <p className={experienceStyles.conclusion}>{conclusion}
        {primaryFinding && <button type="button" className={experienceStyles.citation} aria-label="查看结论依据"
          onClick={event => showSources(primaryFinding.sourceIds, primaryFinding.title, event.currentTarget)}>依据</button>}
      </p>
    </div>),
    metrics: () => (<section className={`${styles.multiMetrics} ${experienceStyles.metrics}`} aria-label={facts.length === 1 ? "核心指标" : "关键结果"}>
      <p className={experienceStyles.factScope} aria-label="结果范围">{resultScopeText(result)}</p>
      {facts.map(({ column, cell, label, entityId }) => <section key={`${entityId}/${column.key}`} className={experienceStyles.fact} aria-label={`${label}指标`}>
        <h3>{label}</h3>
        <div className={experienceStyles.metricReading}><button type="button" className={cell.kind === 'number' ? experienceStyles.metricValue : styles.metricUnknown}
          aria-label={`查看来源：${label} ${cellText(cell, column.unit)}`}
          onClick={event => showSources(cell.sourceIds, label, event.currentTarget)}>{cellText(cell, column.unit)}</button>
          {cell.kind === 'number' && <span className={experienceStyles.metricUnit}>{units[column.unit ?? ''] ?? column.unit}</span>}
        </div>
      </section>)}
    </section>),
    research: () => (<>    {result.parameters.researchTask != null && <HomeQueryResearch result={result} requestId={requestId} scope={scope} internalExport={internalExport}
      renderResult={child => <HomeQueryResult result={child} />} />}
</>),
    file: () => (requestId && scope && <responseBlockRenderers.file result={result} requestId={requestId} scope={scope} internalExport={internalExport} />),
    chart: () => (requestId && scope && <responseBlockRenderers.chart result={result} requestId={requestId} scope={scope} internalExport={internalExport} onSource={showSources} visible={visible} />),
    analysis: () => analysisSection,
    building: () => {
      const row = result.table.rows[0];
      const name = row.cells.name ?? row.cells.building;
      const fields = result.table.columns.filter(column => !['name', 'building'].includes(column.key) && row.cells[column.key]);
      return <section className={experienceStyles.entity} aria-label="记录摘要">
        {name?.kind === 'text' && <h3>{name.value}</h3>}
        <dl>{fields.slice(0, 6).map(column => {
          const cell = row.cells[column.key];
          return <div key={column.key}><dt>{column.label}</dt><dd><button type="button" className={styles.cell}
            onClick={event => showSources(cell.sourceIds, column.label, event.currentTarget)}>{cellText(cell, column.unit)}</button>
            {cell.kind === 'number' && column.unit && <span> {units[column.unit] ?? column.unit}</span>}
          </dd></div>;
        })}</dl>
      </section>;
    },
    table: () => {
      const content = <responseBlockRenderers.table result={result} requestId={requestId} scope={scope} internalExport={internalExport} onSource={showSources} onPage={setPage} statusShown={!!availability} />;
      return <section id={`${sectionId}-table`} tabIndex={-1} className={experienceStyles.readingSection} aria-label="结果明细">
        {decision.details === 'on_demand' ? <details className={experienceStyles.details} open={tableOpen} onToggle={event => setTableOpen(event.currentTarget.open)}>
          <summary>{availability ? '查看已返回记录' : `查看数据明细（${result.table.rows.length} 行）`}</summary><div hidden={!tableOpen}>{content}</div>
        </details> : <><h3 className={experienceStyles.sectionTitle}>{responseTableTitle(result)}</h3>{content}</>}
      </section>;
    },
    sources: () => (<section id={`${sectionId}-sources`} tabIndex={-1} className={experienceStyles.sourceSummary} aria-label="数据来源">
      <button type="button" data-query-all-sources className={experienceStyles.sourceLink} onClick={event => showSources(result.sources.map(source => source.id), '全部获权候选来源（含未参与计算的记录）', event.currentTarget)}>数据依据</button>
      <SourceOverview result={result} research={research} compact />
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
    {blocks.map(block => <div key={`${result.resultId}:${block.type}`} className={block.type === 'file' ? experienceStyles.readingVisual : ['analysis', 'building', 'table', 'research'].includes(block.type) ? experienceStyles.readingSection : undefined}>
      {renderers[block.type]?.()}
      {!availability && ['summary', 'metrics', 'building'].includes(block.type) && <ResultBoundary result={result} research={research} />}
    </div>)}
    <div ref={setActionContainer} className={experienceStyles.resultActions}>
      {!blocks.some(block => block.type === 'analysis') && requestId && scope && <HomeQueryResultActions result={result} requestId={requestId} scope={scope} internalExport={internalExport} responseActions={responseActions} />}
    </div>
    {selected && (!detail || detail.active?.id === sourceDetailId) && <HomeQuerySources detailId={sourceDetailId} result={result} research={research} context={context} selected={selected} sources={sources} sourcePage={sourcePage} setSourcePage={setSourcePage} onClose={closeSources} panelRef={sourcePanel} />}
  </section>;
});

/** Keep material uncertainty visible; detailed source and method prose can fold.
 * These signals come from typed cells/source metadata, never keyword matching. */
function ResultBoundary({ result, research }: { result: QueryResultView; research: ResearchAnalysis | null }) {
  const unknown = result.table.rows.some(row => Object.values(row.cells).some(cell => cell.kind === 'unknown'));
  const lease = result.parameters.dataDomain === 'lease-research/1';
  const scope = z.object({ inventoryTime: z.string().optional() }).safeParse(result.parameters.scope).data;
  const historical = result.sources.some(source => source.verification === 'historical');
  const limited = research?.resourceUsage && research.resourceUsage.status !== 'complete';
  const coverageNotes = resultMetrics(result).flatMap(metric => {
    const coverage = z.object({ coverage: z.object({ total: z.number().int().nonnegative(), valid: z.number().int().nonnegative() }) })
      .safeParse(resultMetricAnalysis(result, metric)).data?.coverage;
    return coverage && coverage.valid < coverage.total ? [`${metricLabels[metric]}有效样本 ${coverage.valid}/${coverage.total} 栋。`] : [];
  });
  const incompletePeriods = research?.series.some(series => series.periods.some(period => period.coverage.valid < period.coverage.total));
  const notices = [...coverageNotes, unknown ? '部分结果值暂无可交付数值，不按零处理。' : '',
    incompletePeriods ? '部分楼宇缺少有效数据，未参与计算。' : '',
    scope?.inventoryTime === 'current_catalog' && result.sources.some(source => source.period) ? '楼宇分类按当前目录，不代表历史市场全集。' : '',
    result.sources.some(source => source.verification === 'unreviewed') ? '部分来源尚未核验。' : '',
    historical && !lease ? '含历史来源，不能确认当前有效性。' : '', limited ? '研究分析受资源范围限制，详见数据依据。' : ''].filter(Boolean);
  return notices.length ? <p className={experienceStyles.scope} aria-label="重要数据限制">{notices.join(' ')}</p> : null;
}
