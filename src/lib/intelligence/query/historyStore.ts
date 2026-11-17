import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { assistantHelpSchema } from './assistantHelp';
import { decryptAuditContent, encryptAuditContent, redactSubmittedCredentials } from './auditCrypto';
import type { AuditKeys } from './auditStore';
import { authorizeConversationPlan } from './conversationStore';
import { queryConversationSchema, SEMANTIC_PROTOCOL_VERSION } from './conversationProtocol';
import { historyTurnSchema, type HistoryEntry, type HistoryInput, type HistoryOpened, type HistoryPage } from './historyProtocol';
import { sealHistoryToken, unsealHistoryToken } from './historyToken';
import { parseQueryPlan, planPeriods } from './plan';
import { buildSemanticSuggestions, parseSemanticContext, type SemanticClarification, type SemanticResolution } from './semanticPlanner';
import type { prepareSemanticExecution } from './semanticExecution';
import type { Quarter } from './contracts';
import { readQuerySnapshots } from './snapshotReader';
import { resultViewSchema } from './presentation';
import { readOwnResult, recoverOwnResult } from './recovery';
import { loadDataAuthority, type DataAuthority, type VerifiedQueryIdentity } from './serverAuthority';

type Context = { client: SupabaseClient; keys: AuditKeys; identity: VerifiedQueryIdentity; authority: DataAuthority; signal: AbortSignal };
const eventSchema = z.object({ request_id: z.uuid(), event_id: z.uuid(), sequence: z.number().int().positive(), kind: z.string(), cipher: z.unknown() });
const threadSchema = z.object({ actor_id: z.uuid(), effective_user_id: z.uuid(), conversation_id: z.uuid(), last_request_id: z.uuid(),
  updated_at: z.string(), archived: z.boolean(), title_event_id: z.uuid().nullable(), title_cipher: z.unknown().nullable() });
const beforeSchema = z.strictObject({ beforeTime: z.string(), beforeId: z.uuid() });
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();

async function historyRpc(context: Context, input: Record<string, unknown>) {
  const { client, identity, authority, signal } = context;
  const { data, error } = await client.rpc('ai_query_history', { p_actor: identity.actorId, p_effective: identity.effectiveUserId,
    p_session: identity.sessionId, p_revision: authority.permissionRevision, p_input: input }).abortSignal(signal);
  signal.throwIfAborted();
  if (error) throw new Error('QUERY_HISTORY_UNAVAILABLE');
  if (data?.allowed !== true || data.permissionRevision !== authority.permissionRevision) throw new Error('QUERY_DENIED');
  return data as Record<string, unknown>;
}

function decodeReceipt(context: Context, requestId: string, raw: unknown) {
  const event = eventSchema.parse(raw);
  if (event.request_id !== requestId || event.sequence !== 1 || event.kind !== 'received') throw new Error('QUERY_HISTORY_UNAVAILABLE');
  const decoded = JSON.parse(decryptAuditContent(event.cipher, { requestId, eventId: event.event_id,
    actorId: context.identity.actorId, effectiveUserId: context.identity.effectiveUserId }, new Map([[context.keys.keyId, context.keys.encryptionKey]]))).content;
  if (decoded?.authority?.actorId !== context.identity.actorId || decoded?.authority?.effectiveUserId !== context.identity.effectiveUserId) throw new Error('QUERY_DENIED');
  const metadata = decoded?.metadata;
  // Control attempts/recovery/downloads remain audit events, not user questions.
  const isQuestion = metadata?.protocol === SEMANTIC_PROTOCOL_VERSION
    || ['initial_question_submission', 'initial_structured_submission'].includes(metadata?.relation);
  if (!isQuestion || metadata?.rejectedRetryOf) return null;
  const question = z.string().min(1).max(6000).parse(decoded.submittedText);
  const conversation = metadata?.protocol === SEMANTIC_PROTOCOL_VERSION ? queryConversationSchema.parse(metadata.conversation) : { id: requestId };
  return { question, conversation, semantic: metadata?.protocol === SEMANTIC_PROTOCOL_VERSION, plan: decoded.plan };
}

/** Lists need only original question/plan metadata; result numbers and sources
 * are never included until selected recovery has rechecked every source. */
async function readQuestionMetadata(context: Context, requestId: string) {
  const { data, error } = await context.client.rpc('ai_query_context_read', { p_actor: context.identity.actorId,
    p_effective: context.identity.effectiveUserId, p_session: context.identity.sessionId, p_request_id: requestId }).abortSignal(context.signal);
  context.signal.throwIfAborted();
  if (error) throw new Error('QUERY_HISTORY_UNAVAILABLE');
  if (data?.allowed !== true || data.permission_revision !== context.authority.permissionRevision) throw new Error('QUERY_DENIED');
  const events = z.array(eventSchema).min(1).max(16).parse(data.events);
  if (events.some(event => event.request_id !== requestId) || new Set(events.map(event => event.event_id)).size !== events.length) throw new Error('QUERY_HISTORY_UNAVAILABLE');
  const receipt = decodeReceipt(context, requestId, events[0]);
  if (!receipt) throw new Error('QUERY_HISTORY_UNAVAILABLE');
  let authorizedPlan = false;
  let plan = receipt.plan, clarification: SemanticClarification | undefined;
  if (receipt.semantic) {
    for (const event of events) {
      if (event.kind !== 'tool_finished' && event.kind !== 'denied') continue;
      const content = JSON.parse(decryptAuditContent(event.cipher, { requestId, eventId: event.event_id,
        actorId: context.identity.actorId, effectiveUserId: context.identity.effectiveUserId }, new Map([[context.keys.keyId, context.keys.encryptionKey]]))).content;
      if (content?.resolution?.protocol === SEMANTIC_PROTOCOL_VERSION) {
        if (content.plan) plan = content.plan;
        if (content.resolution.semanticContext) {
          const storedContext = parseSemanticContext(content.resolution.semanticContext);
          if (storedContext.lastPlan) { authorizeConversationPlan(storedContext.lastPlan, context.authority); authorizedPlan = true; }
          if (event.kind === 'denied') clarification = content.response?.reason === 'assistant_help'
            ? assistantHelpSchema.parse(content.response) : storedContext.pending?.clarification;
        }
      }
    }
  }
  if (plan && plan.resolution !== 'server_semantic/1') { authorizeConversationPlan(parseQueryPlan(plan), context.authority); authorizedPlan = true; }
  if (clarification) {
    const buildingIds = clarification.options.filter(option => option.id.startsWith('building:')).map(option => z.uuid().parse(option.id.slice(9)));
    if (buildingIds.length) {
      const checkPlan = parseQueryPlan({ operation: 'list', fields: [], period: null, scope: { inventory: 'all_authorized', buildingIds } });
      authorizeConversationPlan(checkPlan, context.authority);
      const visible = await readQuerySnapshots(context.client, context.identity, context.authority, checkPlan, context.signal);
      const allowedIds = new Set(visible.flatMap(snapshot => snapshot.rows.map(row => row.id)));
      if (buildingIds.some(id => !allowedIds.has(id))) throw new Error('QUERY_DENIED');
    }
  }
  return { ...receipt, plan, clarification, needsParentAuthorization: receipt.semantic && !authorizedPlan, state: z.string().parse(data.state) };
}

async function readQuestion(context: Context, requestId: string) {
  const receipt = await readQuestionMetadata(context, requestId);
  // Failed continuations have no executed plan. Their inherited question/title
  // must still honor the parent's scope rather than falling back to catalog-only
  // eligibility. Stop malformed/cyclic or excessively long failure chains.
  let current = receipt;
  const visited = new Set([requestId]);
  while (current.needsParentAuthorization && current.conversation.parentRequestId) {
    const parentId = current.conversation.parentRequestId;
    if (visited.has(parentId) || visited.size >= 10) throw new Error('QUERY_DENIED');
    visited.add(parentId);
    current = await readQuestionMetadata(context, parentId);
    if (current.conversation.id !== receipt.conversation.id) throw new Error('QUERY_DENIED');
  }
  return receipt;
}

/** Bound independent metadata reads to four concurrent RPCs. A page never
 * decrypts or loads full result snapshots until one turn is explicitly opened. */
async function readQuestionPage(context: Context, requestIds: string[]) {
  const unique = [...new Set(requestIds)];
  const results = new Map<string, PromiseSettledResult<Awaited<ReturnType<typeof readQuestion>>>>();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, async () => {
    while (next < unique.length) {
      const requestId = unique[next++];
      try { results.set(requestId, { status: 'fulfilled', value: await readQuestion(context, requestId) }); }
      catch (reason) { results.set(requestId, { status: 'rejected', reason }); }
    }
  }));
  context.signal.throwIfAborted();
  return (requestId: string) => {
    const result = results.get(requestId);
    if (!result) throw new Error('QUERY_HISTORY_UNAVAILABLE');
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  };
}

function titleFor(context: Context, thread: z.infer<typeof threadSchema>, fallback: string) {
  if (thread.actor_id !== context.identity.actorId || thread.effective_user_id !== context.identity.effectiveUserId) throw new Error('QUERY_DENIED');
  if (!thread.title_event_id || !thread.title_cipher) return fallback.slice(0, 120);
  const title = JSON.parse(decryptAuditContent(thread.title_cipher, { requestId: thread.conversation_id, eventId: thread.title_event_id,
    actorId: context.identity.actorId, effectiveUserId: context.identity.effectiveUserId }, new Map([[context.keys.keyId, context.keys.encryptionKey]])));
  return z.strictObject({ kind: z.literal('history-title/1'), title: z.string().min(1).max(120) }).parse(title).title;
}

/** A missing independently deployed migration cannot invalidate a valid answer.
 * The reply reports historySaved=false; the immutable audit snapshot still exists. */
export async function recordHistorySubmission(client: SupabaseClient, keys: AuditKeys, identity: VerifiedQueryIdentity,
  conversationId: string, requestId: string): Promise<boolean> {
  try {
    const signal = AbortSignal.timeout(5000), authority = await loadDataAuthority(client, identity, signal);
    await historyRpc({ client, keys, identity, authority, signal }, { action: 'record', conversationId, requestId });
    return true;
  } catch { return false; }
}

async function indexOlderQuestions(context: Context) {
  const page = await historyRpc(context, { action: 'candidates' });
  const candidates = z.array(z.object({ requestId: z.uuid(), event: z.unknown().nullable() })).max(25).parse(page.records);
  let unavailable = 0;
  const records = [];
  for (const candidate of candidates) {
    let receipt: ReturnType<typeof decodeReceipt> = null, unreadable = false;
    try { receipt = decodeReceipt(context, candidate.requestId, candidate.event); } catch { unavailable++; unreadable = true; }
    records.push({ requestId: candidate.requestId, conversationId: receipt?.conversation.id ?? null, unreadable });
  }
  if (records.length) await historyRpc(context, { action: 'index', records });
  return { indexing: page.hasMore === true, unavailable };
}

function cursorInput(context: Context, input: Extract<HistoryInput, { action: 'list' | 'open' }>) {
  if (!input.cursor) return {};
  const token = unsealHistoryToken(input.cursor, context.identity, context.authority.permissionRevision, 'history-page', context.keys);
  const binding = input.action === 'list' ? { action: 'list', search: normalize(input.search), archived: input.archived }
    : { action: 'open', conversationId: input.conversationId };
  if (JSON.stringify(token.binding) !== JSON.stringify(binding)) throw new Error('QUERY_DENIED');
  return beforeSchema.parse(token.before);
}
function nextCursor(context: Context, binding: Record<string, unknown>, before: { beforeTime: string; beforeId: string }) {
  return sealHistoryToken(context.identity, context.authority.permissionRevision, 'history-page', { binding, before }, context.keys);
}

export async function listOwnHistory(context: Context, input: Extract<HistoryInput, { action: 'list' }>): Promise<HistoryPage> {
  const indexed = await indexOlderQuestions(context);
  const before = cursorInput(context, input);
  const page = await historyRpc(context, { action: 'list', archived: input.archived, ...before });
  const records = z.array(threadSchema).max(15).parse(page.records), entries: HistoryEntry[] = [];
  const questionFor = await readQuestionPage(context, records.map(thread => thread.last_request_id));
  let unavailable = z.number().int().nonnegative().parse(page.unreadable ?? indexed.unavailable);
  for (const thread of records) {
    try {
      const receipt = questionFor(thread.last_request_id);
      const title = titleFor(context, thread, receipt.question);
      if (!normalize(`${title}\n${receipt.question}`).includes(normalize(input.search))) continue;
      entries.push({ conversationId: thread.conversation_id, title, latestQuestion: receipt.question.slice(0, 400),
        requestId: thread.last_request_id, updatedAt: thread.updated_at, archived: thread.archived });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'QUERY_DENIED') unavailable++;
      // Never return partially authorized titles or question text.
    }
  }
  const last = records.at(-1), hasMore = page.hasMore === true;
  return { entries, hasMore, indexing: indexed.indexing, unavailable,
    ...(hasMore && last ? { nextCursor: nextCursor(context, { action: 'list', search: normalize(input.search), archived: input.archived },
      { beforeTime: last.updated_at, beforeId: last.conversation_id }) } : {}) };
}

export async function openOwnHistory(context: Context, input: Extract<HistoryInput, { action: 'open' }>) {
  if (!input.conversationId) {
    const located = await historyRpc(context, { action: 'locate', requestId: input.requestId });
    input = { ...input, conversationId: z.uuid().parse(located.conversationId) };
  }
  const conversationId = input.conversationId!;
  const page = await historyRpc(context, { action: 'turns', conversationId: input.conversationId, requestId: input.requestId, ...cursorInput(context, input) });
  const thread = threadSchema.parse(page.thread);
  const rows = z.array(z.object({ request_id: z.uuid(), submitted_at: z.string(), state: z.string() })).min(1).max(10).parse(page.records);
  const requestId = input.requestId ?? rows[0].request_id;
  const questionFor = await readQuestionPage(context, [...rows.map(row => row.request_id), requestId]);
  const turns = [];
  for (const row of rows) {
    const receipt = questionFor(row.request_id);
    if (receipt.conversation.id !== input.conversationId) throw new Error('QUERY_DENIED');
    turns.push(historyTurnSchema.parse({ requestId: row.request_id, question: receipt.question, submittedAt: row.submitted_at, state: row.state }));
  }
  const question = questionFor(requestId);
  if (question.conversation.id !== input.conversationId) throw new Error('QUERY_DENIED');
  const record = await readOwnResult(context.client, context.identity, requestId, 'archive', context.signal);
  const restored = record.state === 'succeeded'
    ? await recoverOwnResult(context.client, context.identity, context.keys, requestId, record, context.signal, { reauthorizedHistory: true }) : null;
  const selectedRow = z.object({ request_id: z.literal(requestId), submitted_at: z.string() }).parse(page.selected);
  const submittedAt = selectedRow.submitted_at;
  const reply = { requestId, status: restored ? 'ready' : question.clarification ? 'clarification' : record.state,
    ...(restored ? { result: resultViewSchema.parse(restored.result) } : question.clarification ?? { message: '此轮未生成可恢复的结果，可重新发起查询。' }) };
  const last = rows.at(-1)!, hasMore = page.hasMore === true;
  const opened: HistoryOpened = { title: titleFor(context, thread, question.question), turns, selected: {
    requestId, question: question.question, submittedAt, state: record.state, reply },
    conversation: { id: conversationId, ...(restored && question.semantic ? { parentRequestId: requestId,
      resumeToken: sealHistoryToken(context.identity, context.authority.permissionRevision, 'history-resume',
        { conversationId: input.conversationId, requestId }, context.keys) } : {}) }, hasMore,
    ...(hasMore ? { nextCursor: nextCursor(context, { action: 'open', conversationId: input.conversationId },
      { beforeTime: last.submitted_at, beforeId: last.request_id }) } : {}) };
  return { opened, recheck: async () => {
    if (restored) await restored.recheck();
    if (question.clarification) await readQuestion(context, requestId);
    const final = await readOwnResult(context.client, context.identity, requestId, 'status', context.signal);
    if (final.permission_revision !== context.authority.permissionRevision) throw new Error('QUERY_DENIED');
    if (restored && (final.head_hash !== record.head_hash || final.head_sequence !== record.head_sequence)) throw new Error('QUERY_RESULT_CHANGED');
  } };
}

export async function changeOwnHistory(context: Context, input: Extract<HistoryInput, { action: 'rename' | 'archive' }>) {
  // Gate metadata changes through the same current plan/ownership path as reads.
  const page = await historyRpc(context, { action: 'turns', conversationId: input.conversationId });
  const thread = threadSchema.parse(page.thread);
  await readQuestion(context, thread.last_request_id);
  if (input.action === 'rename') {
    const titleEventId = randomUUID();
    const titleCipher = encryptAuditContent(JSON.stringify({ kind: 'history-title/1', title: redactSubmittedCredentials(input.title).text }),
      { requestId: input.conversationId, eventId: titleEventId, actorId: context.identity.actorId, effectiveUserId: context.identity.effectiveUserId },
      context.keys.keyId, context.keys.encryptionKey);
    await historyRpc(context, { action: 'rename', conversationId: input.conversationId, titleEventId, titleCipher });
  } else await historyRpc(context, input);
}

/** Re-execution is explicit and source-referenced. Relative questions and map
 * selections cannot silently be reinterpreted against the restored final turn. */
export async function prepareHistoryReplay(context: Context, sourceRequestId: string): Promise<Awaited<ReturnType<typeof prepareSemanticExecution>>> {
  const question = await readQuestion(context, sourceRequestId);
  const read = await readOwnResult(context.client, context.identity, sourceRequestId, 'archive', context.signal);
  if (read.state !== 'succeeded') throw new Error('QUERY_CONTEXT_UNAVAILABLE');
  const restored = await recoverOwnResult(context.client, context.identity, context.keys, sourceRequestId, read, context.signal, { reauthorizedHistory: true });
  const result = resultViewSchema.parse(restored.result);
  const plan = parseQueryPlan(result.parameters.executedPlan ?? question.plan);
  authorizeConversationPlan(plan, context.authority); await restored.recheck();
  const periods = planPeriods(plan).filter((period): period is Quarter => period !== null);
  const resolution: SemanticResolution = { kind: 'plan', plan,
    context: { version: 'colliers-semantic-context/1', lastPlan: plan, comparisonSubmarkets: plan.scope.submarkets?.slice(0, 8) ?? [] },
    interpretation: { version: 'colliers-semantic-planner/1', method: 'bounded_semantic_rules', resolvedQuestion: question.question,
      periodBasis: '按原查询已经执行的期间与条件重新读取授权数据；相对时间不重新平移。', periods,
      availableThrough: null, unavailablePeriods: [], inherited: ['原查询的明确项目身份、期间、指标、筛选条件及统计口径'], notices: [] },
    limitations: [] };
  const suggestions = buildSemanticSuggestions({ plan, availablePeriods: periods, authority: context.authority })
    .filter(value => { try { authorizeConversationPlan(value.plan, context.authority); return true; } catch { return false; } });
  const metadata = { protocol: SEMANTIC_PROTOCOL_VERSION,
    semanticContext: resolution.context, turn: 1, modelStatus: 'not_needed', suggestions,
    interpretation: resolution.interpretation, replayOf: sourceRequestId };
  return { resolution, availability: undefined, suggestions, metadata };
}
