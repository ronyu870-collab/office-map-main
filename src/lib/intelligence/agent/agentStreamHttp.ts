import { handleAgentSubmission, type AgentStreamObserver } from './agentHttp';
import type { queryHttpDependencies } from '../query/http';
import { agentStreamEventSchema, type AgentStreamEvent } from './agentStreamProtocol';

type StreamEvent = AgentStreamEvent;
const MAX_EVENT_BYTES = 64 * 1024 * 1024;
const encode = new TextEncoder();

/** A single authenticated POST drives exactly one Agent run. SSE reports only
 * observed execution stages; a final result is delivered only after all
 * existing audit, identity and source checks have succeeded. */
export function handleAgentStream(request: Request, dependencies: ReturnType<typeof queryHttpDependencies>): Response {
  const aborter = new AbortController();
  const source = new ReadableStream<Uint8Array>({
    start(writer) {
      let closed = false;
      const emit = async (event: StreamEvent) => {
        if (aborter.signal.aborted || closed) throw new Error('AGENT_STREAM_CANCELLED');
        const payload = JSON.stringify(agentStreamEventSchema.parse(event));
        if (encode.encode(payload).byteLength > MAX_EVENT_BYTES)
          throw new Error('AGENT_STREAM_EVENT_TOO_LARGE');
        writer.enqueue(encode.encode('event: ' + event.type + '\ndata: ' + payload + '\n\n'));
      };
      void (async () => {
        try {
          const headers = new Headers(request.headers);
          headers.set('accept-encoding', 'identity');
          const forwarded = new Request(request, {
            headers, signal: AbortSignal.any([request.signal, aborter.signal]),
          });
          const response = await handleAgentSubmission(forwarded, dependencies, emit);
          if (aborter.signal.aborted) return;
          const result = await response.json();
          if (response.status !== 200 || !result || !['ready', 'assistant'].includes(result.status)) {
            await emit({ type: 'run_failed', status: response.status,
              message: typeof result?.error === 'string' ? result.error : 'AI 请求未完成。' });
            return;
          }
          const deliveryToken = response.headers.get('x-query-delivery-token');
          const bodySha256 = response.headers.get('x-query-body-sha256');
          if (!deliveryToken || !bodySha256) {
            await emit({ type: 'run_failed', status: 503,
              message: 'AI 响应未取得可信交付凭据，不能标记为成功。' });
            return;
          }
          await emit({ type: 'run_completed', reply: result, receipt: { deliveryToken, bodySha256 } });
        } catch {
          if (!aborter.signal.aborted) {
            try { await emit({ type: 'run_failed', status: 503, message: 'AI 流式连接中断，不能确认请求已完成。' }); }
            catch { /* Closed clients cannot receive error events. */ }
          }
        } finally {
          if (!closed) {
            closed = true;
            try { writer.close(); } catch { /* Cancellation closed the stream. */ }
          }
        }
      })();
    },
    cancel() { aborter.abort(); },
  });
  return new Response(source, { status: 200, headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'private, no-store, no-transform',
    'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff',
    'Vary': 'Authorization, X-Colliers-Impersonate-User',
  } });
}
