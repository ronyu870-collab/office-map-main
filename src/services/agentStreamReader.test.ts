import { describe, expect, it, vi } from 'vitest';
import { readAgentEventStream } from './agentStreamReader';

const hash = 'a'.repeat(64);
const frames = (events: unknown[], close = true) => {
  const text = events.map(value => {
    const event = value as { type: string };
    return 'event: ' + event.type + '\ndata: ' + JSON.stringify(value) + '\n\n';
  }).join('');
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 5) controller.enqueue(bytes.slice(i, i + 5));
      if (close) controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
};

describe('signed Agent SSE browser reader', () => {
  it('delivers verified stage and provisional text before the only terminal reply', async () => {
    const progress = vi.fn();
    const result = await readAgentEventStream(frames([
      { type: 'run_started', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { type: 'tool_started', name: 'query_quarterly_metrics' },
      { type: 'tool_completed', name: 'query_quarterly_metrics', status: 'ready' },
      { type: 'message_delta', delta: '北京' },
      { type: 'message_delta', delta: '市场' },
      { type: 'run_completed', reply: { status: 'assistant', message: '北京市场' },
        receipt: { deliveryToken: 'signed-not-used-as-a-real-token', bodySha256: hash } },
    ]), new AbortController().signal, progress);
    expect(progress.mock.calls.map(call => call[0].type)).toEqual([
      'run_started', 'tool_started', 'tool_completed', 'message_delta', 'message_delta',
    ]);
    expect(result.reply).toEqual({ status: 'assistant', message: '北京市场' });
    expect(result.receipt.bodySha256).toBe(hash);
  });
  it('never interprets a partial text stream without completion as success', async () => {
    await expect(readAgentEventStream(frames([
      { type: 'run_started', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { type: 'message_delta', delta: '没写完' },
    ]), new AbortController().signal, vi.fn())).rejects.toMatchObject({ kind: 'network' });
  });
  it('returns a safe provider error and never a fake completed response', async () => {
    await expect(readAgentEventStream(frames([
      { type: 'run_failed', status: 503, message: '模型超时' },
    ]), new AbortController().signal, vi.fn())).rejects.toMatchObject({
      kind: 'service', message: '模型超时',
    });
  });
  it('rejects forged progress and unsigned terminal records', async () => {
    await expect(readAgentEventStream(frames([
      { type: 'run_started', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { type: 'run_completed', reply: { status: 'assistant' }, receipt: { deliveryToken: 'test' } },
    ]), new AbortController().signal, vi.fn())).rejects.toMatchObject({ kind: 'protocol' });
    await expect(readAgentEventStream(frames([
      { type: 'tool_started', name: 'bad', attacker: 'override' },
    ]), new AbortController().signal, vi.fn())).rejects.toMatchObject({ kind: 'protocol' });
  });
});
