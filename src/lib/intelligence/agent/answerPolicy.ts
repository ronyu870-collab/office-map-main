import type { QueryResult } from '../query/result';
import { answerSelectionSchema, selectedAnswerResult, type AnswerSelection } from '../query/answerSelection';
import { resultAvailability } from '../query/resultAvailability';
import { quarterlyAnswerIssues } from '../query/answerCompleteness';
import { isLeaseResult, leaseBindingSchema } from '../lease/protocol';

export const isLatestLeaseQuestion = (question: string) => /成交|租赁/.test(question)
  && /(?:最新|最近|最后).{0,8}(?:一笔|一条|一宗|成交)|(?:一笔|单笔|哪笔|哪一笔).{0,8}(?:成交|租赁)|(?:成交|租赁).{0,8}(?:哪笔|哪一笔)/.test(question);
export const hasExplicitLeaseWindow = (question: string) => /\d{4}(?:年|[-/]\d{1,2}|\s*[Qq][1-4])|今年|本年|去年|本季度|上季度|本月|上月|(?:最近|过去|近)(?:一|两|二|三|四|五|六|七|八|九|十|\d+)(?:年|季度|个月|月|天)/.test(question);

export function answerTask(question: string, result: QueryResult): AnswerSelection['task'] {
  if (isLeaseResult(result) && isLatestLeaseQuestion(question)) return 'record';
  if (result.parameters.agentExport || result.parameters.agentReport || result.parameters.researchDeliverables) return 'file';
  if (result.parameters.researchTask) return 'research';
  if (result.operation === 'rank') return 'ranking';
  if (result.operation.includes('trend')) return 'trend';
  if (result.operation === 'compare') return 'comparison';
  if (result.operation === 'aggregate') return 'fact';
  return 'list';
}

/** Selection is not proof of task completion. Enforce facts available to the
 * server, independently of supplier declarations or supplier disclosure limits. */
export function applyAnswerPolicy(question: string, selection: AnswerSelection,
  executionStatus: 'completed' | 'partial' | 'limited'): AnswerSelection {
  answerSelectionSchema.parse(selection);
  const primary = selectedAnswerResult(selection);
  let next: AnswerSelection = { ...selection,
    status: executionStatus === 'completed' ? selection.status : 'partial' };
  if (isLeaseResult(primary) && (selection.task === 'record' || answerTask(question, primary as QueryResult) === 'record')) {
    const bindings = Array.isArray(primary.parameters.leaseBindings)
      ? primary.parameters.leaseBindings.map(value => leaseBindingSchema.parse(value)) : [];
    const detail = bindings.length > 0 && bindings.every(binding => binding.plan.mode === 'details');
    const explicitWindow = hasExplicitLeaseWindow(question);
    const coverage = primary.parameters.leaseCoverage as { uncertainDates?: number; boundaryDates?: number } | undefined;
    const latestPlan = detail && bindings.every(binding => binding.plan.sort === 'period'
      && binding.plan.direction === 'desc' && binding.plan.topN === 1);
    const precise = primary.table.rows.length > 0 && primary.table.rows.every(row => row.cells.precision?.kind === 'text'
      && row.cells.precision.value === 'date' && row.cells.period?.kind === 'text' && /^\d{4}-\d{2}-\d{2}$/.test(row.cells.period.value));
    const confirmedInWindow = explicitWindow && latestPlan && precise
      && coverage?.uncertainDates === 0 && coverage?.boundaryDates === 0;
    next = { ...next, task: 'record', status: 'partial',
      notice: !explicitWindow
        ? '尚不能确认全历史最新一笔成交。请明确要查询的日期范围。'
        : detail
        ? '以下为查询区间内的获权成交记录；日期精度、并列和查询范围须核对，尚不能确认全历史最新一笔。'
        : '当前结果为成交汇总，无法确认最新一笔成交。',
      results: next.results.map(item => item.result.resultId === next.primaryResultId && !detail
        ? { ...item, role: 'alternative' } : item) };
    if (!explicitWindow) next.status = 'needs_conditions';
    if (confirmedInWindow) next = { ...next, status: primary.table.rows.length === 1 ? 'answered' : 'partial',
      notice: primary.table.rows.length === 1 ? '以下为查询区间内按业务日期确定的最新获权成交记录。'
        : '查询区间内最新成交日期存在并列，以下保留全部并列记录，不能指定唯一一笔。' };
  }
  if (resultAvailability(primary) && next.task !== 'record') next = { ...next, status: 'unavailable' };
  if (next.status === 'answered') {
    const issues = quarterlyAnswerIssues(question, primary);
    if (issues.length) next = { ...next, status: 'partial', notice: [next.notice, ...issues].filter(Boolean).join(' ') };
  }
  return next;
}
