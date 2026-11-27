'use client';
import * as React from 'react';
import { z } from 'zod';
import { Button } from '@/src/components/ui/Button';
import { quarterSchema } from '@/src/lib/intelligence/query/contracts';
import { metroSource, units, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { metricLabels, resultMetrics, resultMetricAnalysis } from '@/src/lib/intelligence/query/multiMetricView';
import type { ResearchAnalysis } from '@/src/lib/intelligence/query/researchAnalysisView';
import { HomeQueryDetailContent } from './HomeQueryDetailPanel';
import styles from './HomeQuery.module.css';
import experienceStyles from './HomeQueryResultExperience.module.css';
export function HomeQuerySources({ detailId, result, context, research = null, selected, sources, sourcePage, setSourcePage, onClose, panelRef }: {
  detailId: string; result: QueryResultView; context: string[]; research?: ResearchAnalysis | null;
  selected: { ids: readonly string[]; label: string }; sources: QueryResultView['sources']; sourcePage: number;
  setSourcePage: React.Dispatch<React.SetStateAction<number>>;
  onClose: () => void; panelRef: React.RefObject<HTMLElement | null>;
}) {
  const sourceRef = React.useCallback((node: HTMLElement | null) => {
    panelRef.current = node;
    node?.focus({ preventScroll: true });
  }, [panelRef]);
  return <HomeQueryDetailContent id={detailId}><section data-detail-autofocus ref={sourceRef} tabIndex={-1} className={`${styles.sources} ${experienceStyles.sources}`} aria-label="来源详情">
    <div className={styles.sourceHeading}><h3>{selected.label}</h3><Button variant="ghost" onClick={onClose}>关闭来源</Button></div>

    <details className={experienceStyles.sourceDisclosure}><summary>统计口径与限制</summary><section aria-label="统计口径与限制">
      <SourceOverview result={result} research={research} />
      {[...new Set([...context, ...result.limitations])].map(line => <p key={line}>{line}</p>)}
    </section></details>
    <p>候选来源可能包含未参与计算的记录；具体指标以单元格关联的来源为准。</p>
      {!sources.length ? <p>该项没有关联的来源记录；范围与期间来自保存的查询条件。</p> : <>
        {sources.slice(sourcePage * 10, (sourcePage + 1) * 10).map(source => <div className={styles.source} key={source.id}><dl>
          <dt>原始记录值</dt><dd>{source.table === 'buildings' && source.field === metroSource.locationField ? '使用获权楼宇定位，结果仅显示计算距离。' : source.rawValue === null || source.rawValue === undefined ? '未填写' : typeof source.rawValue === 'string' ? source.rawValue : JSON.stringify(source.rawValue)}</dd>
          <dt>期间与单位</dt><dd>{source.period ? `${source.period.year} 年第 ${source.period.quarter} 季度` : '未提供季度标签'}；{source.unit === 'snapshot' ? '来源快照（非计量单位）' : source.unit === 'text' ? '文字' : units[source.unit] ?? source.unit}</dd>
          <dt>原始资料</dt><dd>{source.table === metroSource.table ? <a href={metroSource.path} target="_blank" rel="noopener noreferrer">现行北京地图站点目录</a>
            : source.original ? `${source.original.documentId}，版本 ${source.original.version}${source.original.location ? `，${source.original.location}` : source.original.page ? `，第 ${source.original.page} 页` : ''}${source.original.sheet ? `，表 ${source.original.sheet}` : ''}${source.original.row ? `，第 ${source.original.row} 行` : ''}` : '尚未关联原件，仅能溯源到数据库记录。'}</dd>
          <dt>核验状态</dt><dd>{{ database_only: '仅数据库记录', verified_original: '已核验原件', unreviewed: '未核验', historical: '历史来源' }[source.verification]}</dd>
          <dt>业务截至</dt><dd>{source.businessAsOf ?? '未知，不能用入库时间替代。'}</dd>
        </dl><details><summary>记录技术信息</summary><dl><dt>{source.table === metroSource.table ? '站点记录' : '数据库位置'}</dt><dd>{source.table} / {source.recordId} / {source.field}</dd><dt>记录版本</dt><dd>{source.recordVersion}</dd></dl></details></div>)}
        <div className={styles.tableFooter}><p>来源 {sourcePage * 10 + 1}–{Math.min((sourcePage + 1) * 10, sources.length)}，共 {sources.length} 条</p>
          {sources.length > 10 && <div className={styles.actions}><Button variant="ghost" disabled={!sourcePage} onClick={() => setSourcePage(value => value - 1)}>上一组来源</Button><Button variant="ghost" disabled={(sourcePage + 1) * 10 >= sources.length} onClick={() => setSourcePage(value => value + 1)}>下一组来源</Button></div>}
        </div>
      </>}    <details className={`${styles.trace} ${experienceStyles.provenance}`}>
      <summary>高级技术信息</summary>
      <details className={styles.trace}><summary>实际执行条件</summary>
        <pre className={styles.auditJson}>{JSON.stringify({
          operation: result.operation,
          ...Object.fromEntries(Object.entries(result.parameters).filter(([key]) =>
            ['scope', 'field', 'fields', 'metric', 'metrics', 'mode', 'period', 'start', 'end', 'base', 'current', 'groupBy', 'dimensions', 'rowDimension', 'columnDimension', 'filters', 'where', 'direction', 'limit', 'timeResolution'].includes(key))),
          ...(result.parameters.executedPlan && typeof result.parameters.executedPlan === 'object' && !Array.isArray(result.parameters.executedPlan)
            ? result.parameters.executedPlan : {}),
        }, null, 2)}</pre>
      </details>
      <p>使用的数据表与字段：{[...new Set(sources.map(source => `${source.table}.${source.field}`))].join('；') || '未取得可用来源记录。'}</p>
      <p>结果生成于 {new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(result.createdAt))}（北京时间）。恢复结果保留原快照，不代表最新数据。</p>
      <dl><dt>结果编号</dt><dd>{result.resultId}</dd><dt>数据版本</dt><dd>{result.dataVersion}</dd><dt>字段口径</dt><dd>{result.registryVersion}</dd></dl>
    </details>

  </section></HomeQueryDetailContent>;
}

const analysisCoverageSchema = z.object({ coverage: z.object({ valid: z.number().int().nonnegative() }) });
export function sourceOverviewLabel(result: QueryResultView): string {
  const periods = ['period', 'start', 'end', 'base', 'current'].flatMap(key => {
    const parsed = quarterSchema.safeParse(result.parameters[key]);
    return parsed.success ? [`${parsed.data.year} Q${parsed.data.quarter}`] : [];
  });
  if (!periods.length) for (const source of result.sources) if (source.period) periods.push(`${source.period.year} Q${source.period.quarter}`);
  const distinct = [...new Set(periods)].sort();
  const period = distinct.length <= 2 ? distinct.join(result.operation === 'compare' ? ' 与 ' : ' 至 ') : `${distinct[0]} 至 ${distinct.at(-1)}`;
  const scope = z.object({ inventory: z.string().optional(), from: z.string().optional(), to: z.string().optional(), source: z.string().optional() }).safeParse(result.parameters.scope).data;
  const dateRange = scope?.from && scope?.to ? scope.from === scope.to ? scope.from : `${scope.from} 至 ${scope.to}` : period;
  if (result.parameters.dataDomain === 'lease-research/1') return [dateRange, scope?.source === 'live' ? '当前成交记录' : scope?.source === 'history' ? '历史成交记录' : '获权成交记录'].filter(Boolean).join('，');
  if (result.parameters.dataDomain === 'business-research/1') return [period, '获权业务资料'].filter(Boolean).join('，');
  if (result.parameters.domain === 'knowledge-research/1') return result.parameters.evidenceKind === 'external_public' ? '公开研究来源' : '获权知识资料';
  if (result.parameters.dataDomain === 'deep-research/1' || result.parameters.agentReport) return '组合研究来源，各部分保留原期间';
  if (result.parameters.dataDomain || result.parameters.domain) return [period, '获权数据来源'].filter(Boolean).join('，');
  if (result.sources.some(item => item.table === metroSource.table)) return '获权楼宇定位与北京地图站点目录';
  const hasQuarter = result.sources.some(source => source.period !== null) || periods.length > 0;
  const source = hasQuarter ? scope?.inventory === 'tracked' ? '季度跟踪样本' : '楼宇季度数据'
    : result.sources.some(item => item.table === 'building_brochure_data') ? '楼宇目录及楼书参数'
      : result.sources.some(item => item.table === 'buildings') ? '当前获权楼宇目录' : '获权数据来源';
  return [period, source].filter(Boolean).join('，');
}

export function SourceOverview({ result, research, onSource, compact = false }: { result: QueryResultView; research: ResearchAnalysis | null; compact?: boolean;
  onSource?: (ids: readonly string[], label: string, trigger: HTMLButtonElement) => void }) {
  const source = sourceOverviewLabel(result);
  const sourceLabel = <p>数据来源：{onSource ? <button type="button" className={experienceStyles.sourceLink}
    onClick={event => onSource(result.sources.map(item => item.id), '全部获权候选来源（含未参与计算的记录）', event.currentTarget)}>{source}</button> : source}</p>;
  if (compact) return <section className={experienceStyles.basis} aria-label="数据依据摘要">{sourceLabel}</section>;
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

