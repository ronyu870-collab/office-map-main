import { expandPendingQuestion, resolveSemanticQuestion, type SemanticContext } from '../query/semanticPlanner';
import { buildingLocationTarget, buildingProfileTarget } from '../query/buildingIntent';
import { requiresDataFactEvidence } from './queryObligation';
import type { QueryPlan } from '../query/plan';
import { restoredResultTableView, type ResultTableView, type ResultTableReference } from '../query/tableView';
import { externalModelForbidden } from './modelContext';
import { readMetroScreeningRequest, readSiteSelectionRequest, walkingOnlyThreshold, type SiteSelectionRequest } from './siteSelection';
import type { MetroScreeningRequest } from '../query/metroScreening';

export type ExecutionRoute = 'direct_response' | 'deterministic_query' | 'single_interpretation' | 'bounded_agent' | 'deep_research';
export type TaskRoute = {
  route: ExecutionRoute;
  taskType: 'social' | 'query' | 'artifact' | 'analysis' | 'research';
  question: string;
  plan?: QueryPlan;
  reply?: string;
  exportFormat?: 'xlsx' | 'csv_zip';
  reusePrevious?: boolean;
  reuseComparison?: boolean;
  reusePriorExport?: 'auto' | 'separate';
  catalogLookup?: 'location' | 'profile';
  siteSelection?: SiteSelectionRequest;
  metroSelection?: MetroScreeningRequest;
  walkingRouteUnavailable?: true;
  pendingSemantic?: SemanticContext;
  conceptExample?: true;
  planNotices?: string[];
  unavailableFields?: string[];
  capabilities?: boolean;
  availablePeriods?: boolean;
  tableView?: ResultTableView;
  chartExport?: 'png_zip' | 'svg_zip';
  modelForbidden?: boolean;
  chartType?: 'auto' | 'bar' | 'line' | 'scatter';
};

/** Only complete English templates are translated. Unmatched words, including
 * exclusions and extra clauses, remain untouched and cannot enter this path. */
function englishQuery(text: string): string {
  const metric = '(net effective rent|vacancy rate)';
  const scope = '(CBD|all authorized buildings)';
  const period = '(20\\d{2}Q[1-4])';
  const prefix = '(?:(?:show|query|compare)\\s+)?';
  let match: string[] | null = new RegExp(`^${prefix}${period}\\s+${scope}\\s+${metric}(?:\\s+(by submarket))?$`, 'i').exec(text);
  if (!match) {
    const alternate = new RegExp(`^${prefix}${scope}\\s+${metric}\\s+in\\s+${period}(?:\\s+(by submarket))?$`, 'i').exec(text);
    if (alternate) match = [alternate[0], alternate[3], alternate[1], alternate[2], alternate[4]];
  }
  if (match) return `${match[1]}${/^CBD$/i.test(match[2]) ? 'CBD' : '全部获权楼宇'}${/rent/i.test(match[3]) ? '净有效租金' : '空置率'}${match[4] ? '按子市场比较' : ''}`;
  const tallest = /^(?:show\s+)?(?:the\s+)?top\s+(\d{1,2})\s+tallest\s+buildings\s+in\s+CBD$/i.exec(text);
  if (tallest) return `CBD建筑高度排名前${tallest[1]}`;
  if (/^list all (?:authorized )?buildings in CBD$/i.test(text)) return 'CBD楼宇列表';
  return text;
}

export function precedingMarketComparison(question: string): boolean {
  const reference = '(?:这两(?:个|处)?(?:子市场|市场|区域)?|两者|两地)';
  const compare = '(?:并排)?(?:比较|对比)(?:一下)?';
  return new RegExp(`^(?:请)?(?:(?:把|将)?${reference}${compare}|${compare}${reference})$`, 'u')
    .test(question.normalize('NFKC').replace(/[\s。！？.!?]+/gu, ''));
}

export function resumesResearch(question: string, previousQuestion?: string): boolean {
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/gu, '').replace(/[。！？.!?]+$/u, '');
  const text = normalize(question);
  if (previousQuestion && text === normalize(previousQuestion)) return true;
  return /^(?:请)?(?:继续|恢复|接着)(?:执行|推进|完成|做)?(?:刚才|上次|当前|未完成|这份|这个|本次)?的?(?:研究|简报|报告|任务|工作)?[。！？.!?]*$/u.test(text)
    || /(?:刚才|上次|当前|这份|未完成).{0,8}(?:研究|简报|报告|任务)|(?:审查|导出|下载).{0,6}(?:研究|简报|报告)(?:成果|文件|状态|进度)?[。！？.!?]*$/u.test(question);
}

function priorWorkbookRequest(text: string) {
  const match = /^(?:请)?(?:把|将)(?:刚才|上次|前面|当前)的?(?:([二两三23])(?:个|份|张))?(?:结果|表格|数据)(分别)?(?:放到|写入|导出到|导出(?:为|成)?|生成|输出)\s*(?:同一个|一个|一份)?\s*(?:Excel|xlsx)\s*(?:文件|工作簿)?(?:[,，]\s*(每份一张工作表|每个结果一张工作表|分别放在独立工作表中?))?$/iu.exec(text);
  if (!match) return undefined;
  const [, countText, separately, instruction] = match;
  return { count: countText ? /^[三3]$/u.test(countText) ? 3 : 2 : undefined,
    separate: !!(separately || instruction) };
}

/** Full consumption is owned by the existing semantic planner. Wrappers below
 * remove only an entire, supported delivery suffix, never arbitrary conditions. */
export function routeTask(question: string, previousContext?: QueryPlan | SemanticContext, research = false, hasPreviousResult = false, previousResult?: ResultTableReference, hasPreviousComparison = false, priorResultCount = 0): TaskRoute {
  const savedContext = previousContext && 'version' in previousContext ? previousContext : undefined;
  const contextPlan = previousContext && 'operation' in previousContext ? previousContext : savedContext?.lastPlan;
  const text = question.normalize('NFKC').trim().replace(/[。！？.!?]+$/u, '').trim();
  if (externalModelForbidden(text)) {
    const local = text.replace(/[,，;；]?\s*(?:不要|不得|禁止)(?:发送给?|发给|传给)(?:外部模型|第三方模型|外部供应商)$/u, '').trim();
    if (local && local !== text) {
      const task = routeTask(local, previousContext, research, hasPreviousResult, previousResult, hasPreviousComparison, priorResultCount);
      if (['direct_response', 'deterministic_query'].includes(task.route)) return { ...task, question, modelForbidden: true };
    }
    return { route: 'direct_response', taskType: 'analysis', question, modelForbidden: true,
      reply: '本轮不向外部模型发送请求。当前条件尚不能由受控规则完整执行，请补充明确的查询范围、期间和指标。' };
  }
  if (/^(?:你好|您好|嗨|哈[喽啰]|hello|hi|hey)$/i.test(text))
    return { route: 'direct_response', taskType: 'social', question, reply: '你好。' };
  if (/^(?:谢谢|多谢|感谢|thanks|thank you)$/i.test(text))
    return { route: 'direct_response', taskType: 'social', question, reply: '不客气。' };
  if (/^(?:你能做什么|你可以做什么|你有什么功能|使用帮助|帮助|help|what can you do)$/i.test(text))
    return { route: 'direct_response', taskType: 'social', question, reply: '可在当前获权范围内查询楼宇和季度指标、比较市场、生成图表及研究文件。具体操作受独立资格与数据覆盖约束。' };
  if (/^(?:你是谁|你叫什么名字|who are you)$/i.test(text))
    return { route: 'direct_response', taskType: 'social', question, reply: '我是 Colliers AI，高力国际北京办公楼市场的研究与业务助手。' };
  if (/^(?:你有哪些数据权限|你有什么数据权限|我有哪些数据权限|what data permissions do I have)$/i.test(text))
    return { route: 'direct_response', taskType: 'query', question, capabilities: true };
  if (/^(?:你能够查询哪些季度|你能查询哪些季度|有哪些可用季度|可以查询哪些季度|which quarters are available)$/i.test(text))
    return { route: 'direct_response', taskType: 'query', question, capabilities: true, availablePeriods: true };
  if (buildingLocationTarget(text)) return { route: 'deterministic_query', taskType: 'query', catalogLookup: 'location', question: text };
  if (buildingProfileTarget(text)) return { route: 'deterministic_query', taskType: 'query', catalogLookup: 'profile', question: text };
  if (precedingMarketComparison(text)) {
    if (hasPreviousComparison) return { route: 'deterministic_query', taskType: 'query', question, reuseComparison: true };
    if ((contextPlan?.scope.submarkets?.length ?? 0) < 2)
      return { route: 'direct_response', taskType: 'query', question, reply: '当前会话没有两份查询条件一致且可重新核验的结果。请明确要比较的两个子市场及指标。' };
  }
  const priorComparison = /^(?:请)?(?:把|将)(?:刚才|上次|前面)的?(?:对比|比较)(?:结果|表格)?\s*导出(?:为|成)?\s*(Excel|xlsx|CSV)(?:文件)?$/i.exec(text)
    ?? /^(?:请)?导出(?:刚才|上次|前面)的?(?:对比|比较)(?:结果|表格)?(?:为|成)?\s*(Excel|xlsx|CSV)?(?:文件)?$/i.exec(text);
  if (priorComparison) {
    const format = /CSV/i.test(priorComparison[1] ?? '') ? 'csv_zip' : 'xlsx';
    if (hasPreviousComparison)
      return { route: 'deterministic_query', taskType: 'artifact', question, reuseComparison: true, exportFormat: format };
    const comparison = previousResult && ['compare', 'group_aggregate', 'group_trend', 'cross_aggregate', 'cross_trend']
      .includes(String(previousResult.parameters.executedPlan && (previousResult.parameters.executedPlan as { operation?: unknown }).operation));
    if (comparison)
      return { route: 'deterministic_query', taskType: 'artifact', question, reusePrevious: true, exportFormat: format };
    return { route: 'direct_response', taskType: 'artifact', question, reply: '当前会话没有可重新核验的对比结果。请打开原对比后再导出。' };
  }
  const workbook = !research && priorWorkbookRequest(text);
  if (workbook && (priorResultCount > 1 || workbook.count || workbook.separate)) {
    if (priorResultCount < 2 || workbook.count && priorResultCount !== workbook.count)
      return { route: 'direct_response', taskType: 'artifact', question,
        reply: `上一轮有 ${priorResultCount} 份可重新核验的结果。请打开包含所需结果的回答后再导出。` };
    return { route: 'deterministic_query', taskType: 'artifact', question,
      reusePriorExport: workbook.separate ? 'separate' : 'auto', exportFormat: 'xlsx' };
  }
  if (previousResult && hasPreviousResult) {
    const exportedChart = /^(?:请)?(?:(?:把|将)?(?:刚才|当前)的?(?:图表|图))?导出(?:为)?(PNG|SVG)$/i.exec(text)
      ?? /^export (?:the current chart as )?(PNG|SVG)$/i.exec(text);
    if (exportedChart && previousResult.parameters.agentChart)
      return { route: 'deterministic_query', taskType: 'artifact', question, reusePrevious: true, chartExport: /PNG/i.test(exportedChart[1]) ? 'png_zip' : 'svg_zip' };
    const madeChart = /^(?:生成|绘制)(柱状图|折线图|散点图|图表)$/.exec(text);
    if (madeChart) return { route: 'deterministic_query', taskType: 'artifact', question, reusePrevious: true,
      chartType: ({ 柱状图: 'bar', 折线图: 'line', 散点图: 'scatter', 图表: 'auto' } as const)[madeChart[1] as '柱状图'] };

    const sort = /^(?:把(?:刚才|当前)的?结果)?按(建筑高度|高度|净有效租金|租金|空置率|季度总面积)(从高到低|从低到高|降序|升序)(?:排序|排列)?$/.exec(text);
    const filter = /^(?:筛选|只看)(建筑高度|高度|净有效租金|季度总面积)(至少|不超过|大于等于|小于等于)(\d+(?:\.\d+)?)(米|平方米|元\/平方米\/月)?(?:的楼宇)?$/.exec(text);
    const page = /^(?:第([1-9]\d{0,3})页|下一页|继续分页)$/u.exec(text);
    const field = sort?.[1] ?? filter?.[1];
    const canonical = field === '高度' ? '建筑高度' : field === '租金' ? '净有效租金' : field;
    const columns = previousResult.table.columns.filter(c => canonical && (c.label === canonical || canonical === '净有效租金' && c.label === '面积加权净有效租金' || canonical === '季度总面积' && c.label === '总面积'));
    if (page || columns.length === 1 && (sort || filter)) {
      const prior = restoredResultTableView(previousResult), column = columns[0];
      const unit = filter?.[4];
      const unitMatches = !unit || ({ 米: 'm', 平方米: 'm2', '元/平方米/月': 'CNY/m2/month' } as Record<string, string>)[unit] === column?.unit;
      if (unitMatches) {
        const operator = filter && (/至少|大于等于/.test(filter[2]) ? 'gte' : 'lte');
        const tableView: ResultTableView = { ...prior,
          page: page ? page[1] ? Number(page[1]) - 1 : Math.min(4000, prior.page + 1) : 0,
          ...(sort ? { sort: { key: column.key, direction: /从低到高|升序/.test(sort[2]) ? 'asc' : 'desc' } } : {}),
          ...(filter && operator ? { filters: [...prior.filters.filter(f => f.key !== column.key || f.operator !== operator), { key: column.key,
            operator, value: filter[3] }] } : {}),
        };
        return { route: 'deterministic_query', taskType: 'query', question, reusePrevious: true, tableView };
      }
    }
  }
  if (research || /研究报告|综合报告|深度研究|(?:管理层|市场|研究)简报|research brief|Word|PPT|PowerPoint|docx|pptx|PDF/i.test(text))
    return { route: 'deep_research', taskType: 'research', question };
  const example = /^(?:请问|请)?(?:(?:解释|说明|讲解|介绍)(?:一下)?|什么是)?(净有效租金|空置率)(?:的(?:含义|定义|计算方法)|是什么意思|是什么)?[,.;?、。]?(?:并|再|然后)?(?:以|用|结合)(.+?)的?(?:正式季度数据|正式数据|实际数据|真实数据|实际案例)(?:来|作(?:为)?)?(?:举例|示例|说明|演示|为例)$/u.exec(text.replace(/\s+/gu, ''));
  if (example) {
    const metric = example[1] === '空置率' ? 'vacancy' : 'rent';
    const resolution = resolveSemanticQuestion({ question: example[2] + example[1], now: new Date(), availablePeriods: [] });
    if (resolution.kind === 'plan' && resolution.plan.operation === 'aggregate' && resolution.plan.metric === metric) {
      const reply = metric === 'vacancy' ? '本平台的季度空置率，用有效空置面积合计除以对应的有效总面积合计。'
        : '净有效租金反映折算租赁优惠后的单位面积月租。本平台按有效总面积对样本楼宇的净有效租金加权。';
      return { route: 'deterministic_query', taskType: 'analysis', question, plan: resolution.plan, reply, conceptExample: true };
    }
  }
  const siteSelection = readSiteSelectionRequest(text);
  if (siteSelection) return { route: 'deterministic_query', taskType: 'query', question, siteSelection };
  const metroSelection = readMetroScreeningRequest(text);
  if (metroSelection) return { route: 'deterministic_query', taskType: 'query', question, metroSelection, walkingRouteUnavailable: true };
  const walkMeters = walkingOnlyThreshold(text);
  if (walkMeters) return { route: 'direct_response', taskType: 'query', question, walkingRouteUnavailable: true,
    reply: `目前没有可核验的步行路线，无法确认 ${walkMeters} 米以内的办公楼。请提供目标地铁站或子市场。地图的「地铁通勤辐射圈」可按指定站点做直线距离初筛，步行距离仍需核实。` };
  if (!requiresDataFactEvidence(text, contextPlan) && /概念|含义|是什么|什么是|定义|方法|如何计算|怎么计算|写一|解释|what is|define|explain/i.test(text))
    return { route: 'bounded_agent', taskType: 'analysis', question };
  const chart = /^(?:请)?(?:把|将)?(.+?)(?:[,，]?(?:并|再|然后))?(?:生成|绘制|画成)\s*(柱状图|折线图|散点图|图表|图)$/.exec(text);
  const chartType = chart ? ({ 柱状图: 'bar', 折线图: 'line', 散点图: 'scatter', 图表: 'auto', 图: 'auto' } as const)[chart[2] as '柱状图'] : undefined;
  const exported = /^(?:请)?(?:把|将)?(.+?)(?:导出(?:为|成)?|生成|输出)\s*(Excel|xlsx|CSV)(?:文件)?$/i.exec(text);
  const exportFormat = exported ? /CSV/i.test(exported[2]) ? 'csv_zip' as const : 'xlsx' as const : undefined;
  const query = englishQuery(exported?.[1] ?? chart?.[1] ?? text).replace(/(?:，|,|并|再|然后)$/u, '').trim();
  if ((exported || chart) && /^(?:刚才|当前|上次|前面)的?(?:结果|表格|数据)$/u.test(query))
    return hasPreviousResult ? { route: 'deterministic_query', taskType: 'artifact', question: query, exportFormat, chartType, reusePrevious: true }
      : { route: 'bounded_agent', taskType: 'artifact', question };
  // Keep an explicit new query independent of stale conversation scope. Only
  // genuine slot edits inherit the verified previous plan.
  const context: SemanticContext | undefined = savedContext ?? (contextPlan ? {
    version: 'colliers-semantic-context/1', lastPlan: contextPlan, comparisonSubmarkets: contextPlan.scope.submarkets ?? [],
  } : undefined);
  const standalone = resolveSemanticQuestion({ question: query, now: new Date(), availablePeriods: [] });
  const resolution = standalone.kind === 'plan' || !context ? standalone
    : resolveSemanticQuestion({ question: query, context, now: new Date(), availablePeriods: [] });
  if (resolution.kind === 'plan') {
    const previousFields = previousResult?.parameters.interpretation as { unavailableFields?: string[]; requestedBuildingArea?: boolean } | undefined;
    const inheritedFields = /呢$/u.test(query) && contextPlan?.operation === 'rank' && resolution.plan.operation === 'rank'
      && resolution.plan.scope.submarkets?.length === 1 && query === `${resolution.plan.scope.submarkets[0]}呢`
      ? [...(previousFields?.unavailableFields ?? []), ...(previousFields?.requestedBuildingArea ? ['建筑面积'] : [])] : [];
    return { route: 'deterministic_query', taskType: exportFormat ? 'artifact' : 'query',
      question: query, plan: resolution.plan, planNotices: resolution.interpretation.notices,
      unavailableFields: [...new Set([...(resolution.interpretation.unavailableFields ?? []), ...inheritedFields])],
      ...(exportFormat ? { exportFormat } : {}), ...(chartType ? { chartType } : {}) };
  }
  if (resolution.clarification.reason === 'metric_required' && !chart && !exported) {
    const option = resolution.clarification.options.find(item => item.id === 'net_effective_rent');
    const supported = option && resolveSemanticQuestion({ question: option.question, context, now: new Date(), availablePeriods: [] });
    if (supported?.kind === 'plan' && 'metric' in supported.plan) {
      return { route: 'direct_response', taskType: 'query', question,
        reply: resolution.clarification.message, pendingSemantic: resolution.context };
    }
  }
  if (context?.pending) {
    const chosen = expandPendingQuestion(query, context);
    if (chosen !== query) {
      if (resolution.clarification.reason === 'period_required' || resolution.clarification.reason === 'unavailable_periods')
        return { route: 'single_interpretation', taskType: 'query', question: chosen };
      if (resolution.clarification.reason === 'unsupported')
        return { route: 'direct_response', taskType: 'query', question, reply: resolution.clarification.message };
    }
  }
  // A narrow semantic extraction gets no domain tools and cannot recurse into
  // the Agent. Unknown conditions stay fail-closed in the formal planner.
  if (!/成交|租赁|楼书|文档|资料|报告|Stacking|供应|地图|图|横轴|纵轴|[xy]轴|原因|为什么|分析差异|核对|检查|并|综合|研究|lease|transaction|document|report|axis|why|research/i.test(query)
    && /净有效租金|空置率|季度总面积|建筑高度|楼层数|总车位数|楼宇列表/.test(query)
    && !/导出|生成|Excel|CSV|xlsx|PNG|SVG/i.test(query))
    return { route: 'single_interpretation', taskType: exportFormat ? 'artifact' : 'query', question: exported ? query : question,
      ...(exportFormat ? { exportFormat } : {}) };
  return { route: 'bounded_agent', taskType: 'analysis', question };
}
