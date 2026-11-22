import { z } from 'zod';
import { defaultResultChartRequest, resultChartEligibility, resultNumericColumns } from '../query/resultEligibility';
import { buildResultChart, type ChartRequest } from '../query/charts';
import { queryMapHref } from '../query/buildingNavigation';
import { resultBuildingRows } from '../query/buildingCards';
import { resultViewSchema, type QueryResultView } from '../query/presentation';
import { renderResultCopy, resultOutputDescriptor } from '../query/resultOutput';
import type { QueryResult } from '../query/result';
import type { AgentToolObservation } from './agentOrchestrator';

export const PRESENTATION_TOOL_NAMES = new Set<string>([
  'get_source_evidence', 'prepare_chart', 'create_chart', 'modify_chart', 'export_chart', 'prepare_map_selection', 'prepare_research_output',
]);

type ResultToolName = 'get_source_evidence' | 'prepare_chart' | 'create_chart' | 'modify_chart' | 'prepare_map_selection' | 'prepare_research_output';
const uuid = z.uuid();
const limited = (reason: string): AgentToolObservation<QueryResult> => ({
  content: JSON.stringify({ status: 'requires_verified_result', reason,
    note: '请先调用授权楼宇或季度查询工具；不能仅根据模型输入生成正式结果。' }),
});

export function preferredChartRequest(view: QueryResultView): ChartRequest | null {
  const primary = defaultResultChartRequest(view);
  if (primary) return primary;
  let request: ChartRequest | null = null;
  if (view.parameters.dataDomain === 'lease-research/1') {
    if (!view.table.columns.some(c => c.key === 'group')) return null;
    const bindings = view.parameters.leaseBindings as Array<{ plan?: { groupBy?: string } }> | undefined;
    request = { kind: 'plot', type: bindings?.[0]?.plan?.groupBy === 'quarter' ? 'line' : 'bar', x: 'group', y: ['area'] };
  } else if (view.operation === 'list') {
    const column = resultNumericColumns(view)[0];
    if (column) request = { kind: 'bar', field: column.key };
  }
  return request && resultChartEligibility(view, request).eligible ? request : null;
}

/** Presentation tools never read a database or accept model-provided IDs,
 * numeric values, JSON charts or original source documents. Their sole input
 * is the currently authenticated, already-executed formal QueryResult. */
export function runResultPresentationTool(
  name: ResultToolName, requestId: string, result: QueryResult | undefined, args: { chart?: ChartRequest; buildingIds?:string[]; intent?:'focus'|'select'|'only' } = {},
): AgentToolObservation<QueryResult> {
  if (!PRESENTATION_TOOL_NAMES.has(name)) throw new Error('AGENT_UNREGISTERED_TOOL');
  if (!result) return limited('本轮还没有完成可引用的获权房地产查询。');
  const view = resultViewSchema.parse(result);
  if (name === 'get_source_evidence') {
    const sources = view.sources.slice(0, 16).map(source => ({
      sourceId: source.id, table: source.table, field: source.field,
      period: source.period ? `${source.period.year}Q${source.period.quarter}` : null,
      verification: source.verification, hasOriginal: Boolean(source.original),
    }));
    return { content: JSON.stringify({ status: 'ready', resultId: view.resultId,
      sources, totalSources: view.sources.length,
      incomplete: sources.length < view.sources.length,
      limitations: view.limitations.slice(0, 3),
      note: '仅返回已有正式结果的来源标识和核验状态；不提供未经获权的原文、租户和原始合同。' }), result };
  }
  if (name === 'prepare_chart' || name === 'create_chart' || name === 'modify_chart') {
    const request = args.chart ?? preferredChartRequest(view);
    if (!request) return { content: JSON.stringify({ status: 'unsupported', resultId: view.resultId,
      reason: '当前正式结果没有适合的图表形态。请勿凭想象生成图表数值。' }) };
    try {
      const chart = buildResultChart(view, request);
      const points = chart.points.slice(0, 14).map(point => ({
        label: point.label, x: point.x, y: point.y, state: point.state,
        sourceIds: point.yCell.sourceIds.slice(0, 4),
      }));
      return { content: JSON.stringify({ status: 'ready', resultId: view.resultId,
        chartKind: chart.kind, request, title: chart.title,
        xLabel: chart.xLabel, yLabel: chart.yLabel, xUnit: chart.xUnit, yUnit: chart.yUnit,
        points, visiblePoints: points.length, totalPoints: chart.points.length,
        unknownCount: chart.unknownCount, limitations: chart.limitations.slice(0, 3),
        note: '所有值均来自完整正式结果。规格已应用，回答中直接显示同源图表；图片导出须调用export_chart，不能声称本机已保存。' }),
        result: { ...result, parameters: { ...result.parameters, agentChart: { version: 'chart-workspace/1', request } } } };
    } catch (error) {
      return { content: JSON.stringify({ status: 'unsupported', resultId: view.resultId, code: error instanceof Error ? error.message : 'CHART_UNSUPPORTED',
        reason: '现有正式结果无法生成符合来源绑定的图表；未执行任何虚构计算。' }) };
    }
  }
  if (name === 'prepare_map_selection') {
    const authorized=resultBuildingRows(view).map(row=>row.id);
    const buildingIds=args.buildingIds??authorized;
    if(!buildingIds.length) return {content:JSON.stringify({status:'unavailable',mapHref:null,reason:'当前正式结果没有可操作的楼宇身份，不生成点位。'})};
    if(buildingIds.length>500 || new Set(buildingIds).size!==buildingIds.length) throw new Error('BUSINESS_SCOPE_TOO_LARGE');
    if(buildingIds.some(id=>!authorized.includes(id))) throw new Error('QUERY_DENIED');
    const intent=args.intent??'select';
    if(intent==='focus' && buildingIds.length!==1) throw new Error('AGENT_INVALID_TOOL_ARGUMENTS');
    const next={...result,parameters:{...result.parameters,agentMap:{version:'map-selection/1',buildingIds,intent}}};
    return {content:JSON.stringify({status:'ready',resultId:view.resultId,buildingCount:buildingIds.length,intent,
      mapHref:queryMapHref(uuid.parse(requestId),undefined,false,view.resultId),note:'地图操作已准备。打开时重新验证本人会话、来源、楼宇权限及现有地图坐标；当前回答尚未打开地图，不代表已经定位。'}),result:next};
  }
  const rendered = renderResultCopy(view, 'summary');
  return { content: JSON.stringify({ status: 'ready', resultId: view.resultId,
    descriptor: resultOutputDescriptor(view), excerpt: rendered.slice(0, 3500),
    truncated: rendered.length > 3500, totalCharacters: rendered.length,
    note: '源于已归档的正式结果内容与确定性摘要；非模型新编市场统计或已导出的文件。' }), result };
}
