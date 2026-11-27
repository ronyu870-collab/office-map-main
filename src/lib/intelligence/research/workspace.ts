import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { RESEARCH_DOMAIN, researchTaskSchema, type ResearchTask } from './protocol';
import { FIELD_REGISTRY_VERSION } from '../query/registry';
import { resultViewSchema, units } from '../query/presentation';
import { researchAnalysisSchema } from '../query/researchAnalysisView';
import { buildResultChart } from '../query/charts';
import { preferredChartRequest } from '../agent/resultTools';
import type { QueryResult } from '../query/result';
import { chartRequestSchema, type ChartRequest } from '../query/chartSpec';
import { isKnowledgeResult } from '../knowledge/protocol';

export const isResearchResult = (r: { parameters: Readonly<Record<string, unknown>> }) => r.parameters.dataDomain === RESEARCH_DOMAIN;
export type ResearchSection = { result: QueryResult; chart: ChartRequest | null };
export type ReviewIssue = { code: string; severity: 'warning' | 'blocker'; resultId?: string };
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: string) => ({ kind: 'text' as const, value, sourceIds: [] });

export function researchSections(result: { parameters: Readonly<Record<string, unknown>> }): ResearchSection[] {
  if (!isResearchResult(result)) throw new Error('RESEARCH_TASK_NOT_FOUND');
  const sections = z.array(z.object({ result: resultViewSchema, chart: chartRequestSchema.nullable() })).max(8).parse(result.parameters.researchSections);
  if (sections.some(s => isResearchResult(s.result) || s.result.parameters.agentReport || s.result.parameters.agentExport)) throw new Error('RESEARCH_NESTED_RESULT');
  // Keep the original formal objects byte-for-byte for their signed digests.
  const raw = result.parameters.researchSections as ResearchSection[];
  return sections.map((section, i) => ({ result: raw[i].result, chart: section.chart }));
}

/** Checks copy existing deterministic evidence; they never calculate market values. */
export function reviewResearch(task: ResearchTask, results: readonly QueryResult[]) {
  const issues: ReviewIssue[] = [];
  const sections: ResearchSection[] = [];
  const facts: Array<{ resultId: string; kind: 'deterministic_fact'; text: string; sourceIds: readonly string[] }> = [];
  const ids = new Set(results.map(r => r.resultId));
  for (const step of task.steps.filter(s => s.id !== 'review')) {
    if (step.state !== 'complete' || !step.resultId || !ids.has(step.resultId)) issues.push({ code: 'scope_incomplete', severity: 'blocker' });
    if (step.error === 'RESEARCH_STEP_NOT_AUTHORIZED') issues.push({ code: 'domain_not_authorized', severity: 'blocker' });
    else if (step.state === 'blocked') issues.push({ code: 'source_step_unavailable', severity: 'blocker' });
  }
  for (const result of results) {
    const r = resultViewSchema.parse(result);
    if (isKnowledgeResult(r)) issues.push({ code: 'knowledge_not_licensed_for_deliverables', severity: 'blocker', resultId: r.resultId });
    if (!r.table.rows.length) issues.push({ code: 'no_matching_records', severity: 'warning', resultId: r.resultId });
    const known = new Set(r.sources.map(s => s.id));
    if (r.table.rows.some(row => Object.values(row.cells).some(cell => cell.sourceIds.some(id => !known.has(id)))))
      issues.push({ code: 'cell_source_invalid', severity: 'blocker', resultId: r.resultId });
    for (const col of r.table.columns) {
      if (col.unit && !units[col.unit]) issues.push({ code: 'unit_not_registered', severity: 'blocker', resultId: r.resultId });
      if (r.table.rows.some(row => row.cells[col.key].kind === 'unknown')) issues.push({ code: 'missing_or_restricted_cells', severity: 'warning', resultId: r.resultId });
      if (r.table.rows.some(row => {
        const cell = row.cells[col.key];
        // The official engine records zero sample size/denominator beside an
        // unknown metric when no observations qualify. No source row exists
        // for that absence; it must not prevent a truthful no-data report.
        const emptySample = ['usedCount', 'availableCount', 'denominator'].includes(col.key)
          && row.cells.value?.kind === 'unknown' && cell.kind === 'number' && cell.value.exact.numerator === '0';
        return cell.kind === 'number' && !cell.sourceIds.length && !emptySample;
      })) issues.push({ code: 'numeric_evidence_missing', severity: 'blocker', resultId: r.resultId });
    }
    const research = researchAnalysisSchema.safeParse(r.parameters.researchAnalysis).data;
    for (const finding of research?.findings ?? []) {
      if (finding.sourceIds.some(id => !known.has(id))) throw new Error('RESEARCH_FINDING_SOURCE_INVALID');
      facts.push({ resultId: r.resultId, kind: 'deterministic_fact', text: finding.text, sourceIds: finding.sourceIds });
    }
    let chart = isKnowledgeResult(r) ? null : preferredChartRequest(r);
    if (chart) {
      try { buildResultChart(r, chart); }
      catch { chart = null; issues.push({ code: 'chart_not_available_for_result', severity: 'warning', resultId: r.resultId }); }
    }
    sections.push({ result, chart });
  }
  return { version: 'research-review/1', completeScope: !issues.some(i => i.code === 'scope_incomplete'),
    canGenerate: !issues.some(i => i.severity === 'blocker'),
    issues: [...new Map(issues.map(i => [JSON.stringify(i), i])).values()], facts, sections,
    inferences: [], disclosure: 'internal_only',
    method: ['同比、环比、共同样本、分布与异常标记复用各正式结果内的确定性分析，不跨结果重算。',
      '租金、空置率、成交面积及未来供应分别保留单位、期间和样本；成交面积不等于净吸纳量，供应目录不等于实际交付。',
      '事实与推断分开；当前未生成因果判断或无证据的市场预测。', '内部研究资格不包含对客发布或对外传播授权。'] };
}

export function buildResearchWorkspace(task: ResearchTask, results: readonly QueryResult[], interrupted = false): QueryResult {
  task = researchTaskSchema.parse(structuredClone(task));
  if (interrupted) {
    task.state = 'interrupted';
    task.steps.forEach(s => { if (s.state === 'running') s.state = 'pending'; });
  }
  const review = reviewResearch(task, results);
  const { sections: reviewedSections, ...reviewSummary } = review;
  const sources = new Map<string, QueryResult['sources'][number]>();
  for (const result of results) for (const source of result.sources) {
    if (sources.has(source.id) && !isDeepStrictEqual(sources.get(source.id), source)) throw new Error('RESEARCH_SOURCE_COLLISION');
    sources.set(source.id, source);
  }
  const result: QueryResult = { resultId: randomUUID(), createdAt: new Date().toISOString(),
    snapshotId: sha(results.map(r => r.snapshotId)), dataVersion: sha(results.map(r => r.dataVersion)),
    scopeFingerprint: sha(task.spec), registryVersion: FIELD_REGISTRY_VERSION, operation: 'list', analysis: null,
    parameters: { dataDomain: RESEARCH_DOMAIN, researchTask: task, researchSections: reviewedSections,
      researchReview: reviewSummary,
      ...Object.fromEntries(['businessBindings', 'leaseBindings', 'knowledgeBindings', 'publicBindings'].flatMap(key => {
        const values = results.flatMap(r => Array.isArray(r.parameters[key]) ? r.parameters[key] as unknown[] : []);
        return values.length ? [[key, values]] : [];
      })) },
    table: { id: 'research-progress', columns: [{ key: 'name', label: '研究步骤', unit: null },
      { key: 'state', label: '状态', unit: null }, { key: 'dependencies', label: '前置步骤', unit: null }],
      rows: task.steps.map(s => ({ entityId: s.id, cells: { name: text(s.title), state: text(({ pending: '待执行', running: '执行中', complete: '已完成', blocked: '受阻' })[s.state]), dependencies: text(s.dependsOn.join('、') || '无') } })) },
    sources: [...sources.values()], limitations: [...new Set([...results.flatMap(r => r.limitations), ...review.method,
      ...(task.state === 'interrupted' ? ['研究已中断，已完成结果可重新鉴权后继续；未执行步骤不视为完成。'] : []),
      ...review.issues.map(i => reviewIssueText(i.code))])] };
  resultViewSchema.parse(result);
  if (Buffer.byteLength(JSON.stringify(result)) > 15 * 1024 * 1024) throw new Error('RESEARCH_ARCHIVE_LIMIT');
  return result;
}

export function reviewIssueText(code: string) {
  return ({ scope_incomplete: '研究范围尚未全部执行。', domain_not_authorized: '部分研究数据源受独立资格限制。',
    source_step_unavailable: '部分研究数据源暂时不可用。', knowledge_not_licensed_for_deliverables: '文档检索资格不包含原文再导出许可，含该证据的研究不生成成果文件。',
    no_matching_records: '部分范围未找到有效记录，不据此断言现实市场不存在。', unit_not_registered: '部分单位缺少正式定义，须核验后生成。',
    numeric_evidence_missing: '部分数值缺少正式来源，未允许生成。', missing_or_restricted_cells: '部分值缺失、受控或未核验，原状态保留。',
    cell_source_invalid: '部分表格引用不属于正式结果来源，未允许生成。',
    chart_not_available_for_result: '部分资料没有适用图种，保留完整原表。' } as Record<string, string>)[code] ?? '研究步骤未完成，请核对范围。';
}

/** Safe metadata only: neither private documents nor restricted business cells enter DeepSeek. */
export function researchObservation(result: QueryResult) {
  const task = researchTaskSchema.parse(result.parameters.researchTask);
  const review = result.parameters.researchReview as ReturnType<typeof reviewResearch>;
  return { status: 'ready', taskId: task.id, resultId: result.resultId, state: task.state,
    steps: task.steps.map(({ id, title, state, resultId, dependsOn, error }) => ({ id, title, state, resultId, dependsOn, error })),
    canGenerate: review.canGenerate, issues: review.issues,
    note: '仅为受控进度；正式证据在用户工作集。继续advance_research_task直到全部数据步骤完成，再review_research_task并生成成果；不能编写未经验证的业务结论。' };
}
