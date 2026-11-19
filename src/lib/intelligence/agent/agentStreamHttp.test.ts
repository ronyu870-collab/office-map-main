import { describe, expect, it, vi } from 'vitest';
import { handleAgentStream } from './agentStreamHttp';
import { readAgentEventStream } from '@/src/services/agentStreamReader';
import type { queryHttpDependencies } from '../query/http';

const state = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('./agentHttp', () => ({ handleAgentSubmission: state.run }));
const request = () => new Request('https://www.colliersdata.com/api/intelligence/query/agent/stream', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ question: '你好' }),
});
const fakeDeps = {} as ReturnType<typeof queryHttpDependencies>;

describe('authenticated Agent streaming HTTP envelope', () => {
  it('does not sign or report success until the inner authenticated run has returned a delivery token', async () => {
    state.run.mockReset().mockImplementationOnce(async (_request: Request, _deps: unknown,
      emit: (event: unknown) => Promise<void>) => {
      await emit({ type: 'run_started', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      await emit({ type: 'tool_started', name: 'query_verified_real_estate' });
      await emit({ type: 'tool_completed', name: 'query_verified_real_estate', status: 'ready' });
      await emit({ type: 'message_delta', delta: '北京市场' });
      return Response.json({ requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'assistant', message: '北京市场' }, { headers: {
        'x-query-delivery-token': 'bounded-signed-test-token',
        'x-query-body-sha256': 'a'.repeat(64),
      } });
    });
    const result = handleAgentStream(request(), fakeDeps);
    expect(result.headers.get('content-type')).toContain('text/event-stream');
    const events: string[] = [];
    const final = await readAgentEventStream(result, new AbortController().signal, event => { events.push(event.type); });
    expect(events).toEqual(['run_started', 'tool_started', 'tool_completed', 'message_delta']);
    expect(final.reply).toMatchObject({ status: 'assistant', message: '北京市场' });
    expect(final.receipt.deliveryToken).toBe('bounded-signed-test-token');
    expect(state.run).toHaveBeenCalledOnce();
  });

  it('refuses unsigned or denied runs even if prior deltas were produced', async () => {
    state.run.mockReset().mockImplementationOnce(async (_request: Request, _deps: unknown,
      emit: (event: unknown) => Promise<void>) => {
      await emit({ type: 'run_started', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      await emit({ type: 'message_delta', delta: '尚未核实' });
      return Response.json({ status: 'denied', error: '查询资格已失效' }, { status: 403 });
    });
    const progress = vi.fn();
    await expect(readAgentEventStream(handleAgentStream(request(), fakeDeps),
      new AbortController().signal, progress)).rejects.toMatchObject({ kind: 'identity' });
    expect(progress).toHaveBeenCalledTimes(2);
    expect(state.run).toHaveBeenCalledOnce();
  });
});
