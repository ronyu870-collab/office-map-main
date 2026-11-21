import { describe, expect, it, vi } from 'vitest';
import { parseDeepSeekStream } from './modelStream';

const frame = (delta: object, reason: string | null = null, usage: object | null = null) => ({
  id: 'chatcmpl-real-provider-id', model: 'deepseek-flash',
  choices: [{ index: 0, delta, finish_reason: reason }], usage,
});
const streaming = (frames: unknown[], done = true) => {
  const text = frames.map(value => 'data: ' + JSON.stringify(value) + '\n\n').join('')
    + (done ? 'data: [DONE]\n\n' : '');
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let cursor = 0; cursor < bytes.length; cursor += 7)
        controller.enqueue(bytes.slice(cursor, cursor + 7));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
};

describe('DeepSeek native SSE parsing', () => {
  it('delivers actual text deltas and the supplier-reported terminal usage', async () => {
    const onDelta = vi.fn().mockResolvedValue(undefined);
    const result = await parseDeepSeekStream(streaming([
      frame({ content: '你' }), frame({ content: '好' }),
      frame({}, 'stop'), { id: 'chatcmpl-real-provider-id', model: 'deepseek-flash', choices: [],
        usage: { prompt_tokens: 51, completion_tokens: 3 } },
    ]), 'deepseek-flash', onDelta, new AbortController().signal);
    expect(result.message.content).toBe('你好');
    expect(result.message.tool_calls).toBeUndefined();
    expect(result.inputTokens).toBe(51);
    expect(result.outputTokens).toBe(3);
    expect(result.providerRequestId).toBe('chatcmpl-real-provider-id');
    expect(onDelta.mock.calls.map(call => call[0])).toEqual(['你', '好']);
  });

  it('reassembles indexed function call arguments before any authorized tool executor sees them', async () => {
    const onDelta = vi.fn();
    const result = await parseDeepSeekStream(streaming([
      frame({ tool_calls: [{ index: 0, id: 'call_1', type: 'function',
        function: { name: 'query_verified_real_estate', arguments: '{"question":' } }] }),
      frame({ tool_calls: [{ index: 0, function: { arguments: '"查询CBD租金"}' } }] }),
      frame({}, 'tool_calls', { prompt_tokens: 89, completion_tokens: 14 }),
    ]), 'deepseek-flash', onDelta, new AbortController().signal);
    expect(result.message.tool_calls).toEqual([{
      id: 'call_1', type: 'function',
      function: { name: 'query_verified_real_estate', arguments: '{"question":"查询CBD租金"}' },
    }]);
    expect(result.inputTokens).toBe(89);
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('rejects truncated streams without a final vendor DONE marker', async () => {
    await expect(parseDeepSeekStream(streaming([
      frame({ content: '只返回部分结果' }, 'stop'),
    ], false), 'deepseek-flash', vi.fn(), new AbortController().signal))
      .rejects.toMatchObject({ code: 'stream_interrupted' });
  });

  it('fails closed on unbounded streamed text rather than accepting a partial success', async () => {
    await expect(parseDeepSeekStream(streaming([
      frame({ content: 'X'.repeat(12500) }), frame({}, 'stop'),
    ]), 'deepseek-flash', vi.fn(), new AbortController().signal))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });
});
