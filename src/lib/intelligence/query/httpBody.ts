import { createHmac } from 'node:crypto';

export const QUERY_BODY_LIMIT = 24 * 1024;
export type BodyObservation = { bytesObserved: number; complete: boolean; digest: string | null; digestScope: 'complete' | 'prefix' | 'none' };
export type BodyRead = BodyObservation & { text: string | null; rejection: 'body_too_large' | 'body_interrupted' | 'invalid_encoding' | null };

/** Counts actual UTF-8 bytes and bounds retained memory; Content-Length is never
 * trusted as proof that a stream is complete. Timeout also covers a stalled read. */
export async function readQueryBody(request: Request, digestKey: Uint8Array, timeoutMs = 10000): Promise<BodyRead> {
  const chunks: Uint8Array[] = [];
  let observed = 0, retained = 0, complete = false;
  const reader = request.body?.getReader();
  if (!reader) return { text: '', bytesObserved: 0, complete: true, digest: createHmac('sha256', digestKey).digest('hex'), digestScope: 'complete', rejection: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = AbortSignal.any([request.signal, controller.signal]);
  let interrupt: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    interrupt = () => reject(new Error('BODY_INTERRUPTED'));
    signal.addEventListener('abort', interrupt, { once: true });
    if (signal.aborted) interrupt();
  });
  let rejection: BodyRead['rejection'] = null;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      if (done) { complete = true; break; }
      observed += value.byteLength;
      const piece = value.subarray(0, Math.max(0, QUERY_BODY_LIMIT - retained));
      chunks.push(piece.slice()); retained += piece.byteLength;
      if (observed > QUERY_BODY_LIMIT) { rejection = 'body_too_large'; break; }
    }
  } catch { rejection = 'body_interrupted'; }
  finally {
    clearTimeout(timeout);
    if (interrupt) signal.removeEventListener('abort', interrupt);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, retained);
  let text: string | null = null;
  if (!rejection) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { rejection = 'invalid_encoding'; }
  }
  return { text, bytesObserved: observed, complete, digest: createHmac('sha256', digestKey).update(bytes).digest('hex'), digestScope: complete ? 'complete' : 'prefix', rejection };
}
