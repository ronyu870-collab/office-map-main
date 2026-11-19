import { agentStreamEventSchema, type AgentProgressEvent } from '@/src/lib/intelligence/agent/agentStreamProtocol';
import { QueryClientError } from './queryClientErrors';

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_PENDING_BYTES = 64 * 1024 * 1024;
const errorMessage = 'AI 流式协议异常或连接中断，部分文字不能视为正式回答。';

export type AgentStreamFinal = { reply: unknown; receipt: { deliveryToken: string; bodySha256: string } };

/** Single authenticated fetch/read; no EventSource GET or retry of a POST.
 * Partial tokens are presentation only; a signed run_completed is mandatory. */
export async function readAgentEventStream(
  response: Response, signal: AbortSignal,
  onProgress: (event: AgentProgressEvent) => void,
): Promise<AgentStreamFinal> {
  if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body)
    throw new QueryClientError(response.status === 401 || response.status === 403 ? 'identity' : 'service', errorMessage);

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', size = 0, terminal: AgentStreamFinal | undefined;
  let started = false;
  const consume = (frame: string) => {
    const lines = frame.split('\n');
    const eventLines = lines.filter(line => line.startsWith('event: '));
    const dataLines = lines.filter(line => line.startsWith('data: '));
    if (eventLines.length !== 1 || dataLines.length < 1 || terminal)
      throw new QueryClientError('protocol', errorMessage);
    let raw: unknown;
    try { raw = JSON.parse(dataLines.map(line => line.slice(6)).join('\n')); }
    catch { throw new QueryClientError('protocol', errorMessage); }
    const parsed = agentStreamEventSchema.safeParse(raw);
    if (!parsed.success || eventLines[0].slice(7) !== parsed.data.type)
      throw new QueryClientError('protocol', errorMessage);
    const event = parsed.data;
    if (event.type === 'run_failed')
      throw new QueryClientError(event.status === 401 || event.status === 403 ? 'identity' : 'service', event.message);
    if (event.type === 'run_started') {
      if (started) throw new QueryClientError('protocol', errorMessage);
      started = true;
    }
    if (event.type === 'run_completed') {
      if (!started) throw new QueryClientError('protocol', errorMessage);
      terminal = { reply: event.reply, receipt: event.receipt };
    } else onProgress(event);
  };
  try {
    while (!terminal) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) throw new QueryClientError('protocol', errorMessage);
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      if (buffer.length > MAX_PENDING_BYTES) throw new QueryClientError('protocol', errorMessage);
      for (let index = buffer.indexOf('\n\n'); index !== -1; index = buffer.indexOf('\n\n')) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        consume(frame);
        if (terminal) break;
      }
    }
    if (!terminal) throw new QueryClientError('network', errorMessage);
    return terminal;
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? new QueryClientError('network', errorMessage);
    if (error instanceof QueryClientError) throw error;
    throw new QueryClientError('protocol', errorMessage);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
