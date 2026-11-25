import { bindRuntimeControl } from '../control/runtimeControl';
import { ModelProviderError } from '../agent/modelProvider';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditPort } from './admission';
import type { AuditKeys } from './auditStore';
import { readAvailablePeriodGroups, type AvailablePeriods } from './availablePeriods';
import { SEMANTIC_PROTOCOL_VERSION, type QueryConversation } from './conversationProtocol';
import { authorizeConversationPlan, readConversation } from './conversationStore';
import { quarterKey, type Quarter } from './contracts';
import { MODEL_INTENT_LIMITS, semanticModelConfigured, understandWithModel } from './modelIntent';
import { parseQueryPlan, planPeriods, type QueryPlan } from './plan';
import { QUESTION_SUBMARKETS } from './question';
import type { QueryResult } from './result';
import { numericFields } from './registry';
import { buildSemanticSuggestions, inferSemanticPeriodFieldGroups, inferSemanticScope, parseSemanticIntent, resolveSemanticQuestion } from './semanticPlanner';
import { loadDataAuthority, type DataAuthority, type VerifiedQueryIdentity } from './serverAuthority';
import { describePlanRead } from './snapshotReader';
import { assertMultiMetricResultSize } from './multiMetric';
import { prepareBuildingIntent } from './buildingIntent';
import type { BuildingSelection } from './buildingNavigation';
import { mapPresentationQuestion } from './mapPresentationQuestion';
import { resolveAssistantHelp } from './assistantHelp';
import { readQuarterlyCoverage, describeQuarterlyCoverage, type QuarterlyCoverage } from './quarterlySources';

type Input = { client: SupabaseClient; keys: AuditKeys; identity: VerifiedQueryIdentity; authority: DataAuthority;
  audit: AuditPort; requestId: string; conversation: QueryConversation; question: string; buildingSelection?: BuildingSelection; receivedAt: Date; signal: AbortSignal; modelInvoke?: import('./modelIntent').SemanticModelInvoke; allowStandaloneModel?: boolean; serverContext?: import('./semanticPlanner').SemanticContext };

function planPeriodFieldGroups(plan: QueryPlan) {
  if ('metrics' in plan && plan.metrics) {
    const { metrics, ...single } = plan;
    return metrics.map(metric => describePlanRead(parseQueryPlan({ ...single, metric })).fields.filter(field => numericFields[field].temporal === 'quarter'));
  }
  const fields = describePlanRead(plan).fields.filter(field => numericFields[field].temporal === 'quarter');
  return fields.length ? [fields] : [];
}
const groupsKey = (groups: string[][]) => JSON.stringify([...new Set(groups.map(group => JSON.stringify([...new Set(group)].sort())))].sort());
/** Provider/config/transport failures are distinct from rejected semantic candidates. Never expose raw provider errors. */
const modelProviderUnavailable = (error: unknown): boolean => error instanceof ModelProviderError || error instanceof TypeError
  || error instanceof Error && (error.name === 'TimeoutError'
    || ['MODEL_NOT_CONFIGURED', 'MODEL_CONFIGURATION_INVALID', 'MODEL_PROVIDER_UNAVAILABLE',
      'MODEL_EMPTY_RESPONSE', 'MODEL_RESPONSE_TOO_LARGE'].includes(error.message));

export async function prepareSemanticExecution(input: Input) {
  const { client, identity, authority, keys, conversation, receivedAt, signal, audit, requestId } = input;
  const { question } = mapPresentationQuestion(input.question);
  if (conversation.parentRequestId === requestId) throw new Error('QUERY_DENIED');
  const previous = conversation.parentRequestId ? await readConversation(client, identity, keys, authority, conversation, conversation.parentRequestId, signal) : undefined;
  if (previous && previous.turn >= 40) throw new Error('QUERY_CONTEXT_LIMIT');
  const context = previous?.context ?? input.serverContext;
  const turn = (previous?.turn ?? 0) + 1;
  const help = resolveAssistantHelp(question, context);
  if (help) return { resolution: help, availability: undefined, suggestions: [], quarterlyCoverage: [] as QuarterlyCoverage[],
    metadata: { protocol: SEMANTIC_PROTOCOL_VERSION, semanticContext: help.context, turn,
      modelStatus: 'not_needed', suggestions: [], assistantHelp: true } };

  const building = await prepareBuildingIntent({ client, identity, authority, question, context, buildingSelection: input.buildingSelection, signal });
  if (building) {
    const { resolution, availability } = building;
    if (resolution.kind === 'plan') authorizeConversationPlan(resolution.plan, authority);
    const suggestions = resolution.kind === 'plan' ? buildSemanticSuggestions({ plan: resolution.plan, availablePeriods: availability?.periods ?? [], authority })
      .filter(value => { try { authorizeConversationPlan(value.plan, authority); return true; } catch { return false; } }) : [];
    return { resolution, availability, suggestions, quarterlyCoverage: [] as QuarterlyCoverage[], metadata: { protocol: SEMANTIC_PROTOCOL_VERSION, semanticContext: resolution.context,
      turn, modelStatus: 'not_needed', suggestions, ...(availability ? { availability } : {}),
      ...(resolution.kind === 'plan' ? { interpretation: resolution.interpretation } : {}) } };
  }
  let modelIntent: unknown;
  let resolution = resolveSemanticQuestion({ question, now: receivedAt, context, availablePeriods: [] });
  const action = previous?.suggestions.find(value => value.question === question);
  const allowedSubmarkets = authority.allSubmarkets ? [...QUESTION_SUBMARKETS] : QUESTION_SUBMARKETS.filter(value => authority.submarkets.includes(value));
  let modelStatus = 'not_needed';
  const scope = action?.plan.scope ?? inferSemanticScope(question, context);
  const fieldGroups = action ? planPeriodFieldGroups(action.plan)
    : resolution.kind === 'plan' ? planPeriodFieldGroups(resolution.plan)
      : inferSemanticPeriodFieldGroups(question, context);
  let availability: AvailablePeriods | undefined;
  // Ambiguity/unsupported conditions need no business metadata. A known temporal intent does.
  if (fieldGroups.length && (action || resolution.kind === 'plan' || ['period_required','unavailable_periods','unrecognized'].includes(resolution.clarification.reason))) {
    availability = await readAvailablePeriodGroups(client, identity, authority, scope, fieldGroups, signal);
    resolution = resolveSemanticQuestion({ question, now: receivedAt, context, availablePeriods: availability.periods, ...(modelIntent === undefined ? {} : { modelIntent }) });
  }
  if (!action && resolution.kind === 'clarification' && resolution.clarification.reason === 'unrecognized') {
    const configured = !!input.modelInvoke || input.allowStandaloneModel !== false && semanticModelConfigured();
    modelStatus = configured ? 'unavailable' : 'not_configured';
    if (configured) {
      const budget = input.modelInvoke ? { error: null, data: { allowed: true } } : await client.rpc('ai_query_model_budget', { p_actor: identity.actorId, p_effective: identity.effectiveUserId,
        p_session: identity.sessionId, p_request_id: requestId }).abortSignal(signal);
      signal.throwIfAborted();
      if (!budget.error && budget.data?.allowed === true) {
        await audit.append(requestId, 'tool_started', { tool: 'semantic_intent', provider: 'shared_model_runtime', limits: MODEL_INTENT_LIMITS,
          input: 'submitted_question_and_structured_slots_only', businessRecordsSent: 0 });
        let inferred: Awaited<ReturnType<typeof understandWithModel>> | undefined;
        try {
          const modelInvoke = input.modelInvoke ?? (await import('../agent/modelRuntime')).createModelRuntime({
            actorId: identity.actorId, question, mode: 'professional', control: await bindRuntimeControl(client, identity, signal, requestId),
            revalidate: async currentSignal => {
              const current = await loadDataAuthority(client, identity, currentSignal);
              if (current.permissionRevision !== authority.permissionRevision || current.policyVersion !== authority.policyVersion) throw new Error('QUERY_DENIED');
            }, onAttempt: async attempt => { await audit.append(requestId, 'accounting', attempt); },
          }).interpret;
          inferred = await understandWithModel(question, context, allowedSubmarkets, signal, modelInvoke);
          // Validate again at the planner boundary; even an adapter must not
          // supply a candidate that bypasses the strict intent contract.
          modelIntent = parseSemanticIntent(inferred.intent);
          modelStatus = 'validated_candidate';
        } catch (error) {
          if (error instanceof Error && error.message === 'QUERY_DENIED') throw error;
          modelStatus = error instanceof ModelProviderError && error.code === 'budget_exceeded' ? 'budget_exhausted' : modelProviderUnavailable(error) ? 'provider_unavailable' : 'rejected_or_unavailable';
        }
        // One accounting event per provider attempt. Audit, authority and data
        // failures below must propagate, never be mistaken for model rejection.
        await audit.append(requestId, 'accounting', { tool: 'semantic_intent', provider: 'shared_model_runtime',
          status: modelIntent === undefined ? 'unavailable_or_invalid' : 'completed', attempts: 1, calls: inferred ? 1 : null,
          usage: inferred?.usage ?? null, cost: null,
          costStatus: inferred?.usage ? 'provider_invoice_not_available' : 'unknown' });
        // A cancelled provider attempt may still be billed. Persist its unknown
        // usage before propagating cancellation; never invent a zero charge.
        signal.throwIfAborted();
        if (modelIntent !== undefined) {
          const modelGroups = inferSemanticPeriodFieldGroups(question, context, modelIntent);
          if (modelGroups.length && (!availability || groupsKey(availability.fieldGroups?.map(group => group.fields) ?? [availability.fields]) !== groupsKey(modelGroups))) {
            // At most one additional batch (each at most three groups) when
            // extraction supplies a new allowed field. Scope stays trusted.
            availability = await readAvailablePeriodGroups(client, identity, authority, scope, modelGroups, signal);
          }
          resolution = resolveSemanticQuestion({ question, now: receivedAt, context, availablePeriods: availability?.periods ?? [], modelIntent });
        }
      } else modelStatus = budget.error ? 'budget_unavailable' : 'budget_exhausted';
    }
  }
  if (action) {
    authorizeConversationPlan(action.plan, authority);
    const periods = planPeriods(action.plan).filter((p): p is Quarter => p !== null);
    resolution = { kind: 'plan', plan: action.plan,
      context: { version: 'colliers-semantic-context/1', lastPlan: action.plan,
        comparisonSubmarkets: [...new Set([...(context?.comparisonSubmarkets ?? []), ...(action.plan.scope.submarkets ?? [])])].slice(-8) },
      interpretation: { version: 'colliers-semantic-planner/1', method: 'bounded_semantic_rules', resolvedQuestion: action.question,
        periodBasis: '继承已审计的后续分析条件', periods, availableThrough: availability?.periods.at(-1) ?? null,
        unavailablePeriods: periods.filter(p => !availability?.periods.some(value => quarterKey(value) === quarterKey(p))),
        inherited: ['已确认的地区、期间、指标、筛选条件及统计口径'], notices: [] }, limitations: [] };
  }
  if (resolution.kind === 'plan') authorizeConversationPlan(resolution.plan, authority);
  if (availability?.availabilityMethod && resolution.kind === 'plan') {
    const basis = '多指标可用季度取各指标有效期间的交集；每项指标可使用不同的有效楼宇，不强制跨指标共同样本。';
    resolution = { ...resolution, limitations: [...resolution.limitations, basis], interpretation: { ...resolution.interpretation,
      periodBasis: `${resolution.interpretation.periodBasis}；${basis}` } };
  }
  if (availability?.availabilityMethod && resolution.kind === 'clarification' && resolution.clarification.reason === 'unavailable_periods') {
    const message = availability.truncated
      ? '有界可用期间索引未找到所有所选指标各自有有效样本的共同季度。部分索引只含最近40个有数据季度，请指定明确季度核查；不能据此判定历史数据不存在。'
      : '当前获权范围未找到所有所选指标各自有有效样本的共同季度。可以指定明确季度查看各项缺失情况，或分别查询指标。';
    const clarification = { ...resolution.clarification, message };
    resolution = { ...resolution, clarification, context: { ...resolution.context, pending: { question, clarification } } };
  }
  if (resolution.kind === 'clarification' && resolution.clarification.reason === 'unrecognized' && modelStatus !== 'not_needed') {
    const explanation = modelStatus === 'not_configured' ? '语义模型尚未配置，本轮未调用语义模型。'
      : modelStatus === 'budget_exhausted' ? '本轮语义解析额度已达保护上限，未调用语义模型。'
      : modelStatus === 'budget_unavailable' ? '本轮语义解析额度校验暂不可用，未调用语义模型。'
      : modelStatus === 'provider_unavailable' ? '模型语义解析暂不可用，本轮未取得模型结果。'
      : '本轮语义解析未形成可安全执行的计划。';
    resolution = { ...resolution, clarification: { ...resolution.clarification, message: `${explanation}${resolution.clarification.message}` } };
    resolution.context = { ...resolution.context, pending: { question, clarification: resolution.clarification } };
  }
  const quarterlyCoverage: QuarterlyCoverage[] = [];
  // The coverage RPC is a separately authorized aggregate, never a metric source.
  if (resolution.kind === 'plan' && availability) {
    const read = describePlanRead(resolution.plan);
    const quarterFields = read.fields.filter(field => numericFields[field].temporal === 'quarter');
    const available = new Set(availability.periods.map(quarterKey));
    const uncovered = read.periods.filter(period => !available.has(quarterKey(period)));
    if (quarterFields.length && uncovered.length > 0 && uncovered.length <= 2) {
      for (const period of uncovered) quarterlyCoverage.push(await readQuarterlyCoverage(
        client, identity, authority, resolution.plan.scope, quarterFields, period, signal));
    }
  }
  const suggestions = resolution.kind === 'plan' ? buildSemanticSuggestions({ plan: resolution.plan, availablePeriods: availability?.periods ?? [], authority,
    allowedSubmarkets }).filter(value => { try { authorizeConversationPlan(value.plan, authority); return true; } catch { return false; } }) : [];
  const metadata = { protocol: SEMANTIC_PROTOCOL_VERSION, semanticContext: resolution.context, turn, modelStatus, suggestions,
    ...(availability ? { availability } : {}), ...(resolution.kind === 'plan' ? { interpretation: resolution.interpretation } : {}) };
  return { resolution, metadata, availability, suggestions, quarterlyCoverage };
}

export function attachSemanticExecution(result: QueryResult, prepared: Awaited<ReturnType<typeof prepareSemanticExecution>>): QueryResult {
  const { resolution, availability, suggestions, quarterlyCoverage } = prepared;
  if (resolution.kind !== 'plan') throw new Error('SEMANTIC_PLAN_REQUIRED');
  const read = describePlanRead(resolution.plan);
  const tables = [...new Set(['buildings', ...read.fields.map(field => numericFields[field].table)])];
  return assertMultiMetricResultSize({ ...result, parameters: { ...result.parameters, executedPlan: resolution.plan, semanticContext: resolution.context,
    interpretation: resolution.interpretation, ...(availability ? { availablePeriods: availability } : {}),
    ...(quarterlyCoverage.length ? { quarterlyCoverage } : {}),
    dataPlan: { version: 'approved-source-router/1', tables, fields: read.fields.map(field => ({ field, table: numericFields[field].table,
      column: numericFields[field].column, unit: numericFields[field].unit })), joinKey: 'buildings.id = building_id',
      snapshotMode: 'single_authorized_statement', originalDocuments: 'not_linked' },
    suggestions: suggestions.map(({ id, label, question }) => ({ id, label, question })) },
    limitations: [...new Set([...result.limitations, ...resolution.limitations,
      ...quarterlyCoverage.map(item => describeQuarterlyCoverage(item, availability?.periods.at(-1) ?? null)),
      ...(availability?.truncated ? ['可用期间索引仅展示最近40个有有效记录的季度；更早明确季度以实际执行快照为准。'] : []),
      ...(resolution.plan.filter ? ['可用季度按地区、楼宇及指标范围定位；附加数值筛选后的有效样本以本次结果为准。'] : [])])] });
}
