import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildTrendResult, buildListResult } from '../query/result';
import { fixture } from '../query/__tests__/fixtures';
import { parseQueryPlan } from '../query/plan';

const state = vi.hoisted(() => ({
  receive: vi.fn(), append: vi.fn(), provider: vi.fn(), tool: vi.fn(), structured: vi.fn(),
  identity: vi.fn(), authority: vi.fn(), intake: vi.fn(), history: vi.fn(), save: vi.fn(),
}));

vi.mock('../query/serverAuthority', () => ({
  verifyQueryIdentity: state.identity, loadDataAuthority: state.authority,
}));
vi.mock('../query/auditStore', async original => ({
  ...(await original<typeof import('../query/auditStore')>()),
  createRpcAuditPort: () => ({ receive: state.receive, append: state.append }),
}));
vi.mock('../query/intake', () => ({ recordQueryIntake: state.intake }));
vi.mock('../query/historyStore', () => ({ recordHistorySubmission: state.save }));
vi.mock('./modelProvider', async original => ({
  ...(await original<typeof import('./modelProvider')>()),
  completeWithDeepSeek: state.provider,
}));
vi.mock('./verifiedDataTool', () => ({ queryVerifiedRealEstate: state.tool, executeStructuredDataTool: state.structured }));
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
  state.save.mockResolvedValue(true);
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
    expect(output.historySaved).toBe(true);
    expect(state.save).toHaveBeenCalledWith(expect.anything(), keys, expect.anything(), input.conversation.id, output.requestId);
    expect(state.receive).toHaveBeenCalledOnce();
    expect(state.append.mock.calls.map(x => x[1])).toContain('succeeded');
    expect(state.append.mock.calls.map(x => x[1])).toContain('accounting');
    expect(state.append.mock.calls.find(x => x[1] === 'accounting')?.[2]).toMatchObject({
      cost: null, costStatus: 'planning_range_not_invoice', durationMs: expect.any(Number),
      costEstimate: { minUsd: expect.any(Number), maxUsd: expect.any(Number) },
    });
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
    expect(state.append.mock.calls.some(x => x[1] === 'tool_finished'
      && x[2]?.protocol === 'agent-answer/1'
      && x[2]?.toolTrace.some((step: { name: string }) => step.name === 'query_verified_real_estate'))).toBe(true);
    expect(state.provider).toHaveBeenCalledTimes(2);
    expect(state.provider.mock.calls[1][0].some((m: { role: string; tool_call_id?: string }) =>
      m.role === 'tool' && m.tool_call_id === 'tool-1')).toBe(true);
  });

  it('uses one authorized data tool before source-bound presentation tools in the same native Agent run', async () => {
    const start = { year: 2026, quarter: 1 }, end = { year: 2026, quarter: 2 };
    const raw = buildTrendResult([fixture(start), fixture(end)], 'rent', 'per_period');
    const verified = { ...raw, parameters: { ...raw.parameters,
      executedPlan: parseQueryPlan({ operation: 'trend', metric: 'rent', start, end,
        mode: 'per_period', scope: { inventory: 'tracked', submarkets: ['CBD'] } }) } };
    state.tool.mockResolvedValue({ content: '{"status":"ready","registeredSources":12}', result: verified });
    const toolCall = (id: string, name: string, question: string) => ({
      id, type: 'function', function: { name, arguments: JSON.stringify({ question }) },
    });
    state.provider.mockReset()
      .mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 25, outputTokens: 8,
        message: { role: 'assistant', content: null,
          tool_calls: [toolCall('data-1', 'query_verified_real_estate', 'CBD 2026Q1至Q2净有效租金趋势')] } })
      .mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 37, outputTokens: 15,
        message: { role: 'assistant', content: null,
          tool_calls: [toolCall('chart-1', 'prepare_chart', '根据刚才授权趋势生成带来源图表')] } })
      .mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 80, outputTokens: 45,
        message: { role: 'assistant', content: '已按获权季度净有效租金结果生成可信趋势图的规格。' } });
    const { request } = fakeRequest('分析 CBD 两季度租金并给出图表');
    const response = await handleAgentSubmission(request, deps());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('ready');
    expect(result.agent.toolCalls).toBe(2);
    expect(state.tool).toHaveBeenCalledTimes(1);
    const toolMessages = state.provider.mock.calls[2][0].filter((m: { role: string }) => m.role === 'tool');
    const presented = JSON.parse(toolMessages.at(-1)?.content ?? '{}');
    expect(presented.status).toBe('ready');
    expect(presented.chartKind).toBe('line');
    expect(presented.points.some((point: { sourceIds: string[] }) => point.sourceIds.length > 0)).toBe(true);
  });

  it('answers normally when optional history migration is absent', async () => {
    state.save.mockResolvedValue(false);
    const { request } = fakeRequest();
    const response = await handleAgentSubmission(request, deps());
    expect(response.status).toBe(200);
    expect((await response.json()).historySaved).toBe(false);
    expect(state.append.mock.calls.map(x => x[1])).toContain('succeeded');
  });

  it('batches native streaming deltas while rechecking current authority before each visible batch', async () => {
    const text = '增'.repeat(250), observed: Array<{ type: string; delta?: string }> = [];
    state.provider.mockImplementation(async (_messages: unknown, _signal: AbortSignal,
      onDelta: ((value: string) => Promise<void>) | undefined) => {
      for (const char of text) await onDelta?.(char);
      return { model: 'deepseek-flash', inputTokens: 120, outputTokens: 260,
        message: { role: 'assistant', content: text } };
    });
    const { request } = fakeRequest('概括市场');
    const response = await handleAgentSubmission(request, deps(), async event => {
      observed.push(event);
    });
    expect(response.status).toBe(200);
    expect(observed.filter(event => event.type === 'message_delta').map(event => event.delta).join('')).toBe(text);
    expect(state.authority.mock.calls.length).toBeLessThan(30);
    expect(observed.filter(event => event.type === 'run_started')).toHaveLength(1);
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
  it('routes structured tool calls through authorized executor and paginates an earlier result by its genuine ID', async () => {
    const rawA = buildListResult(fixture(), ['height']);
    const rawB = buildListResult(fixture(), ['height']);
    const planA = parseQueryPlan({ operation: 'list', scope: { inventory: 'tracked', submarkets: ['CBD'] },
      fields: ['height'], period: null });
    const planB = parseQueryPlan({ operation: 'list', scope: { inventory: 'tracked', submarkets: ['金融街'] },
      fields: ['height'], period: null });
    const a = { ...rawA, parameters: { ...rawA.parameters, executedPlan: planA } };
    const b = { ...rawB, parameters: { ...rawB.parameters, executedPlan: planB } };
    const call = (id: string, name: string, args: object) => ({ id, type: 'function' as const,
      function: { name, arguments: JSON.stringify(args) } });
    state.provider.mockReset()
      .mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 15, outputTokens: 20,
        message: { role: 'assistant', content: null,
          tool_calls: [call('a', 'search_buildings', { scope: { inventory: 'tracked', submarkets: ['CBD'] } })] } })
      .mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 20, outputTokens: 20,
        message: { role: 'assistant', content: null,
          tool_calls: [call('b', 'search_buildings', { scope: { inventory: 'tracked', submarkets: ['金融街'] } })] } })
      .mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 25, outputTokens: 20,
        message: { role: 'assistant', content: null,
          tool_calls: [call('page', 'read_result_page', { resultId: a.resultId, offset: 1, limit: 2 })] } })
      .mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 20, outputTokens: 25,
        message: { role: 'assistant', content: '已分别核验CBD及金融街楼宇目录，结果按授权样本列示。' } });
    state.structured
      .mockResolvedValueOnce({ content: JSON.stringify({ status: 'ready', rowCount: a.table.rows.length }), result: a })
      .mockResolvedValueOnce({ content: JSON.stringify({ status: 'ready', rowCount: b.table.rows.length }), result: b });
    const { request } = fakeRequest('列出两个子市场并读取CBD第二页');
    const response = await handleAgentSubmission(request, deps());
    const output = await response.json();
    expect(response.status).toBe(200);
    expect(output.result.resultId).toBe(b.resultId);
    expect(output.agent.toolCalls).toBe(3);
    expect(output.agent.executionStatus).toBe('completed');
    expect(output.agent.workset).toHaveLength(2);
    expect(output.agent.workset.map((item: { resultId: string }) => item.resultId))
      .toEqual([a.resultId, b.resultId]);
    expect(state.structured).toHaveBeenCalledTimes(2);
    expect(state.structured.mock.calls.map((entry: unknown[]) => entry[1])).toEqual(['search_buildings', 'search_buildings']);
    const page = JSON.parse(state.provider.mock.calls[3][0].at(-1).content);
    expect(page.status).toBe('ready');
    expect(page.resultId).toBe(a.resultId);
    expect(page.totalMatched).toBe(a.table.rows.length);
    expect(page.rows).toHaveLength(2);
    expect(output.agent.phases).toContain('verification');
    const saved = state.append.mock.calls.find(entry => entry[1] === 'tool_finished'
      && entry[2]?.protocol === 'agent-answer/1')?.[2];
    expect(saved.workset).toHaveLength(2);
    expect(saved.toolTrace).toHaveLength(3);
  });

  it('fails authorization after a first result instead of reading the workset after revocation', async () => {
    const raw = buildListResult(fixture(), ['height']);
    const a = { ...raw, parameters: { ...raw.parameters, executedPlan: parseQueryPlan({
      operation: 'list', fields: ['height'], period: null,
      scope: { inventory: 'tracked', submarkets: ['CBD'] },
    }) } };
    const call = (id: string, name: string, args: object) => ({ id, type: 'function' as const,
      function: { name, arguments: JSON.stringify(args) } });
    state.structured.mockResolvedValue({ content: '{"status":"ready"}', result: a });
    state.provider.mockReset()
      .mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 12,
        message: { role: 'assistant', content: null,
          tool_calls: [call('list', 'search_buildings',
            { scope: { inventory: 'tracked', submarkets: ['CBD'] } })] } })
      .mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 12,
        message: { role: 'assistant', content: null,
          tool_calls: [call('page', 'read_result_page', { resultId: a.resultId })] } });
    let checks = 0;
    state.authority.mockImplementation(async () => {
      checks++;
      return checks < 5 ? authority : { ...authority, permissionRevision: 'c'.repeat(64) };
    });
    const { request } = fakeRequest('先查CBD再翻页');
    const response = await handleAgentSubmission(request, deps());
    expect(response.status).toBe(403);
    expect((await response.json()).status).toBe('denied');
    expect(state.append.mock.calls.some(entry => entry[1] === 'denied')).toBe(true);
    expect(state.provider).toHaveBeenCalledTimes(2);
  });

  it('does not claim complete success after authorized source read fails', async () => {
    state.provider.mockReset()
      .mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 10,
        message: { role: 'assistant', content: null, tool_calls: [{
          id: 'read-1', type: 'function', function: { name: 'query_verified_real_estate',
            arguments: '{"question":"查CBD所有楼宇"}' },
        }] } })
      .mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 10,
        message: { role: 'assistant', content: '已获得全部正式数据。' } });
    state.tool.mockRejectedValue(new Error('QUERY_READ_UNAVAILABLE'));
    const { request } = fakeRequest('查CBD所有楼宇');
    const response = await handleAgentSubmission(request, deps());
    expect(response.status).toBe(200);
    const output = await response.json();
    expect(output.status).toBe('assistant');
    expect(output.agent.executionStatus).toBe('limited');
    expect(output.message).toContain('未取得可核验的完整结果');
    expect(output.agent.unresolvedFailures[0]).toMatchObject({ code: 'source_unavailable' });
  });

});
