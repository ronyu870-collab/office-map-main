import { z } from 'zod';
import { agentExportDescriptorSchema } from './exportProtocol';
import { reportDescriptorSchema } from './reportProtocol';
import { agentChartDescriptorSchema } from './chartProtocol';
import { resultBuildingRows } from './buildingCards';
import { resultAvailability } from './resultAvailability';
import { defaultResultChartRequest, resultNumericColumns } from './resultEligibility';
import { cellText, formatExact, resultSummary, units, type QueryResultView } from './presentation';
import { resultMetrics, resultMetricColumns, metricLabels } from './multiMetricView';
import type { ResearchAnalysis } from './researchAnalysisView';

/** A versioned presentation hint, never a source of facts or authorization.
 * Data blocks reference the one immutable, source-bound result instead of
 * copying tables, sources or model-authored values into another protocol. */
export const responsePresentationSchema = z.object({
  version: z.literal('response-presentation/1'),
  narrativeRole: z.enum(['analysis', 'result_summary', 'delivery_status']),
});
export type ResponseBlock =
  | { type: 'text'; text: string }
  | { type: 'summary' | 'metrics' | 'table' | 'chart' | 'building' | 'sources' | 'map' | 'suggestions' | 'analysis' | 'research' | 'location'; resultId: string }
  | { type: 'file'; resultId: string; format: 'xlsx' | 'csv_zip' | 'pdf' };
export type ResponseDocument = { version: 'response/1'; layout?: 'conversation' | 'fact' | 'list' | 'ranking' | 'trend' | 'delivery' | 'research'; blocks: ResponseBlock[] };

export type ResponseDecision = {
  task: NonNullable<ResponseDocument['layout']>;
  status: 'answered' | 'unavailable';
  primaryExpression: 'text' | 'status' | 'fact' | 'entity' | 'table' | 'chart' | 'file' | 'research';
  details: 'inline' | 'on_demand' | 'none';
  resultId: string;
};

/** Selects expression, never recalculates facts or infers authorization. The
 * source-bound operation, cells and delivery descriptors own structured data. */
/** A chart may be technically valid but not useful as the primary answer. */
export function answerDisplayPreferences(question?: string) {
  const text = question ?? '';
  const tableOnly = /不要(?:画|绘制|生成|显示|展示)?(?:图表|折线图|柱状图|图)|不需要(?:图表|图)|只(?:用|要|看)表格|不用(?:图表|图)/.test(text);
  const wantsTable = tableOnly || /(?:用|给出|展示|列出|提供|生成|看)(?:一张|一个)?表格|表格形式/.test(text);
  const wantsChart = !tableOnly && /(?:画|绘制|生成|展示|提供|给出|看)(?:一张|一个)?(?:折线图|柱状图|散点图|图表|趋势图)|可视化|作图/.test(text);
  const wantsSamples = /样本|参与计算|覆盖率|分母/.test(text);
  return { tableOnly, wantsTable, wantsChart, wantsSamples };
}
function isQuarterlyAnswer(result: QueryResultView) {
  return ['trend', 'group_trend', 'cross_trend', 'compare'].includes(result.operation) && resultMetrics(result).length > 0;
}
function preferTable(result: QueryResultView, question?: string) {
  const prefs = answerDisplayPreferences(question);
  return prefs.wantsTable || !prefs.wantsChart && isQuarterlyAnswer(result)
    && (result.operation === 'compare' || result.table.rows.length <= 2 || prefs.wantsSamples);
}
export function responseDecision(result: QueryResultView, task?: string, question?: string): ResponseDecision {
  const exported = agentExportDescriptorSchema.safeParse(result.parameters.agentExport).data;
  const report = reportDescriptorSchema.safeParse(result.parameters.agentReport).data;
  const chart = agentChartDescriptorSchema.safeParse(result.parameters.agentChart).data;
  const base = { resultId: result.resultId };
  if (result.parameters.researchTask != null) return { ...base, task: 'research', status: 'answered', primaryExpression: 'research', details: 'none' };
  if (exported || report) return { ...base, task: 'delivery', status: 'answered', primaryExpression: 'file', details: 'on_demand' };
  if (resultAvailability(result)) return { ...base, task: 'fact', status: 'unavailable', primaryExpression: 'status', details: result.table.rows.length ? 'on_demand' : 'none' };
  if (task === 'profile_evidence') return { ...base, task: 'list', status: 'answered', primaryExpression: 'table', details: 'inline' };
  const buildings = resultBuildingRows(result);
  const numeric = responseFactCells(result, task);
  const leaseDetails = z.array(z.object({ plan: z.object({ mode: z.literal('details') }) })).safeParse(result.parameters.leaseBindings).success;
  if (result.operation === 'rank' && Array.isArray(result.parameters.projection) && result.parameters.projection.length)
    return { ...base, task: 'ranking', status: 'answered', primaryExpression: 'table', details: 'inline' };
  const prefs = answerDisplayPreferences(question);
  const inlineTable = preferTable(result, question);
  const defaultChart = defaultResultChartRequest(result);
  const shortComparison = isQuarterlyAnswer(result) && (result.operation === 'compare' || result.table.rows.length <= 2);
  if (!prefs.tableOnly && (chart || defaultChart && result.operation !== 'list' && (prefs.wantsChart || !prefs.wantsTable && !shortComparison))) return { ...base,
    task: result.operation === 'rank' ? 'ranking' : ['trend', 'group_trend', 'cross_trend'].includes(result.operation) ? 'trend' : 'research',
    status: 'answered', primaryExpression: 'chart', details: inlineTable || isQuarterlyAnswer(result) && prefs.wantsSamples || ['trend', 'compare'].includes(result.operation) && result.table.rows.length <= 10 ? 'inline' : 'on_demand' };
  if (inlineTable && (prefs.wantsTable || defaultChart || isQuarterlyAnswer(result) && result.table.rows.length > 1 && numeric.length > 1)) return { ...base,
    task: isQuarterlyAnswer(result) ? 'trend' : result.operation === 'rank' ? 'ranking' : 'list',
    status: 'answered', primaryExpression: 'table', details: 'inline' };
  const buildingProfile = z.object({ buildingProfile: z.literal(true) }).safeParse(result.parameters.interpretation).success;
  if (buildingProfile && buildings.length || (buildings.length === 1 || leaseDetails) && result.table.rows.length === 1) return { ...base, task: 'fact', status: 'answered', primaryExpression: 'entity', details: 'on_demand' };
  if (numeric.length && (task === 'record' && result.parameters.dataDomain === 'lease-research/1' || result.operation === 'aggregate' || result.table.rows.length === 1 || ['trend', 'group_trend', 'cross_trend'].includes(result.operation)))
    return { ...base, task: 'fact', status: 'answered', primaryExpression: 'fact', details: prefs.wantsSamples && result.table.rows.length ? 'inline' : result.table.columns.length > numeric.length || result.table.rows.length > 1 ? 'on_demand' : 'none' };
  return { ...base, task: result.operation === 'rank' ? 'ranking' : 'list', status: 'answered', primaryExpression: 'table', details: 'inline' };
}

/** At most three original cells, selected by formal metric/field roles. Sample
 * counts never stand in for an unavailable primary metric. No new statistics. */
export function responseFactCells(result: QueryResultView, task?: string) {
  if (resultAvailability(result)) return [];
  const metricKeys = resultMetrics(result).flatMap(metric => {
    const keys = resultMetricColumns(result, metric);
    return [keys.value, keys.current, keys.base].filter(Boolean);
  });
  const leaseAggregate = result.parameters.dataDomain === 'lease-research/1' && (result.parameters.scope as { mode?: string } | undefined)?.mode !== 'details';
  const preferred = leaseAggregate ? ['count', 'area'] : [typeof result.parameters.field === 'string' ? result.parameters.field : '', ...metricKeys, 'value'];
  const numeric = resultNumericColumns(result);
  const valueKeys = preferred.filter(key => result.table.columns.some(column => column.key === key));
  const columns = [...new Set(valueKeys.length ? valueKeys : numeric.map(column => column.key))]
    .flatMap(key => { const column = result.table.columns.find(column => column.key === key); return column ? [column] : []; });
  let rows = result.table.rows;
  if (['trend', 'group_trend', 'cross_trend'].includes(result.operation)) {
    // When too few real periods qualify for a chart, show the actual dated
    // values, rather than spending the fact budget on preceding missing rows.
    rows = rows.filter(row => columns.some(column => row.cells[column.key]?.kind === 'number'));
  }
  if (leaseAggregate && task === 'record' && rows.length > 1) {
    // A bounded alternative summary, never a claim that the single-record
    // question was answered. Keep the exact chosen row and its original cells.
    const quarters = rows.flatMap(row => {
      const group = row.cells.group;
      const match = group?.kind === 'text' ? /^(\d{4})-?Q([1-4])$/.exec(group.value) : null;
      return match && ['count', 'area'].some(key => row.cells[key]?.kind === 'number') ? [{ row, ordinal: Number(match[1]) * 4 + Number(match[2]) }] : [];
    }).sort((a, b) => b.ordinal - a.ordinal);
    rows = quarters.length ? [quarters[0].row] : [];
  }
  return columns.flatMap(column => rows.flatMap(row => {
    const cell = row.cells[column.key];
    if (!cell || cell.kind === 'text') return [];
    const period = row.cells.period?.kind === 'text' ? row.cells.period.value : leaseAggregate && row.cells.group?.kind === 'text' ? row.cells.group.value : '';
    const metric = resultMetrics(result).length > 1 ? resultMetrics(result).find(metric => resultMetricColumns(result, metric).value === column.key) : undefined;
    const fieldLabel = metric ? metricLabels[metric] : column.label;
    const name = ['rank', 'group_trend', 'cross_trend'].includes(result.operation) && row.cells.name?.kind === 'text' ? row.cells.name.value : '';
    const label = [name, period, fieldLabel].filter(Boolean).join(' · ');
    return [{ column, cell, label, entityId: row.entityId }];
  })).slice(0, 3);
}

export function responseBuildingLocation(result: QueryResultView) {
  const location = z.object({ buildingLocation: z.object({ subject: z.string().min(1).max(80), submarket: z.string().min(1).max(80) }) })
    .safeParse(result.parameters.interpretation).data?.buildingLocation;
  const rows = result.table.rows;
  if (!location || result.operation !== 'list' || !rows.length) return undefined;
  const sources = new Map(result.sources.map(source => [source.id, source]));
  const sourceIds = new Set<string>();
  for (const row of rows) {
    const cell = row.cells.submarket;
    if (cell?.kind !== 'text' || cell.value !== location.submarket) return undefined;
    const evidence = cell.sourceIds.filter(id => {
      const source = sources.get(id);
      return source?.entityId === row.entityId && source.table === 'buildings'
        && source.field === 'submarket' && source.rawValue === location.submarket;
    });
    if (!evidence.length) return undefined;
    evidence.forEach(id => sourceIds.add(id));
  }
  return { ...location, scope: rows.length > 1 ? '的获权楼座位于 ' : '位于 ',
    sourceIds: [...sourceIds] };
}

export function composeResponse(message: string | undefined, result?: QueryResultView, task?: string, question?: string): ResponseDocument {
  if (!result) return { version: 'response/1', layout: 'conversation', blocks: message ? [{ type: 'text', text: message }] : [] };
  if (responseBuildingLocation(result)) return { version: 'response/1', layout: 'fact', blocks: [{ type: 'location', resultId: result.resultId }] };
  const presentation = responsePresentationSchema.safeParse(result.parameters.responsePresentation).data;
  const exported = agentExportDescriptorSchema.safeParse(result.parameters.agentExport).data;
  const report = reportDescriptorSchema.safeParse(result.parameters.agentReport).data;
  const chart = agentChartDescriptorSchema.safeParse(result.parameters.agentChart).data;
  const legacyDelivery = result.parameters.responsePresentation == null && !!(exported || report || chart);
  const narrative = presentation ? presentation.narrativeRole === 'analysis' : !legacyDelivery;
  const resultId = result.resultId;
  const decision = responseDecision(result, task, question);
  const tableFirst = decision.details === 'inline' && preferTable(result, question) && decision.primaryExpression !== 'file' && decision.primaryExpression !== 'research';
  const blocks: ResponseBlock[] = [];
  if (narrative && message) blocks.push({ type: 'text', text: message });
  if (decision.primaryExpression === 'file') {
    blocks.push({ type: 'file', resultId, format: exported?.format ?? 'pdf' });
  } else if (decision.primaryExpression === 'research') blocks.push({ type: 'research', resultId });
  else if (decision.primaryExpression !== 'status') {
    // A short lead is useful for comparisons/research, but repeating a fact or
    // an entity's fields above its formal visual adds no information.
    if (task !== 'profile_evidence' && ['chart', 'table'].includes(decision.primaryExpression)) blocks.push({ type: 'summary', resultId });
    if (decision.primaryExpression === 'fact') blocks.push({ type: 'metrics', resultId });
    if (decision.primaryExpression === 'entity') blocks.push({ type: 'building', resultId });
    if (tableFirst) blocks.push({ type: 'table', resultId });
    if (chart && !answerDisplayPreferences(question).tableOnly) blocks.push({ type: 'chart', resultId });
    else blocks.push({ type: 'analysis', resultId });
  }
  if (result.table.rows.length && decision.details !== 'none' && !blocks.some(block => block.type === 'table')) blocks.push({ type: 'table', resultId });
  blocks.push({ type: 'sources', resultId });
  return { version: 'response/1', layout: decision.task, blocks };
}

/** Shared by active replies and historical turns. Partial execution warnings
 * remain visible even when a typed delivery notice moves to an attachment. */
export function responseNarrative(message: string | undefined, result?: QueryResultView, executionStatus?: 'completed' | 'partial' | 'limited'): string {
  const presentation = responsePresentationSchema.safeParse(result?.parameters.responsePresentation).data;
  if (executionStatus && executionStatus !== 'completed' && presentation?.narrativeRole !== 'result_summary') return message ?? '';
  return composeResponse(message, result).blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n');
}

/** Editorial content comes only from the verified snapshot and attributed
 * findings. Method text remains available separately from the lead sentence. */
export function responseResultContent(result: QueryResultView, research: ResearchAnalysis | null) {
  const metrics = resultMetrics(result);
  const primaryFinding = metrics.length > 1 ? undefined : research?.findings.find(finding => finding.kind === 'trend');
  const summary = resultSummary(result);
  const index = result.operation === 'distribution' || result.operation === 'relationship' ? 1 : 0;
  const aggregate = metrics.length > 1 && result.operation === 'aggregate' && result.table.rows.length === 1
    ? metrics.flatMap(metric => {
      const key = resultMetricColumns(result, metric).value;
      const column = result.table.columns.find(item => item.key === key), cell = result.table.rows[0].cells[key];
      return column && cell ? [`${metricLabels[metric]}为 ${cellText(cell, column.unit)}${cell.kind === 'number' ? ` ${units[column.unit ?? ''] ?? column.unit ?? ''}` : ''}`] : [];
    }).join('；') : '';
  const series = primaryFinding && research?.series.find(item => primaryFinding.evidence.seriesKey === item.key);
  const shortTrend = series?.periods.length === 2 && series.overall ? series.overall : null;
  const shortLead = shortTrend?.baseValue && shortTrend.currentValue && series ? (() => {
    const value = formatExact(shortTrend.currentValue!, series.unit);
    const base = formatExact(shortTrend.baseValue!, series.unit);
    const scope = series.label ? series.label + '：' : '';
    const change = shortTrend.difference;
    const movement = change && change.numeric !== 0 ? change.numeric < 0 ? '下降' : '上升' : '持平';
    const period = (p: { year: number; quarter: number }) => p.year + ' Q' + p.quarter;
    const label = series.metric === 'rent' ? '面积加权净有效租金' : metricLabels[series.metric];
    const unit = units[series.unit] ?? series.unit;
    const magnitude = (v: Parameters<typeof formatExact>[0], u: string) => formatExact(v, u).replace(/^-/, '');
    const delta = change && change.numeric !== 0 ? (series.metric === 'vacancy' ? magnitude(change, 'percentage_point') + ' 个百分点' : shortTrend.change ? magnitude(shortTrend.change, shortTrend.changeUnit) + '%（' + magnitude(change, series.unit) + ' ' + unit + '）' : magnitude(change, series.unit) + ' ' + unit) : '';
    return scope + period(shortTrend.current) + ' ' + label + '为 ' + value + ' ' + unit + '，较 ' + period(shortTrend.base) + ' 的 ' + base + ' ' + unit + ' ' + movement + delta + '。';
  })() : undefined;
  const conclusion = shortLead ?? primaryFinding?.text ?? (result.parameters.dataDomain === 'lease-research/1' ? '成交汇总' : aggregate ? `${aggregate}。` : summary[index] ?? summary[0]);
  return { conclusion, primaryFinding, context: summary.filter((line, i) => (primaryFinding || i !== index) && line !== conclusion) };
}

export function responseTableTitle(result: QueryResultView): string {
  if (result.parameters.domain === 'knowledge-research/1') return '研究资料';
  if (result.parameters.dataDomain === 'lease-research/1') return '成交研究明细';
  if (result.parameters.businessTool === 'query_building_dossier') return '楼宇资料';
  if (result.parameters.dataDomain === 'business-research/1') return '业务资料';
  const scope = z.object({ submarkets: z.array(z.string()).optional() }).safeParse(result.parameters.scope).data;
  const object = scope?.submarkets?.join('、') ?? '';
  const field = typeof result.parameters.field === 'string' ? result.table.columns.find(column => column.key === result.parameters.field)?.label : null;
  if (['trend', 'group_trend', 'cross_trend', 'compare'].includes(result.operation)) return object + '季度数据与样本';
  return result.operation === 'rank' ? `${object}${field ?? '楼宇'}排名`
    : result.operation === 'list' ? `${object}楼宇清单` : `${object}数据明细`;
}
