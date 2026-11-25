import { describe, expect, it, vi } from 'vitest';
import { runAgentLoop } from './agentOrchestrator';
import { randomUUID } from 'node:crypto';
import { DATA_TOOL } from './modelProvider';
import type { AgentCompletion } from './modelProtocol';

const signal = new AbortController().signal;
const completion = (content: string | null, tools?: Array<{ id: string; question: string; name?: string }>): AgentCompletion => ({
  provider: 'deepseek',
  model: 'deepseek-v4-flash', inputTokens: 32, outputTokens: 20,
  message: { role: 'assistant', content,
    ...(tools ? { calls: tools.map(tool => ({
      id: tool.id, name: tool.name ?? DATA_TOOL.function.name, arguments: JSON.stringify({ question: tool.question }),
    })) } : {}) },
});

describe('Colliers AI 4.0 native Agent loop', () => {
  it('does not call an on-screen chart a generated PNG file', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ ...completion(null), message: { role: 'assistant', content: null,
      calls: [{ id: 'chart', name: 'create_chart', arguments: JSON.stringify({ resultId: randomUUID(), chart: { kind: 'bar', field: 'netEffectiveRent' } }) }] } })
      .mockResolvedValueOnce(completion('PNG已生成。'));
    const result = await runAgentLoop({ question: '生成一张租金排名 PNG 柱状图。', signal, invoke,
      runTool: vi.fn().mockResolvedValue({ content: '{"status":"ready"}', result: { resultId: randomUUID() } }) });
    expect(result.executionStatus).toBe('partial');
    expect(result.unresolvedFailures).toContainEqual({ tool: 'export_chart', code: 'not_generated' });
  });
  it('answers open conversation from the model without reading business data', async () => {
    const invoke = vi.fn().mockResolvedValue(completion('你好，我可以帮助你。'));
    const runTool = vi.fn();
    const result = await runAgentLoop({ question: '你好', signal, invoke, runTool });
    expect(result.answer).toContain('你好');
    expect(result.model).toBe('deepseek-v4-flash');
    expect(result.calls).toBe(1);
    expect(result.toolCalls).toBe(0);
    expect(result.inputTokens).toBe(32);
    expect(runTool).not.toHaveBeenCalled();
    expect(invoke.mock.calls[0][0].at(-1)).toEqual({ role: 'user', content: '你好' });
  });

  it('executes two sequential native tool calls and lets the model synthesize an answer', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(completion(null, [{ id: 'market-1', question: '查CBD最新净有效租金' }]))
      .mockResolvedValueOnce(completion(null, [{ id: 'market-2', question: '查金融街最新净有效租金' }]))
      .mockResolvedValueOnce(completion('CBD与金融街存在差异，以下是依据。'));
    const runTool = vi.fn()
      .mockResolvedValueOnce({ content: '{"status":"ready","value":103}', result: { resultId: 'first' } })
      .mockResolvedValueOnce({ content: '{"status":"ready","value":107}', result: { resultId: 'second' } });
    const result = await runAgentLoop({ question: '比较CBD和金融街', signal, invoke, runTool });
    expect(result.calls).toBe(3);
    expect(result.toolCalls).toBe(2);
    expect(result.result).toEqual({ resultId: 'second' });
    expect(result.answer).toContain('CBD与金融街');
    expect(runTool.mock.calls.map(call => call[1].question)).toEqual(['查CBD最新净有效租金', '查金融街最新净有效租金']);
    expect(invoke.mock.calls[1][0].some((msg: { role: string; callId?: string }) =>
      msg.role === 'tool' && msg.callId === 'market-1')).toBe(true);
    expect(invoke.mock.calls[2][0].some((msg: { role: string; callId?: string }) =>
      msg.role === 'tool' && msg.callId === 'market-2')).toBe(true);
  });


  it('routes registered specialist tools through the injected authorized executor', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ...completion(null, [{ id: 'q1', question: '比较CBD和金融街最新空置率', name: 'compare_market_segments' }]) })
      .mockResolvedValueOnce(completion('可信来源显示两个子市场的统计结果。'));
    const runTool = vi.fn().mockResolvedValue({ content: '{"status":"ready","sample":20}', result: { source: 'trusted' } });
    const events: string[] = [];
    const result = await runAgentLoop({ question: '对比市场', signal, invoke, runTool,
      onEvent: async event => { events.push(event.type + ':' + (event.name ?? 'model')); } });
    expect(result.toolNames).toEqual(['compare_market_segments']);
    expect(runTool.mock.calls[0][0]).toBe('compare_market_segments');
    expect(events.filter(value => !value.startsWith('phase_changed:'))).toEqual([
      'model_finished:model', 'tool_started:compare_market_segments',
      'tool_finished:compare_market_segments', 'model_finished:model',
    ]);
    expect(events.filter(value => value.startsWith('phase_changed:')).length).toBeGreaterThan(0);
  });


  it('forces a real capability observation when the model skips a required permission lookup', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(completion('你有全部数据权限。'))
      .mockResolvedValueOnce(completion('当前获权字段包括建筑高度。'));
    const runTool = vi.fn().mockResolvedValue({ content: '{"status":"ready","fields":["height"]}' });
    const answer = await runAgentLoop({ question: '你的数据权限是什么？', signal, invoke, runTool });
    expect(answer.toolCalls).toBe(1);
    expect(answer.toolNames).toEqual(['get_data_capabilities']);
    expect(runTool).toHaveBeenCalledWith('get_data_capabilities', { question: '你的数据权限是什么？' }, signal);
    expect(invoke.mock.calls[1][0].some((message: { role: string; content: string }) =>
      message.role === 'tool' && message.content.includes('height'))).toBe(true);
  });

  it('revalidates permission before the server-forced capability lookup', async () => {
    const invoke = vi.fn().mockResolvedValue(completion('你有全部数据权限。'));
    const runTool = vi.fn();
    const revalidate = vi.fn().mockRejectedValue(new Error('QUERY_DENIED'));
    await expect(runAgentLoop({ question: '你的数据权限是什么？', signal,
      invoke, runTool, revalidate })).rejects.toThrow('QUERY_DENIED');
    expect(revalidate).toHaveBeenCalledOnce();
    expect(runTool).not.toHaveBeenCalled();
  });

  it('retains bounded source failure accounting for a server-forced catalog lookup', async () => {
    const invoke = vi.fn().mockResolvedValue(completion('已查询全部CBD楼宇。'));
    const runTool = vi.fn().mockRejectedValue(new Error('QUERY_READ_UNAVAILABLE'));
    const result = await runAgentLoop({ question: 'CBD所有楼宇', signal, invoke, runTool });
    expect(runTool).toHaveBeenCalledOnce();
    expect(result.executionStatus).toBe('limited');
    expect(result.phases).toContain('verification');
    expect(result.unresolvedFailures).toEqual([
      { tool: 'query_verified_real_estate', code: 'source_unavailable' },
    ]);
    expect(result.answer).toContain('未取得可核验的完整结果');
  });

  it('forces a verified catalog read before describing CBD buildings', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(completion('CBD有很多楼。'))
      .mockResolvedValueOnce(completion('已按正式查询取得完整结构化楼宇列表。'));
    const runTool = vi.fn().mockResolvedValue({ content: '{"status":"ready","rowCount":25}' });
    const answer = await runAgentLoop({ question: '把CBD所有楼列出来', signal, invoke, runTool });
    expect(answer.toolNames).toEqual(['query_verified_real_estate']);
  });

  it('rejects an unregistered tool before any executor call', async () => {
    const runTool = vi.fn();
    await expect(runAgentLoop({ question: '删除系统表', signal, runTool,
      invoke: vi.fn().mockResolvedValue(completion(null, [{ id: 'tool-1', question: 'DROP TABLE users', name: 'execute_sql' }])) }))
      .rejects.toThrow('AGENT_UNREGISTERED_TOOL');
    expect(runTool).not.toHaveBeenCalled();
  });

  it('deduplicates identical tool arguments within a run', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(completion(null, [{ id: 'a1', question: '查询CBD最近季度租金' }]))
      .mockResolvedValueOnce(completion(null, [{ id: 'a2', question: '查询CBD最近季度租金' }]))
      .mockResolvedValueOnce(completion('已查询。'));
    const runTool = vi.fn().mockResolvedValue({ content: '{"status":"ready"}' });
    const result = await runAgentLoop({ question: '查询CBD', signal, runTool, invoke });
    expect(result.toolCalls).toBe(2);
    expect(runTool).toHaveBeenCalledTimes(1);
  });

  it('does not reuse the previous quarter\'s chart after the Agent obtains a new verified result', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(completion(null, [{ id: 'data-a', name: 'query_quarterly_metrics', question: 'CBD 2026Q1' }]))
      .mockResolvedValueOnce(completion(null, [{ id: 'chart-a', name: 'prepare_chart', question: '展示该季度图表' }]))
      .mockResolvedValueOnce(completion(null, [{ id: 'data-b', name: 'query_quarterly_metrics', question: 'CBD 2026Q2' }]))
      .mockResolvedValueOnce(completion(null, [{ id: 'chart-b', name: 'prepare_chart', question: '展示该季度图表' }]))
      .mockResolvedValueOnce(completion('两期数据均已核验。'));
    let current = 'none';
    const runTool = vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'query_quarterly_metrics') {
        current = String(args.question).includes('Q1') ? 'Q1' : 'Q2';
        return { content: JSON.stringify({ status: 'ready', period: current }),
          result: { resultId: current } };
      }
      return { content: JSON.stringify({ status: 'ready', chartFrom: current }),
        result: { resultId: current } };
    });
    const answer = await runAgentLoop({ question: '比较 CBD 2026Q1 和 Q2', signal, invoke, runTool });
    expect(answer.toolCalls).toBe(4);
    expect(runTool.mock.calls.filter(call => call[0] === 'prepare_chart')).toHaveLength(2);
    const finalContext = invoke.mock.calls[4][0] as Array<{ role: string; content: string | null }>;
    const twoCharts = finalContext.filter(message => message.role === 'tool' && message.content?.includes('chartFrom'));
    expect(twoCharts.map(message => JSON.parse(message.content!).chartFrom)).toEqual(['Q1', 'Q2']);
    expect(answer.result).toEqual({ resultId: 'Q2' });
  });

  it('fails closed at the cumulative token cap before executing requested tools', async () => {
    const runTool = vi.fn();
    const answer = { ...completion(null, [{ id: 'big', question: '查询CBD' }]), inputTokens: 60001, outputTokens: 12 };
    await expect(runAgentLoop({ question: '研究CBD', signal, runTool,
      invoke: vi.fn().mockResolvedValue(answer) })).rejects.toThrow('AGENT_TOKEN_BUDGET_EXCEEDED');
    expect(runTool).not.toHaveBeenCalled();
  });

  it('bounds tool calls and fails closed instead of pretending to finish', async () => {
    const runTool = vi.fn();
    const many = Array.from({ length: 13 }, (_, i) => ({ id: String(i), question: '查询项目 ' + i }));
    await expect(runAgentLoop({ question: '多条件查询', signal, runTool,
      invoke: vi.fn().mockResolvedValue(completion(null, many)) }))
      .rejects.toThrow('AGENT_TOOL_BUDGET_EXCEEDED');
    expect(runTool).not.toHaveBeenCalled();
  });

  it('inherits only verified server-provided history, not arguments from the browser', async () => {
    const invoke = vi.fn().mockResolvedValue(completion('金融街的口径仍为净有效租金。'));
    await runAgentLoop({ question: '那金融街呢？',
      history: [{ user: 'CBD净有效租金如何', assistant: '上一轮研究了CBD净有效租金。' }],
      signal, invoke, runTool: vi.fn() });
    const messages = invoke.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages.slice(-2).map(item => item.content)).toEqual([
      'CBD净有效租金如何', '那金融街呢？',
    ]);
  });
  it('executes two structured queries and a page read without losing the first result reference', async () => {
    const a = randomUUID(), b = randomUUID();
    const call = (id: string, name: string, args: object) => ({ id, name, arguments: JSON.stringify(args) });
    const scope = { inventory: 'tracked', submarkets: ['CBD'] };
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ...completion(null), message: { role: 'assistant', content: null,
        calls: [call('q1', 'query_quarterly_metrics',
          { scope, period: { year: 2026, quarter: 1 }, metric: 'rent' })] } })
      .mockResolvedValueOnce({ ...completion(null), message: { role: 'assistant', content: null,
        calls: [call('q2', 'query_quarterly_metrics',
          { scope, period: { year: 2026, quarter: 2 }, metric: 'rent' })] } })
      .mockResolvedValueOnce({ ...completion(null), message: { role: 'assistant', content: null,
        calls: [call('page1', 'read_result_page', { resultId: a, offset: 8, limit: 10 })] } })
      .mockResolvedValueOnce(completion('已核验两期全部数据，以下是比较结果。'));
    const runTool = vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'read_result_page') return { content: JSON.stringify({ status: 'ready', resultId: args.resultId,
        totalMatched: 22, offset: args.offset, returnedRows: 10 }) };
      return { content: JSON.stringify({ status: 'ready', resultId: args.period
        && (args.period as { quarter: number }).quarter === 1 ? a : b, rowCount: 22 }),
        result: { resultId: args.period && (args.period as { quarter: number }).quarter === 1 ? a : b } };
    });
    const response = await runAgentLoop({ question: '比较CBD两个季度租金并翻页', signal, invoke, runTool });
    expect(response.toolNames).toEqual(['query_quarterly_metrics', 'query_quarterly_metrics', 'read_result_page']);
    expect(response.result).toEqual({ resultId: b });
    expect(response.executionStatus).toBe('completed');
    expect(runTool.mock.calls[2][1]).toMatchObject({ resultId: a, offset: 8, limit: 10 });
    expect(invoke.mock.calls[3][0].filter((m: { role: string }) => m.role === 'tool')).toHaveLength(3);
  });

  it('returns bounded structured errors, corrects arguments, and never fabricates tool success', async () => {
    const call = (id: string, args: object) => ({ id, name: 'read_result_page', arguments: JSON.stringify(args) });
    const id = randomUUID(), runTool = vi.fn();
    const invoke = vi.fn().mockResolvedValueOnce({ ...completion(null), message: { role: 'assistant',
      content: null, calls: [call('bad', { resultId: 'not-a-uuid' })] } })
      .mockResolvedValueOnce({ ...completion(null), message: { role: 'assistant', content: null,
        calls: [call('good', { resultId: id, offset: 0, limit: 4 })] } })
      .mockResolvedValueOnce(completion('已经读取这一页。'));
    runTool.mockResolvedValue({ content: JSON.stringify({ status: 'ready', totalMatched: 30 }) });
    const result = await runAgentLoop({ question: '翻页看数据', signal, invoke, runTool });
    expect(runTool).toHaveBeenCalledOnce();
    // invoke receives a mutable messages array: inspect the actual tool entry
    // rather than assuming the last item still belongs to the earlier round.
    const messages = invoke.mock.calls[1][0] as Array<{ role: string; content?: string }>;
    expect(messages.filter(message => message.role === 'tool')
      .map(message => JSON.parse(String(message.content)))
      .some(value => value.status === 'error' && value.code === 'invalid_arguments'
        && value.remainingRetries === 1)).toBe(true);
    expect(result.executionStatus).toBe('completed');
  });

  it('rechecks revoked permission even when an identical tool result is deduplicated', async () => {
    const tool = { id: 'one', question: 'CBD 2026Q1' }, again = { id: 'two', question: 'CBD 2026Q1' };
    const invoke = vi.fn()
      .mockResolvedValueOnce(completion(null, [tool]))
      .mockResolvedValueOnce(completion(null, [again]));
    const runTool = vi.fn().mockResolvedValue({ content: '{"status":"ready"}' });
    const revalidate = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('QUERY_DENIED'));
    await expect(runAgentLoop({ question: '两次查询', signal, invoke, runTool, revalidate }))
      .rejects.toThrow('QUERY_DENIED');
    expect(runTool).toHaveBeenCalledOnce();
  });

  it('does not mark a failed source query as successful merely because the model replied', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(completion(null, [{ id: 'failed', question: '查CBD' }]))
      .mockResolvedValueOnce(completion('已查询所有项目。'));
    const runTool = vi.fn().mockRejectedValue(new Error('QUERY_READ_UNAVAILABLE'));
    const result = await runAgentLoop({ question: '查询CBD所有楼宇', signal, invoke, runTool });
    expect(result.executionStatus).toBe('limited');
    expect(result.unresolvedFailures).toEqual([{ tool: 'query_verified_real_estate', code: 'source_unavailable' }]);
    expect(result.answer).toContain('未取得可核验的完整结果');
  });

  it('fails closed after repeated invalid requests, never unbounded retries', async () => {
    const calls = Array.from({ length: 3 }, (_, i) => completion(null, [
      { id: 'bad-' + i, name: 'query_quarterly_metrics', question: '查询' }]));
    const invoke = vi.fn().mockResolvedValueOnce(calls[0]).mockResolvedValueOnce(calls[1])
      .mockResolvedValueOnce(calls[2]);
    // Legacy question remains valid; a failing authoritative backend still has
    // a capped recovery budget and cannot be reinterpreted as success.
    const runTool = vi.fn().mockRejectedValue(new Error('QUERY_READ_UNAVAILABLE'));
    await expect(runAgentLoop({ question: '查询CBD', signal, invoke, runTool }))
      .rejects.toThrow('AGENT_TOOL_RECOVERY_EXHAUSTED');
    expect(runTool).toHaveBeenCalledTimes(1);
  });

});
