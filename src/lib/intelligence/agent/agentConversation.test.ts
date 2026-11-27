import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptAuditContent } from '../query/auditCrypto';
import { buildListResult, buildRankResult } from '../query/result';
import { parseQueryPlan } from '../query/plan';
import { fixture } from '../query/__tests__/fixtures';
import { sealHistoryToken } from '../query/historyToken';
const stubs = vi.hoisted(() => ({ read: vi.fn(), recover: vi.fn(), load: vi.fn() }));
vi.mock('../query/recovery', () => ({ readOwnResult: stubs.read, recoverOwnResult: stubs.recover }));
vi.mock('../query/serverAuthority', async original => ({
  ...(await original<typeof import('../query/serverAuthority')>()),
  loadDataAuthority: stubs.load,
}));
import type { AuditKeys } from '../query/auditStore';
import type { DataAuthority, VerifiedQueryIdentity } from '../query/serverAuthority';
import { readReportHistory } from './reportHistory';
import { readAgentHistory, restoreOwnAgentAnswer, trimAgentHistory, AGENT_CONVERSATION_PROTOCOL } from './agentConversation';

const identity: VerifiedQueryIdentity = {
  actorId: randomUUID(), effectiveUserId: randomUUID(), sessionId: randomUUID(),
  expiresAt: Date.now() + 3600000,
};
const keys: AuditKeys = { keyId: 'test-key', encryptionKey: new Uint8Array(32).fill(7),
  digestKey: new Uint8Array(32).fill(8) };
const authority: DataAuthority = {
  actorId: identity.actorId, effectiveUserId: identity.effectiveUserId, sessionId: identity.sessionId,
  sessionActive: true, policyVersion: 'test', permissionRevision: 'a'.repeat(64),
  grants: ['query:catalog'], fields: [], allSubmarkets: false, submarkets: [],
  allBuildings: false, buildingIds: [],
};

function event(requestId: string, kind: string, content: unknown, sequence: number) {
  const eventId = randomUUID();
  return { request_id: requestId, event_id: eventId, sequence, kind,
    cipher: encryptAuditContent(JSON.stringify({ content, redactionTypes: [] }), { requestId, eventId,
      actorId: identity.actorId, effectiveUserId: identity.effectiveUserId },
    keys.keyId, keys.encryptionKey) };
}

describe('owner-bound Agent multi-turn context from existing encrypted audit RPC', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it('retains at most eight recent turns without admitting raw credentials', () => {
    let turns: ReturnType<typeof trimAgentHistory> = [];
    for (let index = 0; index < 12; index++) turns = trimAgentHistory(turns, `第${index}轮`, `回答${index}`);
    expect(turns).toHaveLength(8);
    expect(turns[0].user).toContain('第4轮');
    expect(turns.at(-1)?.user).toContain('第11轮');
  });
  it('redacts recognizable credentials before any history is sent to a future model call', () => {
    const secret = 'sk-abcdefghijklmnopqrstuv123456';
    const history = trimAgentHistory([], '我的 API key: ' + secret, '请不要复述 ' + secret);
    expect(JSON.stringify(history)).not.toContain(secret);
    expect(history[0].user).toContain('已脱敏');
    expect(history[0].assistant).toContain('已脱敏');
  });

  it('recovers only authenticated agent answer events visible through the production RPC contract', async () => {
    const requestId = randomUUID(), conversationId = randomUUID();
    const history = [{ user: 'CBD最近净有效租金多少？', assistant: '已查询CBD最新有效季度。' }];
    const events = [
      event(requestId, 'received', { sessionId: identity.sessionId,
        authority: { actorId: identity.actorId, effectiveUserId: identity.effectiveUserId },
        metadata: { protocol: AGENT_CONVERSATION_PROTOCOL, conversation: { id: conversationId } } }, 1),
      event(requestId, 'running', { phase: 'agent_planning' }, 2),
      event(requestId, 'tool_finished', { protocol: 'agent-answer/1',
        permissionRevision: authority.permissionRevision, history }, 3),
    ];
    const rpc = vi.fn().mockReturnValue({
      abortSignal: vi.fn().mockResolvedValue({ data: { allowed: true,
        permission_revision: authority.permissionRevision, state: 'succeeded', events }, error: null }),
    });
    const client = { rpc } as unknown as SupabaseClient;
    const recovered = await readAgentHistory(client, identity, keys, authority,
      { id: conversationId, parentRequestId: requestId }, new AbortController().signal);
    expect(recovered).toEqual(history);
    expect(rpc).toHaveBeenCalledWith('ai_query_context_read', expect.objectContaining({
      p_actor: identity.actorId, p_effective: identity.effectiveUserId, p_session: identity.sessionId,
      p_request_id: requestId,
    }));
  });

  it('rejects a revoked permission revision, never trusting browser-supplied history', async () => {
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({
      data: { allowed: true, permission_revision: 'b'.repeat(64) }, error: null,
    }) });
    await expect(readAgentHistory({ rpc } as unknown as SupabaseClient, identity, keys, authority,
      { id: randomUUID(), parentRequestId: randomUUID() }, new AbortController().signal))
      .rejects.toThrow('AGENT_CONTEXT_UNAVAILABLE');
  });


  it('reopens an original audited natural-language answer without duplicating or fabricating data', async () => {
    const requestId = randomUUID(), conversationId = randomUUID(), plainText = '你好，我可以帮你查询北京办公楼。';
    const turn = { user: '你好', assistant: plainText };
    stubs.read.mockResolvedValueOnce({ state: 'succeeded', permission_revision: authority.permissionRevision,
      head_hash: 'f'.repeat(64), head_sequence: 3, events: [
        event(requestId, 'received', { sessionId: randomUUID(),
          authority: { actorId: identity.actorId, effectiveUserId: identity.effectiveUserId },
          metadata: { protocol: AGENT_CONVERSATION_PROTOCOL, conversation: { id: conversationId } } }, 1),
        event(requestId, 'tool_finished', { protocol: 'agent-answer/1',
          permissionRevision: authority.permissionRevision, history: [turn] }, 2),
        event(requestId, 'response_generated', { result: { version: 'agent-message/1',
          text: plainText, model: 'deepseek-flash' } }, 3),
      ] });
    stubs.load.mockResolvedValueOnce(authority);
    const restored = await restoreOwnAgentAnswer({} as SupabaseClient, identity, keys, authority,
      conversationId, requestId, new AbortController().signal);
    expect(restored.message).toBe(plainText);
    expect(restored.result).toBeUndefined();
    expect(stubs.recover).not.toHaveBeenCalled();
  });

  it('rejects altered archived AI text and never returns a forged message', async () => {
    const requestId = randomUUID(), conversationId = randomUUID();
    stubs.read.mockResolvedValueOnce({ state: 'succeeded', permission_revision: authority.permissionRevision,
      head_hash: 'f'.repeat(64), head_sequence: 3, events: [
        event(requestId, 'received', { authority: { actorId: identity.actorId, effectiveUserId: identity.effectiveUserId },
          metadata: { protocol: AGENT_CONVERSATION_PROTOCOL, conversation: { id: conversationId } } }, 1),
        event(requestId, 'tool_finished', { protocol: 'agent-answer/1',
          permissionRevision: authority.permissionRevision, history: [{ user: '您好', assistant: '真实回答' }] }, 2),
        event(requestId, 'response_generated', { result: { version: 'agent-message/1',
          text: '伪造回答' } }, 3),
      ] });
    await expect(restoreOwnAgentAnswer({} as SupabaseClient, identity, keys, authority,
      conversationId, requestId, new AbortController().signal)).rejects.toThrow('QUERY_HISTORY_UNAVAILABLE');
  });

  it('continues a sealed previous-session turn only after rechecking the archived owner and sources', async () => {
    const requestId = randomUUID(), conversationId = randomUUID();
    const history = [{ user: 'CBD空置率？', assistant: '基于当前授权数据，CBD已有季度指标。' }];
    const events = [
      event(requestId, 'received', { sessionId: randomUUID(),
        authority: { actorId: identity.actorId, effectiveUserId: identity.effectiveUserId },
        metadata: { protocol: AGENT_CONVERSATION_PROTOCOL, conversation: { id: conversationId } } }, 1),
      event(requestId, 'tool_finished', { protocol: 'agent-answer/1',
        permissionRevision: authority.permissionRevision, history }, 2),
      event(requestId, 'response_generated', { result: { version: 'agent-message/1',
        text: history[0].assistant } }, 3),
    ];
    stubs.read.mockResolvedValueOnce({ state: 'succeeded', permission_revision: authority.permissionRevision,
      head_hash: 'f'.repeat(64), head_sequence: 3, events });
    stubs.load.mockResolvedValueOnce(authority);
    const client = { rpc: vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({
      data: { allowed: true, permission_revision: authority.permissionRevision, state: 'succeeded', events }, error: null,
    }) }) } as unknown as SupabaseClient;
    const resumeToken = sealHistoryToken(identity, authority.permissionRevision, 'history-resume',
      { requestId, conversationId }, keys);
    const restored = await readAgentHistory(client, identity, keys, authority,
      { id: conversationId, parentRequestId: requestId, resumeToken }, new AbortController().signal);
    expect(restored).toEqual(history);
    expect(stubs.read).toHaveBeenCalledOnce();
  });

  it('rejects unsafe history restore tokens as a permission denial without calling the RPC', async () => {
    const rpc = vi.fn();
    await expect(readAgentHistory({ rpc } as unknown as SupabaseClient, identity, keys, authority,
      { id: randomUUID(), parentRequestId: randomUUID(), resumeToken: 'unverified' },
      new AbortController().signal)).rejects.toThrow('QUERY_DENIED');
    expect(rpc).not.toHaveBeenCalled();
  });
});



it('imports a chart snapshot only after owner/session/encrypted context and live source recovery checks', async () => {
  const requestId = randomUUID(), conversationId = randomUUID(), result = buildListResult(fixture(), ['height']);
  const chart = { kind: 'plot', type: 'horizontal_bar', x: 'name', y: ['height'] };
  const history = [{ user: '创建高度图表', assistant: '已生成同源图表。' }];
  const events = [
    event(requestId, 'received', { sessionId: identity.sessionId,
      authority: { actorId: identity.actorId, effectiveUserId: identity.effectiveUserId }, metadata: { protocol: AGENT_CONVERSATION_PROTOCOL, conversation: { id: conversationId } } }, 1),
    event(requestId, 'tool_finished', { protocol: 'agent-answer/1', permissionRevision: authority.permissionRevision,
      history, chartContext: { resultId: result.resultId, chart } }, 2),
    event(requestId, 'response_generated', { result }, 3),
  ];
  const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { allowed: true, permission_revision: authority.permissionRevision, state: 'succeeded', events }, error: null }) });
  const read = { state: 'succeeded', permission_revision: authority.permissionRevision, head_hash: 'f'.repeat(64), head_sequence: 3, events };
  stubs.read.mockResolvedValue(read);
  const recheck = vi.fn().mockResolvedValue(undefined); stubs.recover.mockResolvedValue({ result, recheck });
  const restored = await readAgentHistory({ rpc } as unknown as SupabaseClient, identity, keys, authority, { id: conversationId, parentRequestId: requestId }, new AbortController().signal);
  expect(restored.contextResult).toEqual(result); expect(restored.contextChart).toEqual({ resultId: result.resultId, chart });
  expect(recheck).toHaveBeenCalled(); expect(stubs.recover).toHaveBeenCalled();
  recheck.mockRejectedValue(new Error('QUERY_DENIED'));
  await expect(readAgentHistory({ rpc } as unknown as SupabaseClient, identity, keys, authority, { id: conversationId, parentRequestId: requestId }, new AbortController().signal)).rejects.toThrow('QUERY_DENIED');
});

it.each([[false, false], [true, false], [true, true]])('restores combined answer and chart contexts once with shared immutable snapshots (resume=%s, companion=%s)', async (resume, companion) => {
  const requestId = randomUUID(), conversationId = randomUUID(), result = buildListResult(fixture(), ['height']);
  const chart = { kind: 'plot', type: 'horizontal_bar', x: 'name', y: ['height'] };
  const chartResult = companion ? buildListResult(fixture(), ['height']) : result;
  const history = [{ user: '创建高度图表', assistant: '已生成同源图表。' }];
  const selection = { version: 'answer-selection/1', task: 'list', status: 'answered', primaryResultId: result.resultId,
    results: [{ role: 'primary', result }, ...(companion ? [{ role: 'comparison', result: chartResult }] : [])] };
  const events = [
    event(requestId, 'received', { sessionId: resume ? randomUUID() : identity.sessionId,
      authority: { actorId: identity.actorId, effectiveUserId: identity.effectiveUserId }, metadata: { protocol: AGENT_CONVERSATION_PROTOCOL, conversation: { id: conversationId } } }, 1),
    event(requestId, 'tool_finished', { protocol: 'agent-answer/1', permissionRevision: authority.permissionRevision,
      history, answerContext: true, chartContext: { resultId: chartResult.resultId, chart } }, 2),
    event(requestId, 'response_generated', { result: selection }, 3),
  ];
  const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { allowed: true,
    permission_revision: authority.permissionRevision, state: 'succeeded', events }, error: null }) });
  stubs.read.mockClear().mockResolvedValue({ state: 'succeeded', permission_revision: authority.permissionRevision, head_hash: 'f'.repeat(64), head_sequence: 3, events });
  const recheck = vi.fn().mockResolvedValue(undefined);
  stubs.recover.mockClear().mockImplementation(async () => {
    // Real decryption creates a distinct graph on every recovery call.
    const answerSelection = structuredClone(selection);
    return { result: answerSelection.results[0].result, answerSelection, recheck };
  });
  const client = { rpc } as unknown as SupabaseClient;
  const conversation = { id: conversationId, parentRequestId: requestId,
    ...(resume ? { resumeToken: sealHistoryToken(identity, authority.permissionRevision, 'history-resume', { requestId, conversationId }, keys) } : {}) };
  const restored = await readAgentHistory(client, identity, keys, authority, conversation, new AbortController().signal);
  expect(restored.contextResult).toBe(restored.contextResults?.[0]);
  expect(restored.contextChart).toEqual({ resultId: chartResult.resultId, chart });
  expect(stubs.read).toHaveBeenCalledOnce(); expect(stubs.recover).toHaveBeenCalledOnce();
  expect(recheck).toHaveBeenCalledOnce();
  recheck.mockRejectedValue(new Error('QUERY_DENIED'));
  await expect(restored.contextRecheck?.()).rejects.toThrow('QUERY_DENIED');
});

it('imports multiple completed snapshots only along this conversation encrypted parent chain and rechecks every source', async () => {
  const conversationId = randomUUID(), requestIds = [randomUUID(), randomUUID()];
  const results = [buildListResult(fixture(), ['height']), buildListResult(fixture(), ['totalArea'])];
  const records = requestIds.map((requestId, i) => ({ state: 'succeeded', permission_revision: authority.permissionRevision,
    head_hash: 'f'.repeat(64), head_sequence: 3, events: [
      event(requestId, 'received', { sessionId: identity.sessionId, authority: { actorId: identity.actorId, effectiveUserId: identity.effectiveUserId },
        metadata: { protocol: AGENT_CONVERSATION_PROTOCOL, conversation: { id: conversationId, ...(i ? { parentRequestId: requestIds[i - 1] } : {}) } } }, 1),
      event(requestId, 'tool_finished', { protocol: 'agent-answer/1', permissionRevision: authority.permissionRevision, history: [{ user: '查询', assistant: '完成' }] }, 2),
      event(requestId, 'response_generated', { result: results[i] }, 3),
    ] }));
  stubs.read.mockImplementation((_c, _i, requestId) => Promise.resolve(records[requestIds.indexOf(requestId)]));
  const checks = [vi.fn().mockResolvedValue(undefined), vi.fn().mockResolvedValue(undefined)];
  stubs.recover.mockImplementation((_c, _i, _k, requestId) => Promise.resolve({ result: results[requestIds.indexOf(requestId)], recheck: checks[requestIds.indexOf(requestId)] }));
  const client = {} as SupabaseClient, signal = new AbortController().signal;
  const history = await readReportHistory(client, identity, keys, authority, { id: conversationId, parentRequestId: requestIds[1] }, signal);
  expect(history.results).toEqual(results); expect(history.limited).toBe(false);
  await history.recheck(); expect(checks.every(check => check.mock.calls.length >= 2)).toBe(true);
  checks[0].mockRejectedValue(new Error('QUERY_DENIED'));
  await expect(history.recheck()).rejects.toThrow('QUERY_DENIED');
  await expect(readReportHistory(client, identity, keys, authority, { id: randomUUID(), parentRequestId: requestIds[1] }, signal)).rejects.toThrow('QUERY_DENIED');
});


it('reopens two comparable markets only within the authenticated chain and rechecks both original results', async () => {
  const conversationId = randomUUID();
  const requestIds = [randomUUID(), randomUUID()];
  const plans = ['CBD', '金融街'].map(submarket => parseQueryPlan({ operation: 'rank', period: null, field: 'height',
    limit: 2, direction: 'desc', scope: { inventory: 'all_authorized', submarkets: [submarket] } }));
  const results = plans.map(plan => {
    const raw = buildRankResult(fixture(), 'height', 2, 'desc');
    return { ...raw, parameters: { ...raw.parameters, executedPlan: plan } };
  });
  const scoped: DataAuthority = { ...authority, grants: ['query:catalog', 'query:brochure'], fields: ['height'], allSubmarkets: true, allBuildings: true };
  const records = requestIds.map((requestId, index) => ({ state: 'succeeded', allowed: true,
    permission_revision: authority.permissionRevision, head_hash: 'f'.repeat(64), head_sequence: 3, events: [
      event(requestId, 'received', { sessionId: identity.sessionId,
        authority: { actorId: identity.actorId, effectiveUserId: identity.effectiveUserId }, metadata: {
          protocol: AGENT_CONVERSATION_PROTOCOL, conversation: { id: conversationId, parentRequestId: requestIds[index - 1] },
        } }, 1),
      event(requestId, 'tool_finished', { protocol: 'agent-answer/1', permissionRevision: authority.permissionRevision,
        history: [{ user: '查询高度排名', assistant: '已查询' }], plan: plans[index], answerContext: true }, 2),
      event(requestId, 'response_generated', { result: results[index] }, 3),
    ] }));
  const checks = [vi.fn().mockResolvedValue(undefined), vi.fn().mockResolvedValue(undefined)];
  stubs.read.mockClear().mockImplementation(async (_c, _i, id) => records[requestIds.indexOf(id)]);
  stubs.recover.mockImplementation(async (_c, _i, _k, id) => {
    const index = requestIds.indexOf(id);
    return { result: results[index], recheck: checks[index] };
  });
  const client = { rpc: () => ({ abortSignal: async () => ({ data: records[1], error: null }) }) } as unknown as SupabaseClient;
  const conversation = { id: conversationId, parentRequestId: requestIds[1] };
  const signal = new AbortController().signal;
  const normal = await readAgentHistory(client, identity, keys, scoped, conversation, signal);
  expect(normal.contextComparisonIds).toBeUndefined();
  expect(stubs.read).toHaveBeenCalledOnce();
  const comparison = await readAgentHistory(client, identity, keys, scoped, conversation, signal, true);
  expect(comparison.contextResults).toEqual(results);
  expect(comparison.contextComparisonIds).toEqual(results.map(result => result.resultId));
  checks[0].mockRejectedValue(new Error('QUERY_DENIED'));
  await expect(comparison.contextRecheck?.()).rejects.toThrow('QUERY_DENIED');
});
