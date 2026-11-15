import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditPort } from './admission';
import type { AuditKeys } from './auditStore';
import { readAvailablePeriods, type AvailablePeriods } from './availablePeriods';
import { SEMANTIC_PROTOCOL_VERSION, type QueryConversation } from './conversationProtocol';
import { authorizeConversationPlan, readConversation } from './conversationStore';
import { quarterKey, type Quarter } from './contracts';
import { MODEL_INTENT_LIMITS, semanticModelConfigured, understandWithModel } from './modelIntent';
import { planPeriods } from './plan';
import { QUESTION_SUBMARKETS } from './question';
import type { QueryResult } from './result';
import { numericFields } from './registry';
import { buildSemanticSuggestions, inferSemanticPeriodFields, inferSemanticScope, parseSemanticIntent, resolveSemanticQuestion } from './semanticPlanner';
import type { DataAuthority, VerifiedQueryIdentity } from './serverAuthority';
import { describePlanRead } from './snapshotReader';

type Input = { client: SupabaseClient; keys: AuditKeys; identity: VerifiedQueryIdentity; authority: DataAuthority;
  audit: AuditPort; requestId: string; conversation: QueryConversation; question: string; receivedAt: Date; signal: AbortSignal };

export async function prepareSemanticExecution(input: Input) {
  const { client, identity, authority, keys, conversation, question, receivedAt, signal, audit, requestId } = input;
  if (conversation.parentRequestId === requestId) throw new Error('QUERY_DENIED');
  const previous = conversation.parentRequestId ? await readConversation(client, identity, keys, authority, conversation, conversation.parentRequestId, signal) : undefined;
  if (previous && previous.turn >= 40) throw new Error('QUERY_CONTEXT_LIMIT');
  const context = previous?.context;
  const turn = (previous?.turn ?? 0) + 1;
  let modelIntent: unknown;
  let resolution = resolveSemanticQuestion({ question, now: receivedAt, context, availablePeriods: [] });
  const action = previous?.suggestions.find(value => value.question === question);
  const allowedSubmarkets = authority.allSubmarkets ? [...QUESTION_SUBMARKETS] : QUESTION_SUBMARKETS.filter(value => authority.submarkets.includes(value));
  let modelStatus = 'not_needed';
  const scope = action?.plan.scope ?? inferSemanticScope(question, context);
  const fields = action ? describePlanRead(action.plan).fields.filter(field => numericFields[field].temporal === 'quarter')
    : resolution.kind === 'plan' ? describePlanRead(resolution.plan).fields.filter(field => numericFields[field].temporal === 'quarter')
      : inferSemanticPeriodFields(question, context);
  let availability: AvailablePeriods | undefined;
  // Ambiguity/unsupported conditions need no business metadata. A known temporal intent does.
  if (fields.length && (action || resolution.kind === 'plan' || ['period_required','unavailable_periods','unrecognized'].includes(resolution.clarification.reason))) {
    availability = await readAvailablePeriods(client, identity, authority, scope, fields, signal);
    resolution = resolveSemanticQuestion({ question, now: receivedAt, context, availablePeriods: availability.periods, ...(modelIntent === undefined ? {} : { modelIntent }) });
  }
  if (!action && resolution.kind === 'clarification' && resolution.clarification.reason === 'unrecognized') {
    modelStatus = semanticModelConfigured() ? 'unavailable' : 'not_configured';
    if (semanticModelConfigured()) {
      const budget = await client.rpc('ai_query_model_budget', { p_actor: identity.actorId, p_effective: identity.effectiveUserId,
        p_session: identity.sessionId, p_request_id: requestId }).abortSignal(signal);
      signal.throwIfAborted();
      if (!budget.error && budget.data?.allowed === true) {
        await audit.append(requestId, 'tool_started', { tool: 'semantic_intent', provider: 'deepseek', limits: MODEL_INTENT_LIMITS,
          input: 'submitted_question_and_structured_slots_only', businessRecordsSent: 0 });
        let inferred: Awaited<ReturnType<typeof understandWithModel>> | undefined;
        try {
          inferred = await understandWithModel(question, context, allowedSubmarkets, signal);
          // Validate again at the planner boundary; even an adapter must not
          // supply a candidate that bypasses the strict intent contract.
          modelIntent = parseSemanticIntent(inferred.intent);
          modelStatus = 'validated_candidate';
        } catch {
          modelStatus = 'rejected_or_unavailable';
        }
        // One accounting event per provider attempt. Audit, authority and data
        // failures below must propagate, never be mistaken for model rejection.
        await audit.append(requestId, 'accounting', { tool: 'semantic_intent', provider: 'deepseek',
          status: modelIntent === undefined ? 'unavailable_or_invalid' : 'completed', attempts: 1, calls: inferred ? 1 : null,
          usage: inferred?.usage ?? null, cost: null,
          costStatus: inferred?.usage ? 'provider_invoice_not_available' : 'unknown' });
        // A cancelled provider attempt may still be billed. Persist its unknown
        // usage before propagating cancellation; never invent a zero charge.
        signal.throwIfAborted();
        if (modelIntent !== undefined) {
          const modelFields = [...new Set(inferSemanticPeriodFields(question, context, modelIntent))].sort();
          if (modelFields.length && (!availability || JSON.stringify(availability.fields) !== JSON.stringify(modelFields))) {
            // At most one extra metadata read if semantic extraction supplied a
            // previously unknown allowed field. Scope still comes from trusted slots.
            availability = await readAvailablePeriods(client, identity, authority, scope, modelFields, signal);
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
  if (resolution.kind === 'clarification' && resolution.clarification.reason === 'unrecognized' && modelStatus !== 'not_needed') {
    const explanation = modelStatus === 'not_configured' ? '语义模型尚未配置。' : modelStatus === 'budget_exhausted' ? '本轮语义解析额度已达保护上限。' : '本轮语义解析未形成可安全执行的计划。';
    resolution = { ...resolution, clarification: { ...resolution.clarification, message: `${explanation}${resolution.clarification.message}` } };
    resolution.context = { ...resolution.context, pending: { question, clarification: resolution.clarification } };
  }
  const suggestions = resolution.kind === 'plan' ? buildSemanticSuggestions({ plan: resolution.plan, availablePeriods: availability?.periods ?? [], authority,
    allowedSubmarkets }).filter(value => { try { authorizeConversationPlan(value.plan, authority); return true; } catch { return false; } }) : [];
  const metadata = { protocol: SEMANTIC_PROTOCOL_VERSION, semanticContext: resolution.context, turn, modelStatus, suggestions,
    ...(availability ? { availability } : {}), ...(resolution.kind === 'plan' ? { interpretation: resolution.interpretation } : {}) };
  return { resolution, metadata, availability, suggestions };
}

export function attachSemanticExecution(result: QueryResult, prepared: Awaited<ReturnType<typeof prepareSemanticExecution>>): QueryResult {
  const { resolution, availability, suggestions } = prepared;
  if (resolution.kind !== 'plan') throw new Error('SEMANTIC_PLAN_REQUIRED');
  const read = describePlanRead(resolution.plan);
  const tables = [...new Set(['buildings', ...read.fields.map(field => numericFields[field].table)])];
  return { ...result, parameters: { ...result.parameters, executedPlan: resolution.plan, semanticContext: resolution.context,
    interpretation: resolution.interpretation, ...(availability ? { availablePeriods: availability } : {}),
    dataPlan: { version: 'approved-source-router/1', tables, fields: read.fields.map(field => ({ field, table: numericFields[field].table,
      column: numericFields[field].column, unit: numericFields[field].unit })), joinKey: 'buildings.id = building_id',
      snapshotMode: 'single_authorized_statement', originalDocuments: 'not_linked' },
    suggestions: suggestions.map(({ id, label, question }) => ({ id, label, question })) },
    limitations: [...new Set([...result.limitations, ...resolution.limitations,
      ...(availability?.truncated ? ['可用期间索引仅展示最近40个有有效记录的季度；更早明确季度以实际执行快照为准。'] : []),
      ...(resolution.plan.filter ? ['可用季度按地区、楼宇及指标范围定位；附加数值筛选后的有效样本以本次结果为准。'] : [])])] };
}
