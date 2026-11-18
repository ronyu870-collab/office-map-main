import { describe, expect, it, vi } from 'vitest';
import { runAgentLoop } from './agentOrchestrator';
import { DATA_TOOL, type ModelCompletion } from './modelProvider';

const signal = new AbortController().signal;
const completion = (content: string | null, tools?: Array<{ id: string; question: string; name?: string }>): ModelCompletion => ({
  model: 'deepseek-v4-flash', inputTokens: 32, outputTokens: 20,
  message: { role: 'assistant', content,
    ...(tools ? { tool_calls: tools.map(tool => ({
      id: tool.id, type: 'function' as const,
      function: { name: tool.name ?? DATA_TOOL.function.name, arguments: JSON.stringify({ question: tool.question }) },
    })) } : {}) },
});

describe('Colliers AI 4.0 native Agent loop', () => {
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
    expect(invoke.mock.calls[1][0].some((msg: { role: string; tool_call_id?: string }) =>
      msg.role === 'tool' && msg.tool_call_id === 'market-1')).toBe(true);
    expect(invoke.mock.calls[2][0].some((msg: { role: string; tool_call_id?: string }) =>
      msg.role === 'tool' && msg.tool_call_id === 'market-2')).toBe(true);
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

  it('bounds tool calls and fails closed instead of pretending to finish', async () => {
    const runTool = vi.fn();
    const many = Array.from({ length: 7 }, (_, i) => ({ id: String(i), question: '查询项目 ' + i }));
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
    expect(messages.slice(-3).map(item => item.content)).toEqual([
      'CBD净有效租金如何', '上一轮研究了CBD净有效租金。', '那金融街呢？',
    ]);
  });
});

