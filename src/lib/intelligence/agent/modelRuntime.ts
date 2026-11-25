import { z } from 'zod';
import { requiresDataFactEvidence } from './queryObligation';
import { compactModelContext, modelContextEnvelope } from './modelContext';
import { AGENT_TOOLS, completeWithDeepSeek, deepseekAgentConfigured, ModelProviderError } from './modelProvider';
import { createOpenAIAdapter } from './openaiAdapter';
import type { AgentMessage, AgentCompletion, ModelAdapter, ProviderId } from './modelProtocol';
import { createDeepSeekAdapter } from './deepseekAdapter';

export const modelModeSchema = z.enum(['quick', 'professional', 'deep']);
export type ModelMode = z.infer<typeof modelModeSchema>;
type ContextDomain = 'lease' | 'business' | 'knowledge';
const limits = { quick: { rounds: 3, tools: 4 }, professional: { rounds: 7, tools: 10 }, deep: { rounds: 9, tools: 12 } } as const;
const boundedNumber = (name: string, fallback: number, min: number, max: number) => {
  const configured = process.env[name];
  if (configured !== undefined && !configured.trim()) throw new ModelProviderError('invalid_configuration');
  const value = configured === undefined ? fallback : Number(configured);
  if (!Number.isFinite(value) || value < min || value > max) throw new ModelProviderError('invalid_configuration');
  return value;
};
export function chooseModelMode(question: string, requested?: ModelMode): ModelMode {
  return requested ?? (/研究|报告|Word|PPT|PDF|多季度|综合|八个季度/i.test(question) ? 'deep'
    : /比较|趋势|图|导出|Excel|CSV|排名|最高|最低|租金|空置|所有楼|哪些楼|权限|高度|子市场|列出|查询|季度|翻页|楼宇|查|租赁|成交|行业|租户|TMT|空调|停车|地铁|竣工|认证/i.test(question) ? 'professional' : 'quick');
}
function openAIAllowed(actorId: string) {
  return process.env.AI_OPENAI_ENABLED === 'true'
    && (process.env.AI_OPENAI_ACTOR_IDS ?? '').split(',').map(s => s.trim()).includes(actorId);
}
export function modelAvailability(actorId: string) {
  let openai = false;
  if (openAIAllowed(actorId) && process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_AGENT_MODEL?.trim()) {
    try {
      boundedNumber('OPENAI_AGENT_INPUT_USD_PER_MILLION', NaN, 0, 1000);
      boundedNumber('OPENAI_AGENT_OUTPUT_USD_PER_MILLION', NaN, 0, 1000);
      openai = true;
    } catch { /* Invalid prices must not advertise a cost-governed model. */ }
  }
  return { deepseek: deepseekAgentConfigured(), openai, modes: ['quick', 'professional', 'deep'] as const };
}
type Rates = { input: number; output: number; basis: string };
export type ModelAttempt = {
  protocol: 'agent-model-attempt/1'; mode: ModelMode; attempt: number; provider: ProviderId; model: string;
  state: 'completed' | 'failed'; errorCode?: string; fallback: boolean; durationMs: number;
  inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; reasoningTokens: number | null;
  providerRequestId: string | null; estimateUsd: number; estimateBasis: string;
  reservationTokens: number; chargedTokens: number; usageStatus: 'provider_reported' | 'unknown_reserved' | 'not_sent';
  purpose?: 'agent' | 'semantic_intent' | 'synthesis';
  context?: ReturnType<typeof modelContextEnvelope>;
  billing: { actualUsd: null; state: 'not_reconciled'; currency: 'USD' };
};
const retryable = new Set(['not_configured', 'rate_limited', 'timeout', 'provider_unavailable', 'model_not_found', 'payment_required', 'stream_interrupted']);

/** Avoid sending four copies of the 11KiB chart spec and unrelated domain tools
 * on every round. This is a model capability catalogue, never a data grant. */
export function modelToolCatalogue(question: string, mode: ModelMode, messages: AgentMessage[], hasChartContext = false, contextDomains: readonly ContextDomain[] = []) {
  if (/^(?:你好|您好|嗨|哈[喽啰]|hello|hi|谢谢|多谢|感谢|thanks|thank you)[！!。.?？\s]*$/i.test(question.trim())) return [];
  if (/概念|含义|定义|方法|如何计算|怎么计算|写一|^(?:请)?(?:什么是|解释|介绍|说明|what is|define|explain)/i.test(question.trim()) && !requiresDataFactEvidence(question)) return [];
  void mode;
  const research = /研究|报告|Word|PPT|PDF|research|report/i.test(question);
  const hasResult = hasChartContext || contextDomains.length > 0 || messages.some(m => m.role === 'tool' && /"resultId"/.test(m.content ?? ''));
  const selected = new Set(['query_verified_real_estate', 'get_data_capabilities', 'search_buildings']);
  if (/列表|列出|所有|全部|哪些|list/i.test(question)) selected.add('list_buildings');
  if (/高度|楼层|车位|参数|profile/i.test(question)) selected.add('get_building_profile');
  if (/排名|最高|最低|top|rank/i.test(question)) selected.add('rank_buildings');
  if (/租金|空置|季度|rent|vacancy|quarter/i.test(question)) selected.add('query_quarterly_metrics');
  if (hasResult && /排列|排序|筛选|分页|下一页|sort|filter|page/i.test(question)) selected.add('apply_result_view');
  if (hasResult) for (const name of ['summarize_result', 'check_data_coverage', 'get_source_evidence', 'select_answer_results']) selected.add(name);
  if (/复合|交叉|多指标|cross/i.test(question)) selected.add('execute_query_plan');
  if (research || /比较|对比|变化|趋势|同比|环比|多季度|过去|近.{0,6}季度|(?:和|与|、).{0,30}(?:同一|一张|一起|同图)/.test(question))
    for (const name of ['compare_market_segments', 'analyze_market_trends', 'compare_result_sets']) selected.add(name);
  if (research || /空置|散点|相关|联合/.test(question)) selected.add('analyze_rent_vacancy');
  if (research || /分布|直方|箱线|异常/.test(question)) selected.add('analyze_distribution');
  if (/Excel|CSV|xlsx|导出|表格|全部结果/i.test(question)) selected.add('export_table');
  if (/翻页|下一页|第.{0,6}页|继续列|更多结果/.test(question)) selected.add('read_result_page');
  if (/地图|定位|只查看|只看|选中/.test(question)) selected.add('prepare_map_selection');
  if (research || /摘要|总结|结论/.test(question)) selected.add('prepare_research_output');
  // Follow-up tasks retain tools already selected by this verified conversation.
  // This is discoverability only: the executor still rechecks every grant.
  const domainTools = new Set(['query_lease_transactions', 'query_building_dossier', 'query_submarket_profile',
    'query_future_supply', 'query_stacking_plan', 'list_knowledge_documents', 'search_internal_documents', 'search_public_building_information']);
  for (const message of messages) for (const call of message.calls ?? []) if (domainTools.has(call.name)) selected.add(call.name);
  if (contextDomains.includes('lease')) selected.add('query_lease_transactions');
  if (contextDomains.includes('business')) for (const name of ['query_building_dossier', 'query_submarket_profile', 'query_future_supply', 'query_stacking_plan']) selected.add(name);
  if (contextDomains.includes('knowledge')) for (const name of ['list_knowledge_documents', 'search_internal_documents']) selected.add(name);
  if (research) for (const name of ['plan_research_task', 'advance_research_task', 'review_research_task', 'generate_research_deliverable', 'query_report_market']) selected.add(name);
  if (/PDF/i.test(question)) selected.add('generate_pdf_report');
  if (/成交|租赁|租户|租在哪|行业|免租|签约|TMT|lease|transaction|tenant|industry/i.test(question)) selected.add('query_lease_transactions');
  if (/资料|楼书|参数|介绍|供应|楼层|层数|地址|行政区|等级|建成年|竣工|面积|高度|停车|车位|交通|地铁|绿色|认证|物业|设施|空调|客梯|通信|交付|GFA|LEED|Stacking|销控|单元/i.test(question))
    for (const name of ['query_building_dossier', 'query_submarket_profile', 'query_future_supply', 'query_stacking_plan']) selected.add(name);
  if (/文档|楼书|资料|公开|联网|报告.*比较|比较.*报告/.test(question))
    for (const name of ['list_knowledge_documents', 'search_internal_documents', 'search_public_building_information']) selected.add(name);
  // Existing charts already travel with their authorized result into report
  // renderers. Merely packaging a file must not add another 11KiB edit schema
  // and exhaust the unchanged budget before any model/tool can run.
  const filePackaging = /PDF|Word|PPT|PowerPoint|docx|pptx|Excel|CSV/i.test(question)
    && !/PNG|SVG|坐标|横轴|纵轴|(?:改|换|调整|绘制|画).{0,16}(?:图|轴)|(?:图|轴).{0,16}(?:改|换|调整)|(?:生成|制作|增加|添加|需要).{0,16}(?:柱状图|条形图|折线图|散点图|热力图|直方图|箱线图|趋势图|图表)/i.test(question);
  if (!filePackaging && (hasChartContext || /图|PNG|SVG|坐标|横轴|纵轴/i.test(question))) {
    const modifying = hasChartContext || /改|换|调整/.test(question) || messages.some(m => m.calls?.some(c => c.name === 'create_chart'));
    selected.add(modifying ? 'modify_chart' : 'create_chart');
    if (/导出|下载|PNG|SVG/i.test(question)) selected.add('export_chart');
  }
  return AGENT_TOOLS.filter(t => selected.has(t.function.name)).map(t => {
    const definition = t.function;
    // Packaging reuses the already applied chart. Avoid resending its complete
    // 11KiB edit schema in both creation and export tools on every model round.
    if (definition.name === 'export_chart' || definition.name === 'generate_pdf_report' && filePackaging) {
      const properties: Record<string, unknown> = { ...definition.parameters.properties };
      delete properties.chart; delete properties.charts;
      return { ...definition, parameters: { ...definition.parameters, properties } };
    }
    return definition;
  });
}

/** Request-local budget and routing; the existing DB receipt admission still
 * enforces the cross-instance per-account minute/day cap. No automatic SDK retries. */
export function createModelRuntime(input: { actorId: string; question: string; mode?: ModelMode; hasChartContext?: boolean; contextDomains?: readonly ContextDomain[];
  revalidate: (signal: AbortSignal) => Promise<void>; admit?: (signal: AbortSignal) => Promise<void>; onAttempt: (attempt: ModelAttempt) => Promise<void>;
  legacyInvoke?: typeof completeWithDeepSeek; adapters?: Partial<Record<ProviderId, ModelAdapter>> }) {
  const mode = chooseModelMode(input.question, input.mode), configured = process.env[`AI_PROVIDER_${mode.toUpperCase()}`] ?? 'deepseek';
  if (!['deepseek', 'openai'].includes(configured)) throw new ModelProviderError('invalid_configuration');
  let active: ProviderId = configured === 'openai' && openAIAllowed(input.actorId) ? 'openai' : 'deepseek';
  let fallbackUsed = false, spent = 0, tokens = 0, attempts = 0;
  let budgetRejection: string | null = null;
  let busy = false, admitted = false;
  const rejectBudget = (reason: NonNullable<ModelProviderError['budgetReason']>): never => {
    budgetRejection = reason; throw new ModelProviderError('budget_exceeded', reason);
  };
  const maxTokens = Math.floor(boundedNumber('AI_AGENT_MAX_TOKENS', 60000, 1000, 60000));
  const maxUsd = boundedNumber('AI_AGENT_MAX_ESTIMATED_USD', .25, .000001, 5);
  const maxOutputTokens = Math.floor(boundedNumber('AI_AGENT_MAX_OUTPUT_TOKENS', 1800, 256, 4096));
  const timeoutMs = Math.floor(boundedNumber('AI_AGENT_PROVIDER_TIMEOUT_MS', 18000, 1000, 18000));
  const records: ModelAttempt[] = [];
  const openai = createOpenAIAdapter();
  const deepseek = createDeepSeekAdapter(input.legacyInvoke);
  const config = (provider: ProviderId) => {
    if (provider === 'openai') {
      if (!openAIAllowed(input.actorId)) throw new ModelProviderError('disclosure_denied');
      const model = process.env[`OPENAI_AGENT_MODEL_${mode.toUpperCase()}`]?.trim() || process.env.OPENAI_AGENT_MODEL?.trim();
      if (!model) throw new ModelProviderError('not_configured');
      return { model, rates: { input: boundedNumber('OPENAI_AGENT_INPUT_USD_PER_MILLION', NaN, 0, 1000),
        output: boundedNumber('OPENAI_AGENT_OUTPUT_USD_PER_MILLION', NaN, 0, 1000), basis: 'operator_configured_upper_rates_not_invoice' } };
    }
    const model = process.env.DEEPSEEK_CHAT_MODEL?.trim() || process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash';
    const rates: Rates = model === 'deepseek-v4-pro' ? { input: 1.32, output: 3.96, basis: 'deepseek_planning_upper_range_2026-11-19_not_invoice' }
      : { input: .3, output: 1.2, basis: 'deepseek_planning_upper_range_2026-11-19_not_invoice' };
    return { model, rates };
  };
  const invokeInternal = async (originalMessages: AgentMessage[], signal: AbortSignal, onDelta?: (delta: string) => Promise<void>, purpose: 'agent' | 'semantic_intent' | 'synthesis' = 'agent'): Promise<AgentCompletion> => {
    const messages = compactModelContext(originalMessages);
    for (;;) {
      signal.throwIfAborted(); await input.revalidate(signal);
      const provider = active, started = Date.now();
      let configurationFailure: unknown;
      let settings: { model: string; rates: Rates };
      try { settings = config(provider); } catch (error) {
        configurationFailure = error;
        settings = { model: 'unconfigured', rates: { input: 0, output: 0, basis: 'request_not_sent' } };
      }
      const { model, rates } = settings;
      const tools = purpose === 'semantic_intent' ? [] : modelToolCatalogue(input.question, mode, messages, input.hasChartContext, input.contextDomains);
      const outputLimit = purpose === 'semantic_intent' ? Math.min(1200, maxOutputTokens) : maxOutputTokens;
      const context = modelContextEnvelope(provider, messages, tools);
      const upperInput = context.inputUpperTokens;
      const reserveTokens = configurationFailure ? 0 : upperInput + outputLimit;
      const reserveUsd = configurationFailure ? 0 : (upperInput * rates.input + outputLimit * rates.output) / 1e6;
      if (attempts >= limits[mode].rounds + 1) rejectBudget('attempt_limit');
      if (tokens + reserveTokens > maxTokens) rejectBudget('token_reservation');
      if (spent + reserveUsd > maxUsd) rejectBudget('cost_reservation');
      if (!admitted && !configurationFailure) {
        try { await input.admit?.(signal); }
        catch (error) { if (error instanceof ModelProviderError && error.code === 'budget_exceeded') rejectBudget(error.budgetReason ?? 'account_admission'); throw error; }
        admitted = true;
      }
      attempts++;
      let result: AgentCompletion | undefined, failure: unknown;
      const deltas: string[] = [];
      try {
        if (configurationFailure) throw configurationFailure;
        result = await (input.adapters?.[provider] ?? (provider === 'deepseek' ? deepseek : openai))(messages, signal,
          onDelta ? async delta => { deltas.push(delta); if (deltas.join('').length > 12000) throw new ModelProviderError('invalid_response'); } : undefined,
          { model, maxOutputTokens: outputLimit, timeoutMs: purpose === 'semantic_intent' ? Math.min(12000, timeoutMs) : timeoutMs, tools,
            ...(purpose === 'semantic_intent' && provider === 'deepseek' ? { responseFormat: 'json_object' as const, maxResponseBytes: 32768 } : {}) });
        if (result.provider !== provider || !Number.isSafeInteger(result.inputTokens ?? 0) || !Number.isSafeInteger(result.outputTokens ?? 0)
          || (result.inputTokens ?? 0) < 0 || (result.outputTokens ?? 0) < 0) throw new ModelProviderError('invalid_response');
      } catch (error) { failure = error; }
      const known = result && !failure && result.inputTokens !== null && result.outputTokens !== null;
      const notSent = failure instanceof ModelProviderError && ['not_configured', 'invalid_configuration', 'disclosure_denied'].includes(failure.code);
      const chargedTokens = notSent ? 0 : known ? result!.inputTokens! + result!.outputTokens! : reserveTokens;
      const estimateUsd = notSent ? 0 : known ? (result!.inputTokens! * rates.input + result!.outputTokens! * rates.output) / 1e6 : reserveUsd;
      tokens += chargedTokens; spent += estimateUsd;
      const errorCode = failure instanceof ModelProviderError ? failure.code : signal.aborted ? 'cancelled'
        : failure instanceof Error && failure.message === 'QUERY_DENIED' ? 'authorization_denied' : failure ? 'provider_unavailable' : undefined;
      const record: ModelAttempt = { purpose, context, protocol: 'agent-model-attempt/1', mode, attempt: attempts, provider, model: result?.model ?? model,
        state: failure ? 'failed' : 'completed', ...(errorCode ? { errorCode } : {}), fallback: fallbackUsed,
        durationMs: Math.max(0, Date.now() - started), inputTokens: result?.inputTokens ?? null, outputTokens: result?.outputTokens ?? null,
        cachedInputTokens: result?.cachedInputTokens ?? null, reasoningTokens: result?.reasoningTokens ?? null,
        providerRequestId: result?.providerRequestId?.slice(0, 150) ?? null, estimateUsd, estimateBasis: rates.basis,
        reservationTokens: reserveTokens, chargedTokens, usageStatus: notSent ? 'not_sent' : known ? 'provider_reported' : 'unknown_reserved',
        billing: { actualUsd: null, state: 'not_reconciled', currency: 'USD' } };
      records.push(record); await input.onAttempt(record);
      if (!failure) {
        if (tokens > maxTokens) rejectBudget('actual_token_limit');
        if (spent > maxUsd) rejectBudget('actual_cost_limit');
        await input.revalidate(signal);
        for (const delta of deltas) await onDelta?.(delta);
        return result!;
      }
      // Never retry business authorization, cancellation or arbitrary exceptions.
      if (!(failure instanceof ModelProviderError) || !retryable.has(failure.code) || fallbackUsed
        || process.env.AI_MODEL_FALLBACK_ENABLED !== 'true' || signal.aborted) throw failure;
      const alternate = provider === 'deepseek' ? 'openai' : 'deepseek';
      if (alternate === 'openai' && !openAIAllowed(input.actorId)) throw failure;
      await input.revalidate(signal); active = alternate; fallbackUsed = true;
    }
  };
  const invoke = async (messages: AgentMessage[], signal: AbortSignal, onDelta?: (delta: string) => Promise<void>, purpose: 'agent' | 'semantic_intent' | 'synthesis' = 'agent') => {
    // Serialize ownership, including nested interpretation and fallback. A
    // caller cannot race two reservations against the same remaining balance.
    if (busy) throw new ModelProviderError('invalid_configuration');
    busy = true;
    try { return await invokeInternal(messages, signal, onDelta, purpose); }
    finally { busy = false; }
  };
  return { mode, interpret: (messages: AgentMessage[], signal: AbortSignal) => invoke(messages, signal, undefined, 'semantic_intent'), limits: limits[mode], invoke, records,
    summary: () => ({ mode, attempts, estimatedUpperUsd: spent, chargedTokens: tokens, maxTokens, maxEstimatedUsd: maxUsd,
      budgetRejection, providers: [...new Set(records.map(r => r.provider))], fallbackUsed, actualBilledUsd: null, billingStatus: 'not_reconciled' as const }) };
}
