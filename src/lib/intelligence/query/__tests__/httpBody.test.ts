import { describe, expect, it, vi } from 'vitest';
import { QUERY_BODY_LIMIT, readQueryBody } from '../httpBody';

const key = new Uint8Array(32).fill(7);
function request(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  return new Request('http://localhost/query', { method: 'POST', headers, body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }), duplex: 'half' } as RequestInit);
}
describe('bounded HTTP body observation', () => {
  it('measures UTF-8 bytes and accepts a character split across stream chunks', async () => {
    const bytes = new TextEncoder().encode('CBD最高楼');
    const read = await readQueryBody(request([bytes.slice(0, 4), bytes.slice(4)]), key);
    expect(read).toMatchObject({ text: 'CBD最高楼', bytesObserved: bytes.length, complete: true, digestScope: 'complete', rejection: null });
  });
  it('ignores a false small content length and never retains an oversized body as complete', async () => {
    const result = await readQueryBody(request([new Uint8Array(QUERY_BODY_LIMIT + 10)], { 'Content-Length': '1' }), key);
    expect(result).toMatchObject({ text: null, bytesObserved: QUERY_BODY_LIMIT + 10, complete: false, digestScope: 'prefix', rejection: 'body_too_large' });
  });
  it('rejects malformed UTF-8 without pretending replacement characters are the original', async () => {
    expect(await readQueryBody(request([new Uint8Array([255])]), key)).toMatchObject({ text: null, complete: true, rejection: 'invalid_encoding' });
  });
  it('ends a stalled body and cancels its reader using a finite independent timer', async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream({ cancel: cancelled });
    const input = new Request('http://localhost/query', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    expect(await readQueryBody(input, key, 10)).toMatchObject({ text: null, complete: false, rejection: 'body_interrupted' });
    expect(cancelled).toHaveBeenCalledOnce();
  });
});
