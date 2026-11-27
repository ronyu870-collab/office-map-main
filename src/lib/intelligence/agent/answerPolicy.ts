import type { QueryResult } from '../query/result';
import { answerSelectionSchema, selectedAnswerResult, type AnswerSelection } from '../query/answerSelection';
import { resultAvailability } from '../query/resultAvailability';
import { quarterlyAnswerIssues } from '../query/answerCompleteness';
import { isLeaseResult, leaseBindingSchema } from '../lease/protocol';

export const isLatestLeaseQuestion = (question: string) => /成交|租赁/.test(question)
  && /(?:最新|最近|最后).{0,8}(?:一笔|一条|一宗|成交)|(?:一笔|单笔|哪笔|哪一笔).{0,8}(?:成交|租赁)|(?:成交|租赁).{0,8}(?:哪笔|哪一笔)/.test(question);
export const hasExplicitLeaseWindow = (question: string) => /\d{4}(?:年|[-/]\d{1,2}|\s*[Qq][1-4])|今年|本年|去年|本季度|上季度|本月|上月|(?:最近|过去|近)(?:一|两|二|三|四|五|六|七|八|九|十|\d+)(?:年|季度|个月|月|天)/.test(question);

const leaseItemCount = (raw: string | undefined) => {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const ones = '零一二三四五六七八九';
  const normalized = raw.replace(/两/g, '二');
  const [left, right] = normalized.split('十');
  return right === undefined ? ones.indexOf(left) : 10 * (left ? ones.indexOf(left) : 1) + (right ? ones.indexOf(right) : 0);
};

export function assertLeaseDetailIntent(question: string, args: Record<string, unknown>) {
  const text = question.normalize('NFKC').replace(/\s/g, '');
  const itemCount = /(?:前|最大(?:的)?|最高(?:的)?|最近(?:的)?)([1-9]\d{0,2}|[一二两三四五六七八九十]{1,3})(?:笔|宗)/.exec(text);
  if (!/成交|租赁/.test(text) || !(/单笔|逐笔|每笔|成交明细|大宗.*(?:成交|租赁)/.test(text) || itemCount)
    || /(?:并|同时|以及).{0,8}(?:汇总|累计|合计)/.test(text)) return;
  const count = leaseItemCount(itemCount?.[1]);
  const rankByArea = /面积.{0,8}(?:最大|最小|最高|最低|排名|排行|前|升序|降序|大到小|小到大)|大宗.*(?:成交|租赁)/.test(text);
  const direction = /面积.{0,12}(?:最小|最低|升序|小到大)/.test(text) ? 'asc' : 'desc';
  const halfYears = [...text.matchAll(/((?:19|20|21)\d{2})年?([上下])半年/g)];
  const halfYear = halfYears.length === 1 ? halfYears[0] : undefined;
  if (args.mode !== 'details' || rankByArea && (args.sort !== 'area' || args.direction !== direction)
    || count !== undefined && count > 0 && args.topN !== count
    || halfYear && (args.from !== `${halfYear[1]}-${halfYear[2] === '上' ? '01-01' : '07-01'}`
      || args.to !== `${halfYear[1]}-${halfYear[2] === '上' ? '06-30' : '12-31'}`))
    throw new Error('LEASE_DETAIL_PLAN_REQUIRED');
}

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
  const { unavailableFields, deniedFields } = (primary.parameters.interpretation as {
    unavailableFields?: string[]; deniedFields?: string[];
  } | undefined) ?? {};
  if ((unavailableFields?.length || deniedFields?.length) && ['answered', 'partial'].includes(next.status)) {
    const notices = [
      next.notice,
      unavailableFields?.length ? `当前结构化查数无法提供${unavailableFields.join('、')}。` : undefined,
      deniedFields?.length ? `当前身份未获授权查阅${deniedFields.join('、')}。` : undefined,
    ];
    next = { ...next, status: 'partial', notice: notices.filter(Boolean).join(' ') };
  }
  if (next.status === 'answered') {
    const issues = quarterlyAnswerIssues(question, primary);
    if (issues.length) next = { ...next, status: 'partial', notice: [next.notice, ...issues].filter(Boolean).join(' ') };
  }
  return next;
}
