import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const state = vi.hoisted(() => ({ receive: vi.fn(), append: vi.fn(), provider: vi.fn(), tool: vi.fn(),
  identity: vi.fn(), authority: vi.fn(), intake: vi.fn(), history: vi.fn(), save: vi.fn(), readArchive: vi.fn(), recoverArchive: vi.fn() }));
vi.mock('../query/serverAuthority', () => ({ verifyQueryIdentity: state.identity, loadDataAuthority: state.authority }));
vi.mock('../query/auditStore', async original => ({ ...(await original<typeof import('../query/auditStore')>()),
  createRpcAuditPort: () => ({ receive: state.receive, append: state.append }) }));
vi.mock('../query/recovery', () => ({ readOwnResult: state.readArchive, recoverOwnResult: state.recoverArchive }));
vi.mock('../query/intake', () => ({ recordQueryIntake: state.intake }));
vi.mock('../query/historyStore', () => ({ recordHistorySubmission: state.save }));
vi.mock('./modelProvider', async original => ({ ...(await original<typeof import('./modelProvider')>()), completeWithDeepSeek: state.provider }));
vi.mock('./verifiedDataTool', () => ({ queryVerifiedRealEstate: state.tool, executeStructuredDataTool: vi.fn() }));
vi.mock('./agentConversation', async original => ({ ...(await original<typeof import('./agentConversation')>()), readAgentHistory: state.history }));
import { handleAgentSubmission } from './agentHttp';

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const authority = { actorId, effectiveUserId: actorId, sessionId, sessionActive: true, policyVersion: 'test',
  permissionRevision: 'b'.repeat(64), grants: ['query:catalog'], fields: [],
  allSubmarkets: false, submarkets: [], allBuildings: false, buildingIds: [] };
const keys = { keyId: 'query-obligation-fixture', encryptionKey: new Uint8Array(32).fill(10), digestKey: new Uint8Array(32).fill(11) };
const clarification = '请明确要查询的子市场或全部获权楼宇，以及年份季度；尚未查询正式数据。';
const completion = (content: string) => ({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 18,
  message: { role: 'assistant', content } });
async function submit(question: string) {
  const request = new Request('https://www.colliersdata.com/api/intelligence/query/agent', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer isolated-obligation-fixture' },
    body: JSON.stringify({ idempotencyKey: randomUUID(), question, conversation: { id: randomUUID() } }) });
  const rpc = vi.fn((name:string) => ({ abortSignal: () => Promise.resolve(name==='ai_control_runtime'?{data:null,error:{code:'PGRST202',message:'Could not find ai_control_runtime'}}:{ data: { allowed: true }, error: null }) }));
  const response = await handleAgentSubmission(request, { client: { rpc } as unknown as SupabaseClient, keys, enabled: true });
  return { status: response.status, body: await response.json() };
}
beforeEach(() => {
  vi.resetAllMocks();
  state.identity.mockResolvedValue({ actorId, effectiveUserId: actorId, sessionId, expiresAt: Date.now() + 60000 });
  state.authority.mockResolvedValue(authority); state.receive.mockResolvedValue({ replayed: false });
  state.append.mockResolvedValue(undefined); state.intake.mockResolvedValue(undefined); state.history.mockResolvedValue([]);
  state.save.mockResolvedValue(true); state.readArchive.mockResolvedValue({}); state.recoverArchive.mockResolvedValue({});
  state.tool.mockResolvedValue({ content: JSON.stringify({ status: 'requires_clarification', message: clarification }) });
  state.provider.mockResolvedValue(completion('全市平均净有效租金为999元/平方米/月。'));
});

describe('HTTP data-fact obligations independent of model tool selection', () => {
  it.each(['全市平均净有效租金是多少？', '平均空置率是多少？', 'What is the average net effective rent?',
    'What is the current vacancy rate?', '解释净有效租金，并告诉我全市现在是多少。'])('does not publish an unqueried fact: %s', async question => {
    const response = await submit(question);
    expect(response.status).toBe(200);
    expect(state.tool).toHaveBeenCalledOnce();
    expect(state.tool.mock.calls[0][1]).toBe(question);
    expect(response.body.agent.toolCalls).toBe(1);
    expect(response.body.agent.executionStatus).toBe('limited');
    expect(response.body.message).toContain(clarification);
    expect(response.body.message).not.toContain('999');
    expect(response.body.result).toBeUndefined();
  });
  it('does not keep an invented factual answer after the governed query fails', async () => {
    state.tool.mockRejectedValue(new Error('QUERY_READ_UNAVAILABLE'));
    const response = await submit('平均空置率是多少？');
    expect(response.status).toBe(200);
    expect(response.body.agent.executionStatus).toBe('limited');
    expect(response.body.message).toContain('未取得可核验的数据结果');
    expect(response.body.message).not.toContain('999');
  });
  it.each(['净有效租金是什么意思？', '什么是净有效租金？', 'What is net effective rent?', '如何计算空置率？', 'What does net effective rent mean?', 'How do we calculate the vacancy rate?', '请解释一下 净有效租金 的计算方法。',
    '帮我设计租金分析的研究步骤。', '做市场分析时，如何避免把租金涨幅和样本变化混为一谈？',
    '我想讨论租金报告的写作思路', '请帮我写一封邮件，说明净有效租金的概念。', '我们讨论一下季度市场报告的大纲。', '请解释CBD写字楼空置率的概念。', '讨论CBD租金报告的写作思路。', '你好'])('keeps general explanation and work discussion conversational: %s', async question => {
    const text = '可以先明确研究问题、统计口径与资料来源。';
    state.provider.mockResolvedValue(completion(text));
    const response = await submit(question);
    expect(response.status).toBe(200); expect(state.tool).not.toHaveBeenCalled();
    expect(response.body.agent.toolCalls).toBe(0);
    expect(response.body.message).toBe(question === '你好' ? '你好。' : text);
  });
});
