import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const state = vi.hoisted(() => ({
  receive: vi.fn(), append: vi.fn(), provider: vi.fn(), tool: vi.fn(),
  identity: vi.fn(), authority: vi.fn(), intake: vi.fn(), history: vi.fn(),
}));

vi.mock('../query/serverAuthority', () => ({
  verifyQueryIdentity: state.identity, loadDataAuthority: state.authority,
}));
vi.mock('../query/auditStore', async original => ({
  ...(await original<typeof import('../query/auditStore')>()),
  createRpcAuditPort: () => ({ receive: state.receive, append: state.append }),
}));
vi.mock('../query/intake', () => ({ recordQueryIntake: state.intake }));
vi.mock('./modelProvider', async original => ({
  ...(await original<typeof import('./modelProvider')>()),
  completeWithDeepSeek: state.provider,
}));
vi.mock('./verifiedDataTool', () => ({ queryVerifiedRealEstate: state.tool }));
vi.mock('./agentConversation', async original => ({
  ...(await original<typeof import('./agentConversation')>()),
  readAgentHistory: state.history,
}));

import { handleAgentSubmission } from './agentHttp';

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const keys = { keyId: 'isolated-agent', encryptionKey: new Uint8Array(32).fill(10),
  digestKey: new Uint8Array(32).fill(11) };
const authority = {
  actorId, effectiveUserId: actorId, sessionId, sessionActive: true, policyVersion: 'test',
  permissionRevision: 'b'.repeat(64), grants: ['query:catalog'],
  fields: [], allSubmarkets: false, submarkets: [], allBuildings: false, buildingIds: [],
};

function fakeRequest(question = '你好') {
  const conversation = { id: randomUUID() };
  const input = { idempotencyKey: randomUUID(), question, conversation };
  return { input, request: new Request('https://www.colliersdata.com/api/intelligence/query/agent', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer isolated-test-only' },
    body: JSON.stringify(input),
  }) };
}
function deps(allowed = true) {
  const rpc = vi.fn((name: string) => {
    expect(name).toBe('ai_query_model_budget');
    return { abortSignal: () => Promise.resolve({ data: { allowed }, error: null }) };
  });
  return { client: { rpc } as unknown as SupabaseClient, keys, enabled: true };
}

beforeEach(() => {
  vi.resetAllMocks();
  state.identity.mockResolvedValue({ actorId, effectiveUserId: actorId, sessionId, expiresAt: Date.now() + 60000 });
  state.authority.mockResolvedValue(authority);
  state.receive.mockResolvedValue({ replayed: false });
  state.append.mockResolvedValue(undefined);
  state.intake.mockResolvedValue(undefined);
  state.history.mockResolvedValue([]);
  state.provider.mockResolvedValue({ model: 'deepseek-v4-flash', inputTokens: 12, outputTokens: 18,
    message: { role: 'assistant', content: '你好，我可以帮你分析北京办公楼市场。' } });
});

describe('AI 4.0 authenticated route with model and auditable delivery', () => {
  it('answers through provider after budget and audited admission', async () => {
    const { request, input } = fakeRequest();
    const response = await handleAgentSubmission(request, deps());
    const output = await response.json();
    expect(response.status).toBe(200);
    expect(output.status).toBe('assistant');
    expect(output.message).toContain('你好');
    expect(output.conversation).toEqual(input.conversation);
    expect(output.agent).toMatchObject({ model: 'deepseek-v4-flash', modelCalls: 1, toolCalls: 0, inputTokens: 12, outputTokens: 18 });
    expect(state.provider).toHaveBeenCalledOnce();
    expect(state.provider.mock.calls[0][0].at(-1)).toMatchObject({ role: 'user', content: '你好' });
    expect(state.receive).toHaveBeenCalledOnce();
    expect(state.append.mock.calls.map(x => x[1])).toContain('succeeded');
    expect(state.append.mock.calls.map(x => x[1])).toContain('accounting');
    expect(response.headers.get('x-query-delivery-token')).toMatch(/\./);
  });

  it('executes a native tool request and uses the returned tool fact for subsequent model synthesis', async () => {
    state.provider.mockReset()
      .mockResolvedValueOnce({ model: 'deepseek-v4-flash', inputTokens: 30, outputTokens: 15,
        message: { role: 'assistant', content: null, tool_calls: [{
          id: 'tool-1', type: 'function',
          function: { name: 'query_verified_real_estate', arguments: JSON.stringify({ question: '查询CBD净有效租金' }) },
        }] } })
      .mockResolvedValueOnce({ model: 'deepseek-v4-flash', inputTokens: 36, outputTokens: 22,
        message: { role: 'assistant', content: '根据已授权的结果，CBD需要指定有效季度。' } });
    state.tool.mockResolvedValue({ content: '{"status":"requires_clarification","message":"需要季度"}' });
    const { request } = fakeRequest('帮我查询CBD');
    const response = await handleAgentSubmission(request, deps());
    const output = await response.json();
    expect(response.status).toBe(200);
    expect(output.agent.modelCalls).toBe(2);
    expect(output.agent.toolCalls).toBe(1);
    expect(state.tool).toHaveBeenCalledOnce();
    expect(state.provider).toHaveBeenCalledTimes(2);
    expect(state.provider.mock.calls[1][0].some((m: { role: string; tool_call_id?: string }) =>
      m.role === 'tool' && m.tool_call_id === 'tool-1')).toBe(true);
  });

  it('denies unauthenticated access without model or tool execution', async () => {
    state.identity.mockRejectedValue(new Error('QUERY_UNAUTHENTICATED'));
    const { request } = fakeRequest();
    const response = await handleAgentSubmission(request, deps());
    expect(response.status).toBe(401);
    expect(state.intake).toHaveBeenCalledOnce();
    expect(state.receive).not.toHaveBeenCalled();
    expect(state.provider).not.toHaveBeenCalled();
    expect(state.tool).not.toHaveBeenCalled();
  });

  it('never replays a provider call when the idempotency key was received', async () => {
    state.receive.mockResolvedValue({ replayed: true });
    const { request } = fakeRequest();
    const response = await handleAgentSubmission(request, deps());
    expect(response.status).toBe(202);
    expect((await response.json()).status).toBe('already_received');
    expect(state.provider).not.toHaveBeenCalled();
  });

  it('budget denial is distinct from a completed model response', async () => {
    const { request } = fakeRequest();
    const response = await handleAgentSubmission(request, deps(false));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('预算校验未通过');
    expect(state.provider).not.toHaveBeenCalled();
    expect(state.append.mock.calls.map(x => x[1])).toContain('failed');
  });
});

