import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildTrendResult, buildListResult, buildAggregateResult } from '../query/result';
import { fixture, nameSource } from '../query/__tests__/fixtures';
import { parseQueryPlan } from '../query/plan';
import { encryptAuditContent } from '../query/auditCrypto';
import { attachResearchAnalysis } from '../query/researchAnalysis';

const state = vi.hoisted(() => ({
  receive: vi.fn(), append: vi.fn(), provider: vi.fn(), tool: vi.fn(), structured: vi.fn(), knowledge: vi.fn(), knowledgeCheck: vi.fn(),
  readArchive: vi.fn(), recoverArchive: vi.fn(), identity: vi.fn(), authority: vi.fn(), intake: vi.fn(), history: vi.fn(), save: vi.fn(),
}));

vi.mock('../query/serverAuthority', () => ({
  verifyQueryIdentity: state.identity, loadDataAuthority: state.authority,
}));
vi.mock('../query/auditStore', async original => ({
  ...(await original<typeof import('../query/auditStore')>()),
  createRpcAuditPort: () => ({ receive: state.receive, append: state.append }),
}));
vi.mock('../query/recovery', () => ({ readOwnResult: state.readArchive, recoverOwnResult: state.recoverArchive }));
vi.mock('../query/intake', () => ({ recordQueryIntake: state.intake }));
vi.mock('../query/historyStore', () => ({ recordHistorySubmission: state.save }));
vi.mock('./modelProvider', async original => ({
  ...(await original<typeof import('./modelProvider')>()),
  completeWithDeepSeek: state.provider,
}));
vi.mock('../knowledge/research', async original => ({
  ...(await original<typeof import('../knowledge/research')>()),
  queryKnowledge: state.knowledge, recheckKnowledgeResults: state.knowledgeCheck,
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
    if(name==='ai_control_runtime')return {abortSignal:()=>Promise.resolve({data:null,error:{code:'PGRST202',message:'Could not find ai_control_runtime'}})};
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
  state.knowledgeCheck.mockResolvedValue(undefined);
  state.save.mockResolvedValue(true);
  state.readArchive.mockResolvedValue({}); state.recoverArchive.mockResolvedValue({});
  state.provider.mockResolvedValue({ model: 'deepseek-v4-flash', inputTokens: 12, outputTokens: 18,
    message: { role: 'assistant', content: '你好，我可以帮你分析北京办公楼市场。' } });
});

describe('AI 4.0 authenticated route with model and auditable delivery', () => {
  it('applies an authorized prior-result view through the actual HTTP executor with zero model calls', async () => {
    const prior = { ...buildListResult(fixture(), ['height']), parameters: { executedPlan: parseQueryPlan({ operation: 'list',
      fields: ['height'], scope: { inventory: 'all_authorized', submarkets: ['CBD'] }, period: null }) } };
    state.history.mockResolvedValue(Object.assign([], { contextResult: prior, contextResults: [prior] }));
    const response = await handleAgentSubmission(fakeRequest('筛选建筑高度至少200米').request, deps());
    const body = await response.json();
    expect(response.status).toBe(200); expect(body.agent.modelCalls).toBe(0);
    expect(body.result.parameters.agentTableView.filters).toEqual([{ key: 'height', value: '200', operator: 'gte' }]);
    expect(body.result.table.rows).toHaveLength(4);
    expect(state.provider).not.toHaveBeenCalled(); expect(state.structured).not.toHaveBeenCalled();
  });

  it('does not pair a Q3 narrative with the last all-unknown Q4 check when no primary result was chosen', async () => {
    const rawA = buildAggregateResult(fixture(), 'rent');
    const a = { ...rawA, parameters: { ...rawA.parameters, executedPlan: parseQueryPlan({ operation: 'aggregate',
      scope: { inventory: 'tracked' }, period: { year: 2026, quarter: 3 }, metric: 'rent' }) } };
    const rawB = buildAggregateResult(fixture({ year: 2026, quarter: 4 }), 'rent');
    const b = { ...rawB, parameters: { ...rawB.parameters, period: { year: 2026, quarter: 4 },
      executedPlan: parseQueryPlan({ operation: 'aggregate', scope: { inventory: 'tracked' }, period: { year: 2026, quarter: 4 }, metric: 'rent' }) },
      table: { ...rawB.table, rows: rawB.table.rows.map(row => ({ ...row, cells: Object.fromEntries(
        Object.entries(row.cells).map(([key, cell]) => [key, { kind: 'unknown' as const, state: 'missing' as const,
          reason: 'no_valid_sample', sourceIds: cell.sourceIds }])) })) } };
    const tool = (id: string, quarter: number) => ({ id, type: 'function', function: {
      name: 'query_quarterly_metrics', arguments: JSON.stringify({ scope: { inventory: 'tracked' },
        period: { year: 2026, quarter }, metric: 'rent' }) } });
    state.provider.mockReset().mockResolvedValue({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 18,
      message: { role: 'assistant', content: 'Q3有可用统计，Q4只是覆盖检查。' } })
      .mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 18,
        message: { role: 'assistant', content: null, tool_calls: [tool('a', 3), tool('b', 4)] } });
    state.structured.mockResolvedValueOnce({ result: a, content: '{"status":"ready"}' })
      .mockResolvedValueOnce({ result: b, content: '{"status":"ready"}' });
    const response = await handleAgentSubmission(fakeRequest('查询季度统计，并检查后一季度覆盖。').request, deps());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.result).toBeUndefined();
    expect(body.agent.executionStatus).toBe('limited');
    expect(body.message).toContain('尚未确认');
    expect(body.message).not.toContain('Q3有可用统计');
  });

  it('keeps an explicitly selected Q3 primary after a later all-unknown Q4 query without archiving the unrelated check', async () => {
    const rawA = buildAggregateResult(fixture(), 'rent');
    const a = { ...rawA, parameters: { ...rawA.parameters, executedPlan: parseQueryPlan({ operation: 'aggregate',
      scope: { inventory: 'tracked' }, period: { year: 2026, quarter: 3 }, metric: 'rent' }) } };
    const rawB = buildAggregateResult(fixture({ year: 2026, quarter: 4 }), 'rent');
    const b = { ...rawB, parameters: { ...rawB.parameters, period: { year: 2026, quarter: 4 } },
      table: { ...rawB.table, rows: rawB.table.rows.map(row => ({ ...row, cells: Object.fromEntries(
        Object.entries(row.cells).map(([key, cell]) => [key, { kind: 'unknown' as const, state: 'missing' as const,
          reason: 'no_valid_sample', sourceIds: cell.sourceIds }])) })) } };
    const call = (id: string, name: string, args: object) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
    const model = (calls?: unknown[]) => ({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 18,
      message: { role: 'assistant', content: calls ? null : 'Q3统计已核验。', ...(calls ? { tool_calls: calls } : {}) } });
    state.provider.mockReset().mockResolvedValueOnce(model([call('a', 'query_quarterly_metrics', {
      scope: { inventory: 'tracked' }, period: { year: 2026, quarter: 3 }, metric: 'rent' })]))
      .mockResolvedValueOnce(model([call('select', 'select_answer_results', { primaryResultId: a.resultId, task: 'fact', status: 'answered' })]))
      .mockResolvedValueOnce(model([call('b', 'query_quarterly_metrics', {
        scope: { inventory: 'tracked' }, period: { year: 2026, quarter: 4 }, metric: 'rent' })]))
      .mockResolvedValueOnce(model());
    state.structured.mockResolvedValueOnce({ result: a, content: '{"status":"ready"}' })
      .mockResolvedValueOnce({ result: b, content: '{"status":"ready"}' });
    const response = await handleAgentSubmission(fakeRequest('查询Q3统计，并核对Q4覆盖。').request, deps());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.result.resultId).toBe(a.resultId);
    expect(body.answerSelection.primaryResultId).toBe(a.resultId);
    expect(body.answerSelection.results).toHaveLength(1);
    expect(body.answerSelection.results[0].result.table).toEqual(a.table);
    expect(body.agent.workset).toHaveLength(2);
    expect(body.result.parameters.responsePresentation.narrativeRole).toBe('result_summary');
    const archived = state.append.mock.calls.find(entry => entry[1] === 'response_generated')?.[2].result;
    expect(archived.primaryResultId).toBe(a.resultId);
    expect(archived.results[0].result.table).toEqual(a.table);
  });
  it.each(['new query', 'history only', 'history reads', 'history summary', 'incomplete selection'])('requires both formal references for a continuation comparison: %s', async mode => {
    const formal = (quarter: number) => {
      const raw = buildAggregateResult(fixture({ year: 2026, quarter }), 'rent');
      return { ...raw, parameters: { ...raw.parameters, executedPlan: parseQueryPlan({ operation: 'aggregate',
        scope: { inventory: 'tracked' }, period: { year: 2026, quarter }, metric: 'rent' }) } };
    };
    const a = formal(3), b = formal(2);
    const imported = mode === 'new query' ? [a] : [a, b];
    const recheck = vi.fn().mockResolvedValue(undefined);
    state.history.mockResolvedValue(Object.assign([], { contextResult: a, contextResults: imported, contextRecheck: recheck }));
    const call = (id: string, name: string, args: object) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
    const model = (calls?: unknown[]) => ({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 18,
      message: { role: 'assistant', content: calls ? null : 'Q3和Q2的比较已经完成。', ...(calls ? { tool_calls: calls } : {}) } });
    state.provider.mockReset().mockResolvedValue(model());
    if (mode === 'new query') {
      state.provider.mockResolvedValueOnce(model([call('b', 'query_quarterly_metrics', {
        scope: { inventory: 'tracked' }, period: { year: 2026, quarter: 2 }, metric: 'rent' })]));
      state.structured.mockResolvedValue({ result: b, content: '{"status":"ready"}' });
    } else if (mode === 'history reads') state.provider.mockResolvedValueOnce(model([
      call('a', 'summarize_result', { resultId: a.resultId }), call('b', 'summarize_result', { resultId: b.resultId })]));
    else if (mode === 'incomplete selection') state.provider.mockResolvedValueOnce(model([
      call('select', 'select_answer_results', { primaryResultId: b.resultId, task: 'fact', status: 'answered' })]));
    const observed: Array<{ type: string }> = [];
    const question = mode === 'history reads' ? '分别概括两份已选资料'
      : mode === 'history summary' ? '总结上述两个结果' : '比较Q3与Q2两个结果';
    const response = await handleAgentSubmission(fakeRequest(question).request, deps(), async event => { observed.push(event); });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.result).toBeUndefined(); expect(body.answerSelection).toBeUndefined();
    expect(body.agent.executionStatus).toBe('limited'); expect(body.message).toContain('尚未确认');
    expect(observed.filter(event => event.type === 'message_delta')).toHaveLength(0);
    expect(recheck).toHaveBeenCalled();
  });
  it('archives both selected historical comparison results without requerying', async () => {
    const formal = (quarter: number) => {
      const raw = buildAggregateResult(fixture({ year: 2026, quarter }), 'rent');
      return { ...raw, parameters: { ...raw.parameters, executedPlan: parseQueryPlan({ operation: 'aggregate',
        scope: { inventory: 'tracked' }, period: { year: 2026, quarter }, metric: 'rent' }) } };
    };
    const a = formal(3), b = formal(2);
    state.history.mockResolvedValue(Object.assign([], { contextResult: a, contextResults: [a, b], contextRecheck: vi.fn().mockResolvedValue(undefined) }));
    state.provider.mockReset().mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 18,
      message: { role: 'assistant', content: null, tool_calls: [{ id: 'select', type: 'function', function: {
        name: 'select_answer_results', arguments: JSON.stringify({ primaryResultId: a.resultId, task: 'comparison', status: 'answered',
          auxiliary: [{ resultId: b.resultId, role: 'comparison' }] }) } }] } })
      .mockResolvedValue({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 18, message: { role: 'assistant', content: '已比较。' } });
    const response = await handleAgentSubmission(fakeRequest('比较Q3与Q2两个结果').request, deps());
    const body = await response.json();
    expect(response.status).toBe(200); expect(body.answerSelection.results.map((item: { result: { resultId: string } }) => item.result.resultId)).toEqual([a.resultId, b.resultId]);
    const archived = state.append.mock.calls.find(entry => entry[1] === 'response_generated')?.[2].result;
    expect(archived.results[1].result.table).toEqual(b.table);
    expect(state.structured).not.toHaveBeenCalled();
  });
  it.each(['你好', '请解释同比的计算方法'])('does not force historical selections for a greeting or method explanation: %s', async question => {
    const a = buildAggregateResult(fixture(), 'rent'), b = buildAggregateResult(fixture({ year: 2026, quarter: 2 }), 'rent');
    state.history.mockResolvedValue(Object.assign([], { contextResult: a, contextResults: [a, b], contextRecheck: vi.fn().mockResolvedValue(undefined) }));
    const response = await handleAgentSubmission(fakeRequest(question).request, deps());
    const body = await response.json();
    expect(response.status).toBe(200); expect(body.agent.executionStatus).toBe('completed');
    expect(state.provider).toHaveBeenCalledTimes(question === '你好' ? 0 : 1); expect(body.result).toBeUndefined();
  });
  it.each([true, false])('retains the trusted map operation outcome outside the formal result summary (prepared=%s)', async prepared => {
    let raw = prepared ? buildListResult(fixture(), ['height']) : buildAggregateResult(fixture(), 'rent');
    if (prepared) {
      const ids = new Map(raw.table.rows.map(row => [row.entityId, randomUUID()]));
      raw = { ...raw, table: { ...raw.table, rows: raw.table.rows.map(row => ({ ...row, entityId: ids.get(row.entityId)! })) },
        sources: raw.sources.map(source => ({ ...source, entityId: ids.get(source.entityId) ?? source.entityId,
          recordId: ids.get(source.recordId) ?? source.recordId })) };
    }
    const formal = { ...raw, parameters: { ...raw.parameters, executedPlan: parseQueryPlan(prepared
      ? { operation: 'list', fields: ['height'], period: null, scope: { inventory: 'tracked' } }
      : { operation: 'aggregate', metric: 'rent', period: { year: 2026, quarter: 3 }, scope: { inventory: 'tracked' } }) } };
    const call = (name: string, args: object) => ({ id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
    state.structured.mockResolvedValue({ result: formal, content: '{"status":"ready"}' });
    state.provider.mockReset().mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 18,
      message: { role: 'assistant', content: null, tool_calls: [
        call(prepared ? 'list_buildings' : 'query_quarterly_metrics', prepared ? { scope: { inventory: 'tracked' }, fields: ['height'], period: null }
          : { scope: { inventory: 'tracked' }, period: { year: 2026, quarter: 3 }, metric: 'rent' }),
        call('prepare_map_selection', { resultId: formal.resultId, intent: 'select' })] } })
      .mockResolvedValue({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 18,
        message: { role: 'assistant', content: '已在地图中定位并选中这些楼宇。' } });
    const response = await handleAgentSubmission(fakeRequest('在地图上查看当前结果。').request, deps());
    const body = await response.json();
    expect(response.status).toBe(200); expect(body.result.resultId).toBe(formal.resultId);
    expect(body.result.parameters.responsePresentation.narrativeRole).toBe('result_summary');
    expect(body.message).toBe(body.answerSelection.notice);
    expect(body.message).toContain(prepared ? '地图操作已准备' : '未准备地图操作');
    expect(body.message).toContain('尚未打开地图');
    expect(body.message).not.toMatch(/已在地图中定位|AGENT_|unavailable|部分步骤未取得/);
    expect(body.agent.executionStatus).toBe(prepared ? 'completed' : 'partial');
    if (prepared) expect(body.result.parameters.agentMap).toMatchObject({ intent: 'select', buildingIds: formal.table.rows.map(row => row.entityId) });
    else expect(body.result.parameters.agentMap).toBeUndefined();
    const archived = state.append.mock.calls.find(entry => entry[1] === 'response_generated')?.[2].result;
    expect(archived.notice).toBe(body.answerSelection.notice);
  });
  it('owns the structured summary even after partial execution and keeps one trusted failure notice', async () => {
    const raw = buildAggregateResult(fixture(), 'rent');
    const result = { ...raw, parameters: { ...raw.parameters, executedPlan: parseQueryPlan({ operation: 'aggregate',
      scope: { inventory: 'tracked' }, period: { year: 2026, quarter: 3 }, metric: 'rent' }) } };
    const call = (id: string, quarter: number) => ({ id, type: 'function', function: { name: 'query_quarterly_metrics',
      arguments: JSON.stringify({ scope: { inventory: 'tracked' }, period: { year: 2026, quarter }, metric: 'rent' }) } });
    state.provider.mockReset().mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 18,
      message: { role: 'assistant', content: null, tool_calls: [call('a', 3), call('b', 4)] } })
      .mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 18,
        message: { role: 'assistant', content: '|季度|租金|\n|---|---|\n|Q3|123|\n独立猜测原因。' } });
    state.structured.mockResolvedValueOnce({ result, content: '{"status":"ready"}' })
      .mockRejectedValueOnce(new Error('QUERY_READ_UNAVAILABLE'));
    const response = await handleAgentSubmission(fakeRequest('查询Q3净有效租金，并核对Q4覆盖。').request, deps());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.agent.executionStatus).toBe('partial');
    expect(body.result.parameters.responsePresentation.narrativeRole).toBe('result_summary');
    expect(body.answerSelection.notice).toContain('部分步骤未取得');
    expect(body.message).not.toMatch(/\|季度\||猜测|query_quarterly_metrics|source_unavailable/);
  });
  it.each(['Excel', 'CSV', 'PNG', 'SVG'])('rejects an invented %s file even without a formal result', async format => {
    state.provider.mockResolvedValue({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 18,
      message: { role: 'assistant', content: format + '已生成 https://fake.invalid/download，已保存桌面。' } });
    const response = await handleAgentSubmission(fakeRequest('把刚才的结果生成 ' + format + ' 文件。').request, deps());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.agent.executionStatus).toBe('limited');
    expect(body.message).not.toMatch(/fake.invalid|已保存|已生成/);
    expect(body.message).toContain('未生成');
  });
  it('never presents model-authored Office success or a download URL when no research file was generated', async () => {
    state.provider.mockResolvedValue({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 18,
      message: { role: 'assistant', content: 'Word已保存桌面 https://fake.invalid/report.docx' } });
    const { request } = fakeRequest('生成 Word 研究报告。');
    const response = await handleAgentSubmission(request, deps()); const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200); expect(body.message).toContain('未生成 Word 文件');
    expect(body.message).not.toMatch(/已保存|fake.invalid/); expect(body.result?.parameters?.researchDeliverables).toBeUndefined();
  });
  it('answers through provider after budget and audited admission', async () => {
    const { request, input } = fakeRequest('解释市场研究的方法');
    const response = await handleAgentSubmission(request, deps());
    const output = await response.json();
    expect(response.status).toBe(200);
    expect(output.status).toBe('assistant');
    expect(output.message).toContain('你好');
    expect(output.conversation).toEqual(input.conversation);
    expect(output.agent).toMatchObject({ model: 'deepseek-v4-flash', modelCalls: 1, toolCalls: 0, inputTokens: 12, outputTokens: 18 });
    expect(state.provider).toHaveBeenCalledOnce();
    expect(state.provider.mock.calls[0][0].at(-1)).toMatchObject({ role: 'user', content: '解释市场研究的方法' });
    expect(output.historySaved).toBe(true);
    expect(state.save).toHaveBeenCalledWith(expect.anything(), keys, expect.anything(), input.conversation.id, output.requestId);
    expect(state.receive).toHaveBeenCalledOnce();
    expect(state.append.mock.calls.map(x => x[1])).toContain('succeeded');
    expect(state.append.mock.calls.map(x => x[1])).toContain('accounting');
    expect(state.append.mock.calls.find(x => x[1] === 'accounting' && x[2]?.costStatus)?.[2]).toMatchObject({
      cost: null, costStatus: 'planning_range_not_invoice', durationMs: expect.any(Number),
      costEstimate: { minUsd: expect.any(Number), maxUsd: expect.any(Number) },
    });
    expect(response.headers.get('x-query-delivery-token')).toMatch(/\./);
  });

  it('preserves privacy and evidence limitations for knowledge lists instead of replacing them with a generic table notice', async () => {
    const raw = buildListResult(fixture(), []);
    const result = { ...raw, parameters: { ...raw.parameters, domain: 'knowledge-research/1', evidenceKind: 'internal_document', knowledgeBindings: [], publicBindings: [] } };
    state.knowledge.mockResolvedValue({ result, content: JSON.stringify({ status: 'ready', resultId: result.resultId }) });
    state.provider.mockReset().mockResolvedValueOnce({ model: 'deepseek-v4-flash', inputTokens: 20, outputTokens: 20,
      message: { role: 'assistant', content: null, tool_calls: [{ id: 'knowledge-1', type: 'function', function: {
        name: 'search_internal_documents', arguments: JSON.stringify({ documentIds: [actorId], terms: ['空调系统'], limit: 12 }),
      } }] } }).mockResolvedValueOnce({ model: 'deepseek-v4-flash', inputTokens: 20, outputTokens: 20, message: { role: 'assistant', content: '模型没有读取原文。' } });
    const response = await handleAgentSubmission(fakeRequest('查找获权楼书中的空调系统证据。').request, deps());
    const output = await response.json();
    expect(response.status, JSON.stringify(output)).toBe(200);
    expect(output.message).toContain('私有正文未发送外部模型');
    expect(output.message).toContain('文档陈述不等于已核验的当前事实');
    expect(output.result.parameters.responsePresentation).toMatchObject({ narrativeRole: 'analysis' });
    expect(state.knowledgeCheck).toHaveBeenCalled();
  });

  it('retains the trusted disabled-public-search boundary instead of supplier claims', async () => {
    state.knowledge.mockRejectedValue(new Error('KNOWLEDGE_PUBLIC_SEARCH_DISABLED'));
    state.provider.mockReset().mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 18,
      message: { role: 'assistant', content: null, tool_calls: [{ id: 'public-search', type: 'function', function: {
        name: 'search_public_building_information', arguments: JSON.stringify({ buildingId: actorId, topic: 'completion_year' }),
      } }] } }).mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 18,
        message: { role: 'assistant', content: '已经联网查明竣工时间。' } });
    const response = await handleAgentSubmission(fakeRequest('查公开竣工信息。').request, deps());
    const body = await response.json();
    expect(response.status).toBe(200); expect(body.agent.executionStatus).toBe('limited'); expect(body.result).toBeUndefined();
    expect(body.message).toContain('尚未启用'); expect(body.message).toContain('没有联网');
    expect(body.message).not.toContain('已经联网查明');
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


  it('does not stream a provider capability monologue before the short greeting', async () => {
    const observed: Array<{ type: string; delta?: string }> = [];
    state.provider.mockImplementation(async (_messages: unknown, _signal: AbortSignal,
      onDelta: ((value: string) => Promise<void>) | undefined) => {
      await onDelta?.('我可以帮你分析市场、成交、租金、空置率，并介绍完整能力目录。');
      return { model: 'deepseek-flash', inputTokens: 120, outputTokens: 80,
        message: { role: 'assistant', content: '我可以帮你分析市场、成交、租金、空置率，并介绍完整能力目录。' } };
    });
    const { request } = fakeRequest('你好');
    const response = await handleAgentSubmission(request, deps(), async event => { observed.push(event); });
    expect(response.status).toBe(200);
    expect((await response.json()).message).toBe('你好。');
    expect(observed.filter(event => event.type === 'message_delta')).toHaveLength(0);
    expect(state.tool).not.toHaveBeenCalled();
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
    const { request } = fakeRequest('解释市场研究的方法');
    const response = await handleAgentSubmission(request, deps(false));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/预算/);
    expect(state.provider).not.toHaveBeenCalled();
    expect(state.append.mock.calls.map(x => x[1])).toContain('failed');
  });
  it('retains bounded tool failure metadata when a later model round fails, without persisting tool arguments or raw errors', async () => {
    state.provider.mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 12, outputTokens: 18,
      message: { role: 'assistant', content: null, tool_calls: [{ id: 'one', type: 'function',
        function: { name: 'rank_buildings', arguments: JSON.stringify({ scope: { inventory: 'tracked', submarkets: ['CBD'] },
          field: 'height', direction: 'desc', limit: 10 }) } }] } }).mockRejectedValueOnce(new Error('synthetic-private-error-do-not-log'));
    state.structured.mockRejectedValue(new Error('QUERY_READ_UNAVAILABLE'));
    const response = await handleAgentSubmission(fakeRequest('综合核对CBD高度资料和覆盖').request, deps());
    expect(response.status).toBe(503);
    const failure = state.append.mock.calls.find(c => c[1] === 'accounting' && c[2]?.status === 'incomplete')![2];
    expect(failure.toolTrace).toEqual([expect.objectContaining({ name: 'rank_buildings', status: 'limited', errorCode: 'source_unavailable' })]);
    expect(JSON.stringify(failure)).not.toMatch(/synthetic-private-error|submarkets|arguments/);
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
          tool_calls: [call('page', 'read_result_page', { resultId: a.resultId, offset: 1, limit: 2 }),
            call('select', 'select_answer_results', { primaryResultId: a.resultId, task: 'comparison', status: 'answered', auxiliary: [{ resultId: b.resultId, role: 'comparison' }] })] } })
      .mockResolvedValueOnce({ model: 'deepseek-flash', inputTokens: 20, outputTokens: 25,
        message: { role: 'assistant', content: '已分别核验CBD及金融街楼宇目录，结果按授权样本列示。' } });
    state.structured
      .mockResolvedValueOnce({ content: JSON.stringify({ status: 'ready', rowCount: a.table.rows.length }), result: a })
      .mockResolvedValueOnce({ content: JSON.stringify({ status: 'ready', rowCount: b.table.rows.length }), result: b });
    const { request } = fakeRequest('列出两个子市场并读取CBD第二页');
    const response = await handleAgentSubmission(request, deps());
    const output = await response.json();
    expect(response.status).toBe(200);
    expect(output.result.resultId).toBe(a.resultId);
    expect(output.answerSelection.results.map((item: { result: { resultId: string } }) => item.result.resultId)).toEqual([a.resultId, b.resultId]);
    expect(output.agent.toolCalls).toBe(4);
    expect(output.agent.executionStatus).toBe('completed');
    expect(output.agent.workset).toHaveLength(2);
    expect(output.agent.workset.map((item: { resultId: string }) => item.resultId))
      .toEqual([a.resultId, b.resultId]);
    expect(state.structured).toHaveBeenCalledTimes(2);
    expect(state.structured.mock.calls.map((entry: unknown[]) => entry[1])).toEqual(['search_buildings', 'search_buildings']);
    const page = JSON.parse(state.provider.mock.calls[3][0].find((message: { role: string; content: string }) => message.role === 'tool' && JSON.parse(message.content).offset === 1).content);
    expect(page.status).toBe('ready');
    expect(page.resultId).toBe(a.resultId);
    expect(page.totalMatched).toBe(a.table.rows.length);
    expect(page.rows).toHaveLength(2);
    expect(output.agent.phases).toContain('verification');
    const saved = state.append.mock.calls.find(entry => entry[1] === 'tool_finished'
      && entry[2]?.protocol === 'agent-answer/1')?.[2];
    expect(saved.workset).toHaveLength(2);
    expect(saved.toolTrace).toHaveLength(4);
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
    expect(state.provider).toHaveBeenCalledTimes(1);
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

describe('AI 5.0 natural-language export through the authenticated Agent handler', () => {
  const scope = { inventory: 'tracked', submarkets: ['CBD'] };
  const plan = { operation: 'list', scope, fields: ['height', 'netEffectiveRent', 'totalArea'], period: { year: 2026, quarter: 3 } };
  const call = (name: string, args: unknown) => ({ id: randomUUID(), type: 'function',
    function: { name, arguments: JSON.stringify(args) } });
  const model = (tool_calls?: ReturnType<typeof call>[]) => ({ model: 'deepseek-flash', inputTokens: 10, outputTokens: 10,
    message: { role: 'assistant', content: tool_calls ? null : '文件已保存到你的桌面：https://fake.invalid/export.xlsx', ...(tool_calls ? { tool_calls } : {}) } });
  const cases = [
    { question: '把 CBD 所有楼导出 Excel。', format: 'xlsx' },
    { question: '把 CBD 净有效租金最高的 10 栋楼导出 Excel。', format: 'xlsx', sort: { field: 'netEffectiveRent', direction: 'desc' }, topN: 10 },
    { question: '按照建筑高度排序，导出前 20 栋楼。', format: 'xlsx', sort: { field: 'height', direction: 'desc' }, topN: 20 },
    { question: '把刚才的结果导出 CSV。', format: 'csv_zip' },
    { question: '只保留楼宇名称、子市场、租金和面积。', format: 'xlsx', fields: ['name', 'submarket', 'netEffectiveRent', 'totalArea'] },
    { question: '导出全部结果，不只是当前显示的第一页。', format: 'xlsx' },
  ];
  for (const scenario of cases) it(scenario.question, async () => {
    state.authority.mockResolvedValue({ ...authority, grants: ['query:catalog', 'export:internal'] });
    const snap = fixture();
    const raw = buildListResult({ ...snap, rows: snap.rows.map(row => ({ ...row, dimensions: {
      submarket: { value: 'CBD', source: { ...nameSource(row.id, 'CBD'), id: 'market/' + row.id, field: 'submarket' } },
    } })) }, ['height', 'netEffectiveRent', 'totalArea']);
    const result = { ...raw, parameters: { ...raw.parameters, executedPlan: plan } };
    const history = Object.assign([{ user: 'CBD楼宇列表', assistant: '已查询。' }], { contextPlan: parseQueryPlan(plan) });
    state.history.mockResolvedValue(history);
    state.structured.mockResolvedValue({ result, content: JSON.stringify({ status: 'ready', resultId: result.resultId }) });
    const { question, ...options } = scenario;
    state.provider.mockReset().mockResolvedValueOnce(model([call('list_buildings', { scope, fields: plan.fields, period: plan.period })]))
      .mockResolvedValueOnce(model([call('export_table', { ...options, resultIds: [result.resultId] })]))
      .mockResolvedValueOnce(model());
    const output = await (await handleAgentSubmission(fakeRequest(question).request, deps())).json();
    expect(output.status).toBe('ready');
    expect(output.result.parameters.agentExport).toMatchObject({ version: 'agent-export/1', format: scenario.format });
    expect(output.agent.toolCalls).toBe(2);
    expect(output.message).toContain('文件已准备好');
    expect(output.message).not.toMatch(/已保存到电脑|已经保存在/);
    expect(output.message).not.toContain('已保存到你的桌面');
    expect(output.message).not.toContain('fake.invalid');
    const archive = state.append.mock.calls.find(x => x[1] === 'response_generated')?.[2]?.result;
    const archived = archive.results.find((item: { result: { resultId: string } }) => item.result.resultId === archive.primaryResultId).result;
    expect(archived.resultId).toBe(output.result.resultId);
    const artifact = await import('../query/artifacts').then(m => m.buildResultArtifact(archived,
      { requestId: output.requestId, resultId: archived.resultId, action: 'export', format: scenario.format as 'xlsx' | 'csv_zip' }));
    if (artifact.type !== 'download') throw Error('missing file');
    if (scenario.format === 'xlsx') {
      const XLSX = await import('xlsx');
      const book = XLSX.read(artifact.bytes, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(book.Sheets['数据'], { header: 1 });
      expect(rows).toHaveLength(output.result.table.rows.length + 1);
    } else {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(artifact.bytes);
      expect((await zip.file('data.csv')!.async('string')).split('\r\n')).toHaveLength(6);
      expect(JSON.parse(await zip.file('manifest.json')!.async('string')).resultId).toBe(output.result.resultId);
    }
  });

  it('retains both generated Excel and CSV snapshots in the final answer and archive', async () => {
    state.authority.mockResolvedValue({ ...authority, grants: ['query:catalog', 'export:internal'] });
    const raw = buildListResult(fixture(), ['height']);
    const result = { ...raw, parameters: { ...raw.parameters, executedPlan: { ...plan, fields: ['height'] } } };
    state.structured.mockResolvedValue({ result, content: JSON.stringify({ status: 'ready', resultId: result.resultId }) });
    state.provider.mockReset().mockResolvedValueOnce(model([call('list_buildings', { scope, fields: ['height'], period: plan.period })]))
      .mockResolvedValueOnce(model(['xlsx', 'csv_zip'].map(format => call('export_table', { resultIds: [result.resultId], format }))))
      .mockResolvedValueOnce(model());
    const response = await handleAgentSubmission(fakeRequest('把结果导出 Excel 和 CSV。').request, deps());
    const body = await response.json();
    expect(response.status).toBe(200); expect(body.agent.executionStatus).toBe('completed');
    expect(body.answerSelection.results).toHaveLength(2);
    const archive = state.append.mock.calls.find(x => x[1] === 'response_generated')?.[2]?.result;
    expect(archive).toEqual(body.answerSelection);
    const snapshots = body.answerSelection.results.map((entry: { result: typeof result }) => entry.result);
    expect(new Set(snapshots.map((r: typeof result) => r.resultId)).size).toBe(2);
    const { buildResultArtifact } = await import('../query/artifacts');
    const XLSX = await import('xlsx'); const { default: JSZip } = await import('jszip');
    for (const snapshot of snapshots) {
      const format = snapshot.parameters.agentExport.format;
      const file = await buildResultArtifact(snapshot, { requestId: body.requestId, resultId: snapshot.resultId, action: 'export', format });
      if (file.type !== 'download') throw Error('missing file');
      if (format === 'xlsx') {
        const book = XLSX.read(file.bytes, { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(book.Sheets['数据'], { header: 1 }) as unknown[][];
        expect(rows).toHaveLength(5); expect(rows[1]).toContain('A座'); expect(rows[1]).toContain(210);
      } else {
        const zip = await JSZip.loadAsync(file.bytes); const csv = await zip.file('data.csv')!.async('string');
        expect(csv.split('\r\n')).toHaveLength(6); expect(csv).toContain('A座'); expect(csv).toContain('210');
        expect(JSON.parse(await zip.file('manifest.json')!.async('string')).resultId).toBe(snapshot.resultId);
      }
    }
  });

  it('retains source-bound trend analysis alongside Excel without trusting supplier explanations', async () => {
    state.authority.mockResolvedValue({ ...authority, grants: ['query:catalog', 'export:internal'] });
    const start = { year: 2026, quarter: 2 }, end = { year: 2026, quarter: 3 };
    const snapshots = [fixture(start), fixture(end)];
    const raw = attachResearchAnalysis(buildTrendResult(snapshots, 'rent', 'per_period'), snapshots);
    const formal = { ...raw, parameters: { ...raw.parameters, executedPlan: parseQueryPlan({ operation: 'trend', scope, start, end, metric: 'rent', mode: 'per_period' }) } };
    state.structured.mockResolvedValue({ result: formal, content: JSON.stringify({ status: 'ready', resultId: formal.resultId }) });
    state.provider.mockReset().mockResolvedValueOnce(model([call('analyze_market_trends', { scope, start, end, metric: 'rent' })]))
      .mockResolvedValueOnce(model([call('export_table', { resultIds: [formal.resultId], format: 'xlsx' })]))
      .mockResolvedValueOnce({ ...model(), message: { role: 'assistant', content: '租金上涨完全因为未经证实的政策补贴。' } });
    const body = await (await handleAgentSubmission(fakeRequest('解释Q2到Q3的租金差异并导出 Excel。').request, deps())).json();
    expect(body.agent.executionStatus).toBe('completed');
    const analysis = body.answerSelection.results.find((entry: { result: { resultId: string } }) => entry.result.resultId === formal.resultId);
    expect(analysis?.result.analysis).toEqual(formal.analysis);
    expect(analysis?.result.parameters.researchAnalysis).toEqual(raw.parameters.researchAnalysis);
    expect(analysis?.result.sources).toEqual(formal.sources);
    expect(body.message).not.toContain('政策补贴');
    expect(body.answerSelection.results.some((entry: { result: { parameters: { agentExport?: unknown } } }) => entry.result.parameters.agentExport)).toBe(true);
  });

  it('keeps the trusted missing-CSV notice while the real Excel remains available', async () => {
    state.authority.mockResolvedValue({ ...authority, grants: ['query:catalog', 'export:internal'] });
    const raw = buildListResult(fixture(), ['height']);
    const result = { ...raw, parameters: { ...raw.parameters, executedPlan: { ...plan, fields: ['height'] } } };
    state.structured.mockResolvedValue({ result, content: JSON.stringify({ status: 'ready', resultId: result.resultId }) });
    state.provider.mockReset().mockResolvedValueOnce(model([call('list_buildings', { scope, fields: ['height'], period: plan.period })]))
      .mockResolvedValueOnce(model([call('export_table', { resultIds: [result.resultId], format: 'xlsx' })]))
      .mockResolvedValueOnce(model());
    const response = await handleAgentSubmission(fakeRequest('把结果导出 CSV。').request, deps());
    const body = await response.json();
    expect(response.status).toBe(200); expect(body.agent.executionStatus).toBe('partial');
    expect(body.message).toBe(body.answerSelection.notice); expect(body.message).toContain('未生成 CSV');
    expect(body.result.parameters.agentExport.format).toBe('xlsx');
    const { buildResultArtifact } = await import('../query/artifacts');
    const artifact = await buildResultArtifact(body.result, { requestId: body.requestId, resultId: body.result.resultId, action: 'export', format: 'xlsx' });
    expect(artifact.type).toBe('download');
  });
  it('preserves the bounded archive and marks an additional generated-file request partial before rendering it', async () => {
    state.authority.mockResolvedValue({ ...authority, grants: ['query:catalog', 'export:internal'] });
    const raw = buildListResult(fixture(), ['height']);
    const result = { ...raw, parameters: { ...raw.parameters, executedPlan: { ...plan, fields: ['height'] } } };
    state.structured.mockResolvedValue({ result, content: JSON.stringify({ status: 'ready', resultId: result.resultId }) });
    const outputs = [
      { format: 'xlsx', fields: ['name'] }, { format: 'csv_zip', fields: ['name'] },
      { format: 'xlsx', fields: ['height'] }, { format: 'csv_zip', fields: ['height'] },
    ];
    state.provider.mockReset().mockResolvedValueOnce(model([call('list_buildings', { scope, fields: ['height'], period: plan.period })]))
      .mockResolvedValueOnce(model(outputs.map(output => call('export_table', { resultIds: [result.resultId], ...output }))))
      .mockResolvedValueOnce(model());
    const body = await (await handleAgentSubmission(fakeRequest('把楼宇名称和高度分别导出 Excel 和 CSV。').request, deps())).json();
    expect(body.agent.executionStatus).toBe('partial'); expect(body.answerSelection.status).toBe('partial');
    expect(body.answerSelection.results).toHaveLength(3);
    expect(body.agent.unresolvedFailures).toContainEqual({ tool: 'export_table', code: 'delivery_limit' });
    expect(body.message).toContain('尚未全部完成');
    const event = state.append.mock.calls.find(entry => entry[1] === 'tool_finished' && entry[2]?.protocol === 'agent-answer/1')?.[2];
    expect(event.exportFiles).toHaveLength(3);
  });
  it('retains the first real file when individually valid snapshots exceed the combined archive limit', async () => {
    state.authority.mockResolvedValue({ ...authority, grants: ['query:catalog', 'export:internal'] });
    const raw = buildListResult(fixture(), ['height']);
    // Original parameters remain in each derived export's lineage. Each file
    // fits by itself, while their combined immutable recovery envelope does not.
    const result = { ...raw, parameters: { ...raw.parameters, executedPlan: { ...plan, fields: ['height'] },
      archiveBoundaryFixture: '合'.repeat(3 * 1024 * 1024) } };
    const { prepareExportResult } = await import('./exportTableTool');
    const { sanitizeAuditContent } = await import('../query/auditStore');
    const { encodeGeneratedArchive } = await import('../query/resultArchive');
    const candidates = ['csv_zip', 'xlsx'].map(format => prepareExportResult([result], {
      resultIds: [result.resultId], format: format as 'csv_zip' | 'xlsx' }));
    for (const candidate of candidates) expect(() => encodeGeneratedArchive(JSON.stringify(sanitizeAuditContent({ result: candidate })))).not.toThrow();
    expect(() => encodeGeneratedArchive(JSON.stringify(sanitizeAuditContent({ result: { results: candidates } })))).toThrow('AUDIT_CONTENT_LIMIT');
    state.structured.mockResolvedValue({ result, content: JSON.stringify({ status: 'ready', resultId: result.resultId }) });
    state.provider.mockReset().mockResolvedValueOnce(model([call('list_buildings', { scope, fields: ['height'], period: plan.period })]))
      .mockResolvedValueOnce(model(['csv_zip', 'xlsx'].map(format => call('export_table', { resultIds: [result.resultId], format }))))
      .mockResolvedValueOnce(model());
    const body = await (await handleAgentSubmission(fakeRequest('导出 CSV 和 Excel。').request, deps())).json();
    expect(body.agent.executionStatus).toBe('partial');
    expect(body.answerSelection.results).toHaveLength(1);
    expect(body.agent.unresolvedFailures).toContainEqual({ tool: 'export_table', code: 'delivery_limit' });
    expect(body.message).toContain('未生成 Excel');
    const archive = state.append.mock.calls.find(entry => entry[1] === 'response_generated')?.[2]?.result;
    expect(archive).toEqual(body.answerSelection);
    expect(() => encodeGeneratedArchive(JSON.stringify(sanitizeAuditContent({ result: archive })))).not.toThrow();
    const { buildResultArtifact } = await import('../query/artifacts');
    const snapshot = body.answerSelection.results[0].result;
    const file = await buildResultArtifact(snapshot, { requestId: body.requestId, resultId: snapshot.resultId, action: 'export', format: 'csv_zip' });
    if (file.type !== 'download') throw Error('missing first file');
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(file.bytes);
    expect(await zip.file('data.csv')!.async('string')).toContain('A座');
    const event = state.append.mock.calls.find(entry => entry[1] === 'tool_finished' && entry[2]?.protocol === 'agent-answer/1')?.[2];
    expect(event.exportFiles).toHaveLength(1);
  }, 20000);
  it('fails closed if export permission is withdrawn after generation and before final delivery', async () => {
    const raw = buildListResult(fixture(), ['height']);
    const result = { ...raw, parameters: { ...raw.parameters, executedPlan: { ...plan, fields: ['height'] } } };
    let revoked = false;
    state.authority.mockImplementation(async () => ({ ...authority,
      grants: revoked ? ['query:catalog'] : ['query:catalog', 'export:internal'],
      permissionRevision: revoked ? 'changed' : authority.permissionRevision }));
    state.structured.mockResolvedValue({ result, content: JSON.stringify({ status: 'ready', resultId: result.resultId }) });
    state.provider.mockReset().mockResolvedValueOnce(model([call('list_buildings', { scope })]))
      .mockResolvedValueOnce(model([call('export_table', { resultIds: [result.resultId], format: 'xlsx' })]))
      .mockImplementationOnce(async () => { revoked = true; return model(); });
    const response = await handleAgentSubmission(fakeRequest('导出CBD Excel').request, deps());
    expect(response.status).toBe(403);
    expect((await response.json()).result).toBeUndefined();
    expect(state.append.mock.calls.some(x => x[1] === 'denied')).toBe(true);
  });
});


describe('AI5 chart creation, same-snapshot modification and image delivery', () => {
  const call = (name: string, args: unknown) => ({ id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const completed = (tool_calls?: ReturnType<typeof call>[]) => ({ model: 'deepseek-flash', inputTokens: 20, outputTokens: 20,
    message: { role: 'assistant', content: tool_calls ? null : '图片已经保存在桌面：https://fake.invalid/chart.png', ...(tool_calls ? { tool_calls } : {}) } });
  function result() {
    const r = buildListResult(fixture(), ['height', 'netEffectiveRent']);
    return { ...r, parameters: { ...r.parameters, executedPlan: parseQueryPlan({ operation: 'list', fields: ['height', 'netEffectiveRent'], period: { year: 2026, quarter: 3 }, scope: { inventory: 'tracked', submarkets: ['CBD'] } }) } };
  }
  it.each(['table-image', 'two-image-formats'])('retains every generated attachment with immutable source data: %s', async mode => {
    state.authority.mockResolvedValue({ ...authority, grants: ['query:catalog', 'export:internal'] });
    const formal = result(), spec = { kind: 'plot' as const, type: 'horizontal_bar' as const, x: 'name', y: ['height'] };
    state.structured.mockResolvedValue({ content: JSON.stringify({ status: 'ready', resultId: formal.resultId }), result: formal });
    const exports = mode === 'table-image'
      ? [call('export_table', { resultIds: [formal.resultId], format: 'xlsx' }), call('export_chart', { resultId: formal.resultId, format: 'png_zip' })]
      : ['png_zip', 'svg_zip'].map(format => call('export_chart', { resultId: formal.resultId, format }));
    state.provider.mockReset().mockResolvedValueOnce(completed([call('list_buildings', { scope: { inventory: 'tracked', submarkets: ['CBD'] }, fields: ['height', 'netEffectiveRent'], period: { year: 2026, quarter: 3 } })]))
      .mockResolvedValueOnce(completed([call('create_chart', { resultId: formal.resultId, chart: spec })]))
      .mockResolvedValueOnce(completed(exports)).mockResolvedValueOnce(completed());
    const question = mode === 'table-image' ? '生成高度柱状图并导出 Excel 和 PNG。' : '生成高度柱状图并导出 PNG 和 SVG。';
    const body = await (await handleAgentSubmission(fakeRequest(question).request, deps())).json();
    expect(body.agent.executionStatus).toBe('completed'); expect(body.answerSelection.results).toHaveLength(2);
    const snapshots = body.answerSelection.results.map((entry: { result: ReturnType<typeof result> }) => entry.result);
    expect(new Set(snapshots.map((r: ReturnType<typeof result>) => r.resultId)).size).toBe(2);
    const { buildResultArtifact } = await import('../query/artifacts'); const { default: JSZip } = await import('jszip');
    for (const snapshot of snapshots) {
      const format = snapshot.parameters.agentExport?.format ?? snapshot.parameters.agentChart.format;
      const file = await buildResultArtifact(snapshot, { requestId: body.requestId, resultId: snapshot.resultId, action: 'export', format,
        ...(format === 'png_zip' || format === 'svg_zip' ? { chart: spec } : {}) });
      if (file.type !== 'download') throw Error('missing generated attachment');
      if (format === 'xlsx') {
        const XLSX = await import('xlsx'); const book = XLSX.read(file.bytes, { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(book.Sheets['数据'], { header: 1 }) as unknown[][];
        expect(rows).toHaveLength(5); expect(rows[1]).toContain('A座'); expect(rows[1]).toContain(210);
      } else {
        expect(snapshot.table).toEqual(formal.table); expect(snapshot.sources).toEqual(formal.sources);
        const zip = await JSZip.loadAsync(file.bytes), entry = Object.keys(zip.files).find(name => name.endsWith(format === 'png_zip' ? '.png' : '.svg'))!;
        expect(entry).toBeTruthy();
        if (format === 'png_zip') expect([...(await zip.file(entry)!.async('uint8array')).slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        else expect(await zip.file(entry)!.async('string')).toContain('<svg');
      }
    }
    const event = state.append.mock.calls.find(c => c[1] === 'tool_finished' && c[2]?.protocol === 'agent-answer/1')?.[2];
    expect(body.answerSelection.results.some((entry: { result: { resultId: string } }) => entry.result.resultId === event.chartContext.resultId)).toBe(true);
  });
  it.each(['export_chart', 'modify_chart'])('prefers this turn chart over the restored chart for implicit %s', async tool => {
    state.authority.mockResolvedValue({ ...authority, grants: ['query:catalog', 'export:internal'] });
    const prior = result(), fresh = result();
    const oldSpec = { kind: 'plot' as const, type: 'bar' as const, x: 'name', y: ['height'] };
    const nextSpec = { ...oldSpec, type: 'horizontal_bar' as const, y: ['netEffectiveRent'] };
    const old = { ...prior, parameters: { ...prior.parameters, agentChart: { version: 'chart-workspace/1', request: oldSpec } } };
    state.history.mockResolvedValue(Object.assign([], { contextResult: old, contextChart: { resultId: old.resultId, chart: oldSpec },
      contextRecheck: vi.fn().mockResolvedValue(undefined) }));
    state.structured.mockResolvedValue({ content: JSON.stringify({ status: 'ready', resultId: fresh.resultId }), result: fresh });
    state.provider.mockReset()
      .mockResolvedValueOnce(completed([call('list_buildings', { scope: { inventory: 'tracked', submarkets: ['CBD'] }, fields: ['height', 'netEffectiveRent'], period: { year: 2026, quarter: 3 } })]))
      .mockResolvedValueOnce(completed([call('select_answer_results', { primaryResultId: fresh.resultId, task: 'list', status: 'answered' })]))
      .mockResolvedValueOnce(completed([call('create_chart', { resultId: fresh.resultId, chart: nextSpec })]))
      .mockResolvedValueOnce(completed([call(tool, tool === 'export_chart' ? { format: 'png_zip' } : { chart: nextSpec })]))
      .mockResolvedValueOnce(completed());
    const response = await handleAgentSubmission(fakeRequest(tool === 'export_chart' ? '重新查数，生成租金横向柱状图并导出PNG。' : '重新查数并创建租金横向柱状图，再调整当前图。').request, deps());
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200); expect(body.agent.executionStatus).toBe('completed');
    expect(body.result.resultId).toBe(fresh.resultId);
    expect(body.result.parameters.agentChart.request).toEqual(nextSpec);
    expect(body.result.table).toEqual(fresh.table); expect(body.result.sources).toEqual(fresh.sources);
  });
  it('applies a full chart specification and delivers actual PNG bytes via the existing artifact engine', async () => {
    state.authority.mockResolvedValue({ ...authority, grants: ['query:catalog', 'export:internal'] });
    const formal = result(), spec = { kind: 'plot' as const, type: 'horizontal_bar' as const, x: 'name', y: ['netEffectiveRent'], sort: { field: 'netEffectiveRent', direction: 'desc' as const } };
    state.structured.mockResolvedValue({ content: JSON.stringify({ status: 'ready', resultId: formal.resultId }), result: formal });
    state.provider.mockReset().mockResolvedValueOnce(completed([call('list_buildings', { scope: { inventory: 'tracked', submarkets: ['CBD'] }, fields: ['height', 'netEffectiveRent'], period: { year: 2026, quarter: 3 } })]))
      .mockResolvedValueOnce(completed([call('create_chart', { resultId: formal.resultId, chart: spec })]))
      .mockResolvedValueOnce(completed([call('export_chart', { resultId: formal.resultId, format: 'png_zip' })]))
      .mockResolvedValueOnce(completed());
    const response = await handleAgentSubmission(fakeRequest('CBD 楼宇租金横向柱状图，导出 PNG').request, deps());
    const body = await response.json();
    expect(response.status).toBe(200); expect(body.agent.executionStatus).toBe('completed');
    expect(body.result.parameters.agentChart).toMatchObject({ request: spec, format: 'png_zip' });
    expect(body.result.table).toEqual(formal.table); expect(body.result.dataVersion).toBe(formal.dataVersion);
    expect(body.message).toContain('文件已准备好'); expect(body.message).not.toContain('fake.invalid'); expect(body.message).not.toContain('已经保存在桌面');
    const event = state.append.mock.calls.find(c => c[1] === 'tool_finished' && c[2]?.protocol === 'agent-answer/1')?.[2];
    expect(event.chartFile).toMatchObject({ state: 'server_generated', format: 'png_zip', bytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const { buildResultArtifact } = await import('../query/artifacts');
    const artifact = await buildResultArtifact(body.result, { requestId: body.requestId, resultId: body.result.resultId, action: 'export', format: 'png_zip', chart: spec });
    if (artifact.type !== 'download') throw new Error();
    expect(artifact.sha256).toBe(event.chartFile.sha256);
  });
  it.each(['combined', 'legacy chart-only', 'chart-companion', 'revoked'])('modifies a cross-turn chart through real encrypted history recovery: %s', async mode => {
    const { readAgentHistory, AGENT_CONVERSATION_PROTOCOL } = await vi.importActual<typeof import('./agentConversation')>('./agentConversation');
    state.history.mockImplementation(readAgentHistory);
    const formal = result(), chart = { kind: 'plot' as const, type: 'bar' as const, x: 'name', y: ['height'] };
    const nextChart = { ...chart, type: 'horizontal_bar' as const, y: ['netEffectiveRent'] };
    const parentRequestId = randomUUID(), conversationId = randomUUID();
    const primary = mode === 'chart-companion' ? result() : formal;
    const selection = { version: 'answer-selection/1', task: 'list', status: 'answered', primaryResultId: primary.resultId,
      results: [{ role: 'primary', result: primary }, ...(mode === 'chart-companion' ? [{ role: 'comparison', result: formal }] : [])] };
    const event = (kind: string, content: unknown, sequence: number) => {
      const eventId = randomUUID();
      return { request_id: parentRequestId, event_id: eventId, kind, sequence,
        cipher: encryptAuditContent(JSON.stringify({ content, redactionTypes: [] }), { requestId: parentRequestId, eventId,
          actorId, effectiveUserId: actorId }, keys.keyId, keys.encryptionKey) };
    };
    const events = [
      event('received', { sessionId, authority: { actorId, effectiveUserId: actorId },
        metadata: { protocol: AGENT_CONVERSATION_PROTOCOL, conversation: { id: conversationId } } }, 1),
      event('tool_finished', { protocol: 'agent-answer/1', permissionRevision: authority.permissionRevision,
        history: [{ user: '创建高度图表', assistant: '已生成同源图表。' }],
        ...(mode !== 'legacy chart-only' ? { answerContext: true } : {}), chartContext: { resultId: formal.resultId, chart } }, 2),
      event('response_generated', { result: mode === 'legacy chart-only' ? formal : selection }, 3),
    ];
    state.readArchive.mockResolvedValue({ state: 'succeeded', permission_revision: authority.permissionRevision,
      head_hash: 'f'.repeat(64), head_sequence: 3, events });
    const recheck = mode === 'revoked' ? vi.fn().mockRejectedValue(new Error('QUERY_DENIED')) : vi.fn().mockResolvedValue(undefined);
    state.recoverArchive.mockImplementation(async () => {
      const answerSelection = structuredClone(selection);
      return mode === 'legacy chart-only' ? { result: structuredClone(formal), recheck }
        : { result: answerSelection.results[0].result, answerSelection, recheck };
    });
    state.provider.mockReset().mockResolvedValueOnce(completed([call('modify_chart', { chart: nextChart })])).mockResolvedValueOnce(completed());
    const rpc = vi.fn((name: string) => ({ abortSignal: () => Promise.resolve({ data: name === 'ai_control_runtime' ? null : name === 'ai_query_context_read'
      ? { allowed: true, permission_revision: authority.permissionRevision, state: 'succeeded', events } : { allowed: true }, error: name === 'ai_control_runtime' ? {code:'PGRST202',message:'Could not find ai_control_runtime'} : null }) }));
    const request = new Request('https://www.colliersdata.com/api/intelligence/query/agent', { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer isolated-test-only' },
      body: JSON.stringify({ idempotencyKey: randomUUID(), question: '改成横向柱状图', conversation: { id: conversationId, parentRequestId } }) });
    const response = await handleAgentSubmission(request, { ...deps(), client: { rpc } as unknown as SupabaseClient });
    const body = await response.json();
    expect(response.status).toBe(mode === 'revoked' ? 403 : 200);
    expect(state.readArchive).toHaveBeenCalledOnce(); expect(state.recoverArchive).toHaveBeenCalledOnce();
    if (mode === 'revoked') {
      expect(body.result).toBeUndefined(); expect(state.provider).not.toHaveBeenCalled();
    } else {
      expect(body.result.resultId).toBe(formal.resultId); expect(body.result.parameters.agentChart.request).toEqual(nextChart);
      expect(body.result.table).toEqual(formal.table); expect(body.result.sources).toEqual(formal.sources);
      expect(body.result.snapshotId).toBe(formal.snapshotId); expect(body.result.dataVersion).toBe(formal.dataVersion);
      expect(state.structured).not.toHaveBeenCalled(); expect(state.tool).not.toHaveBeenCalled();
    }
  });
  it('uses a reauthorized prior chart result in the new workset without requerying or changing data', async () => {
    const formal = result(), chart = { kind: 'plot' as const, type: 'bar' as const, x: 'name', y: ['height'] };
    const recheck = vi.fn().mockResolvedValue(undefined);
    state.history.mockResolvedValue(Object.assign([], { contextResult: formal, contextChart: { resultId: formal.resultId, chart }, contextRecheck: recheck }));
    state.provider.mockReset().mockResolvedValueOnce(completed([call('modify_chart', { chart: { ...chart, type: 'horizontal_bar', y: ['netEffectiveRent'], sort: { field: 'netEffectiveRent', direction: 'desc' } } })]))
      .mockResolvedValueOnce(completed());
    const response = await handleAgentSubmission(fakeRequest('改成横向柱状图，按租金从高到低排列').request, deps());
    const body = await response.json();
    expect(response.status).toBe(200); expect(body.result.resultId).toBe(formal.resultId);
    expect(body.result.table).toEqual(formal.table); expect(body.result.sources).toEqual(formal.sources);
    expect(body.result.dataVersion).toBe(formal.dataVersion); expect(body.result.snapshotId).toBe(formal.snapshotId);
    expect(state.tool).not.toHaveBeenCalled(); expect(state.structured).not.toHaveBeenCalled(); expect(recheck.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  it('refuses unavailable fields, export without independent grant and source revocation before delivery', async () => {
    const formal = result(), spec = { kind: 'plot' as const, type: 'horizontal_bar' as const, x: 'name', y: ['private_phone'] };
    state.history.mockResolvedValue(Object.assign([], { contextResult: formal, contextRecheck: vi.fn().mockResolvedValue(undefined) }));
    state.provider.mockReset().mockResolvedValueOnce(completed([call('create_chart', { resultId: formal.resultId, chart: spec })])).mockResolvedValueOnce(completed());
    const denied = await handleAgentSubmission(fakeRequest('图表').request, deps());
    expect((await denied.json()).result).toBeUndefined();
    state.provider.mockReset().mockResolvedValueOnce(completed([call('export_chart', { resultId: formal.resultId, chart: { ...spec, y: ['height'] }, format: 'png_zip' })])).mockResolvedValueOnce(completed());
    const noExport = await handleAgentSubmission(fakeRequest('导出 PNG').request, deps());
    const noExportBody = await noExport.json();
    expect(noExportBody.message).toContain('未生成 PNG 文件'); expect(noExportBody.agent.unresolvedFailures).toContainEqual({ tool: 'export_chart', code: 'export_not_authorized' });
    const recheck = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('QUERY_DENIED'));
    state.history.mockResolvedValue(Object.assign([], { contextResult: formal, contextRecheck: recheck }));
    state.provider.mockReset().mockResolvedValueOnce(completed([call('modify_chart', { chart: { ...spec, y: ['height'] } })])).mockResolvedValueOnce(completed());
    state.append.mockClear();
    const revoked = await handleAgentSubmission(fakeRequest('改为横向柱状图').request, deps());
    expect(revoked.status).toBe(403); expect((await revoked.json()).result).toBeUndefined();
    expect(state.append.mock.calls.some(c => c[1] === 'denied')).toBe(true);
    expect(state.append.mock.calls.some(c => c[1] === 'succeeded')).toBe(false);
  });
});


describe('AI5 controlled PDF report tool', () => {
  function scripted() {
    const start = { year: 2026, quarter: 1 }, end = { year: 2026, quarter: 2 };
    const raw = buildTrendResult([fixture(start), fixture(end)], 'rent', 'per_period');
    const formal = { ...raw, parameters: { ...raw.parameters, scope: { inventory: 'tracked', submarkets: ['CBD'] }, executedPlan: parseQueryPlan({ operation: 'trend', metric: 'rent', start, end, mode: 'per_period', scope: { inventory: 'tracked', submarkets: ['CBD'] } }) } };
    state.structured.mockResolvedValue({ content: '{"status":"ready"}', result: formal });
    let round = 0;
    state.provider.mockImplementation(async () => { const step = round++; const calls = step === 0 ? [{ name: 'analyze_market_trends', args: { scope: { inventory: 'tracked', submarkets: ['CBD'] }, start, end, metric: 'rent' } }] : step === 1 ? [{ name: 'generate_pdf_report', args: { resultIds: [formal.resultId] } }] : null;
      return { model: 'deepseek-flash', inputTokens: 20, outputTokens: 20, message: { role: 'assistant', content: calls ? null : '已保存到桌面 https://fake.invalid/report.pdf', ...(calls ? { tool_calls: calls.map((c, i) => ({ id: `pdf-${step}-${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) } }; });
  }
  it('generates a real server PDF, archives its lineage and supplies a genuine delivery descriptor without model save claims', async () => {
    state.authority.mockResolvedValue({ ...authority, grants: ['query:catalog', 'export:internal'] }); scripted();
    const response = await handleAgentSubmission(fakeRequest('CBD季度市场PDF研究报告').request, deps()), body = await response.json();
    expect(response.status).toBe(200); expect(body.result.parameters.agentReport).toMatchObject({ format: 'pdf', sectionCount: 1, purpose: 'internal' });
    expect(body.message).toContain('文件已准备好'); expect(body.message).not.toMatch(/已保存到桌面|fake.invalid/);
    expect(state.recoverArchive).toHaveBeenCalledOnce();
    const answer = state.append.mock.calls.find(x => x[1] === 'tool_finished' && x[2]?.protocol === 'agent-answer/1');
    expect(answer?.[2].reportFile).toMatchObject({ state: 'server_generated', format: 'pdf', bytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
  it('refuses generation without the independent export grant and refuses changed source ACL before the final answer', async () => {
    scripted(); let response = await handleAgentSubmission(fakeRequest('生成PDF报告').request, deps()), body = await response.json();
    expect(body.result?.parameters.agentReport).toBeUndefined(); expect(body.message).toContain('未生成 PDF');
    state.authority.mockResolvedValue({ ...authority, grants: ['query:catalog', 'export:internal'] }); state.recoverArchive.mockRejectedValue(new Error('QUERY_DENIED')); scripted();
    response = await handleAgentSubmission(fakeRequest('生成PDF报告').request, deps()); body = await response.json();
    expect(response.status).toBe(403); expect(body.result).toBeUndefined();
    expect(state.append.mock.calls.some(x => x[1] === 'correction' && x[2]?.delivery === 'not_sent')).toBe(true);
  });
});
