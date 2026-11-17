import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: 'one', effective: 'one', session: 'session', target: null as string | null }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: async () => ({ user: { id: state.effective }, sessionId: state.session, session: { user: { id: state.actor }, access_token: 'synthetic-token' } }) }));
vi.mock('@/src/services/impersonationHeaders', () => ({ getImpersonationTargetUserId: () => state.target, withImpersonationHeaders: (headers: HeadersInit) => new Headers(headers) }));
import { trustedQueryClient } from '../trustedQueryClient';
const scope = { actorId: 'one', effectiveId: 'one', sessionId: 'session', targetId: null };
describe('trusted query client current identity guard', () => {
  beforeEach(() => { state.actor = 'one'; state.effective = 'one'; state.session = 'session'; state.target = null; });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('bounds client waiting and removes deadline resources without creating a second request', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetch);
    const query = trustedQueryClient.submit(scope, { idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', question: 'CBD有哪些楼' }, new AbortController().signal);
    const rejection = expect(query).rejects.toMatchObject({ kind: 'timeout' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(90000);
    await rejection;
    expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('distinguishes transport loss, non-JSON service errors and a changed identity', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('upstream unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const input = { idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', question: 'CBD有哪些楼' };
    await expect(trustedQueryClient.submit(scope, input, new AbortController().signal)).rejects.toMatchObject({ kind: 'network' });
    await expect(trustedQueryClient.submit(scope, input, new AbortController().signal)).rejects.toMatchObject({ kind: 'service' });
    await expect(trustedQueryClient.submit(scope, input, new AbortController().signal)).rejects.toMatchObject({ kind: 'identity' });
  });
  it('does not submit if the effective identity changed before sending', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); state.target = 'other';
    await expect(trustedQueryClient.capabilities(scope, new AbortController().signal)).rejects.toThrow('身份已变化'); expect(fetch).not.toHaveBeenCalled();
  });
  it('suppresses a response if account changes during the actual fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { state.actor = 'two'; return Response.json({ enabled: true, examples: [] }); }));
    await expect(trustedQueryClient.capabilities(scope, new AbortController().signal)).rejects.toThrow('身份已变化');
  });
  it('keeps one submitted question/nonce and no-store on the authenticated route', async () => {
    const fetch = vi.fn(async () => Response.json({ status: 'already_received', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, { status: 202 })); vi.stubGlobal('fetch', fetch);
    const input = { idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', question: 'CBD有哪些楼' };
    expect((await trustedQueryClient.submit(scope, input, new AbortController().signal)).status).toBe('already_received');
    expect(fetch).toHaveBeenCalledWith('/api/intelligence/query', expect.objectContaining({ cache: 'no-store', body: JSON.stringify(input), method: 'POST' }));
  });
  it.each(['submit', 'recover'] as const)('preserves the terminal scope-limit reason returned by %s without a second fetch', async method => {
    const failure = { status: 'failed', reason: 'scope_limit', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      error: '本次查询范围超过交互容量，请减少子市场、季度或指标后重新提问。' };
    const fetch = vi.fn(async () => Response.json(failure, { status: 413 })); vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    const reply = method === 'submit'
      ? await trustedQueryClient.submit(scope, { idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', question: '全部获权楼宇最近四季度净有效租金和空置率' }, signal)
      : await trustedQueryClient.recover(scope, failure.requestId, signal);
    expect(reply).toEqual(failure); expect(fetch).toHaveBeenCalledOnce();
  });
  it('sends structured conversation references and validates attributable clarification options', async () => {
    const conversation = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', parentRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    const options = [{ id: 'rent', label: '净有效租金', question: '按净有效租金' }];
    const fetch = vi.fn(async () => Response.json({ status: 'clarification', conversation, options })); vi.stubGlobal('fetch', fetch);
    const input = { idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', question: '最贵呢', conversation };
    expect(await trustedQueryClient.submit(scope, input, new AbortController().signal)).toMatchObject({ conversation, options });
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual(input);
  });
  it.each([
    { question: '你好', reason: 'scope_required', message: '需要查询哪个子市场？' },
    { question: 'CBD净有效租金', reason: 'period_required', message: '请选择季度。' },
    { question: 'CBD最贵的楼', reason: 'metric_required', message: '请确认租金口径。' },
    { question: 'CBD租赁成交', reason: 'unsupported', message: '当前未开放租赁成交查询。' },
  ])('accepts a real HTTP 422 clarification reason for $question, rather than throwing a parsing error', async ({ question, reason, message }) => {
    const conversation = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
    const reply = { status: 'clarification', code: 'conditions_required', reason, message, options: [], conversation,
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    const fetcher = vi.fn(async () => Response.json(reply, { status: 422 })); vi.stubGlobal('fetch', fetcher);
    const result = await trustedQueryClient.submit(scope,
      { idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', question, conversation }, new AbortController().signal);
    expect(result).toMatchObject({ status: 'clarification', reason, message });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('distinguishes an incompatible response protocol from a network error or a denied request', async () => {
    const fetcher = vi.fn(async () => Response.json({ status: 'clarification', reason: 'unrecognized_future_reason' }, { status: 422 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(trustedQueryClient.submit(scope,
      { idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', question: '你好' }, new AbortController().signal))
      .rejects.toMatchObject({ kind: 'protocol' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects a reply from another conversation or parent before releasing it', async () => {
    const conversation = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', parentRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: 'ready', conversation: { ...conversation, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } }))
      .mockResolvedValueOnce(Response.json({ status: 'clarification', conversation: { id: conversation.id } })); vi.stubGlobal('fetch', fetch);
    const input = { idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', question: '金融街呢', conversation };
    await expect(trustedQueryClient.submit(scope, input, new AbortController().signal)).rejects.toThrow('当前对话不一致');
    await expect(trustedQueryClient.submit(scope, input, new AbortController().signal)).rejects.toThrow('当前对话不一致');
  });
  it('does not accept executable or unbounded clarification actions', async () => {
    const fetch = vi.fn(async () => Response.json({ status: 'clarification', options: [{ id: 'sql', label: '运行', question: '查看租金', sql: 'select * from private' }] })); vi.stubGlobal('fetch', fetch);
    await expect(trustedQueryClient.submit(scope, { idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', question: 'CBD' }, new AbortController().signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('distinguishes eligibility service failure from an explicitly closed capability', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ enabled: false, examples: [] }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ enabled: false, examples: [] }, { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    await expect(trustedQueryClient.capabilities(scope, new AbortController().signal)).rejects.toThrow('暂时无法');
    expect(await trustedQueryClient.capabilities(scope, new AbortController().signal)).toEqual({ enabled: false, examples: [] });
  });
  it('checks downloaded bytes and result binding, and never releases a file across an account switch', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const resultId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', bytes = new Uint8Array([1, 2, 3]);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
    const response = (hash = digest) => new Response(bytes, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="query.zip"', 'X-Query-Result-Id': resultId, 'X-Artifact-Sha256': hash } });
    const request = { requestId: resultId, resultId, action: 'export' as const, format: 'csv_zip' as const };
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response('0'.repeat(64)))
      .mockImplementationOnce(async () => { state.effective = 'another'; return response(); }); vi.stubGlobal('fetch', fetch);
    expect((await trustedQueryClient.download(scope, request, new AbortController().signal)).filename).toBe('query.zip');
    await expect(trustedQueryClient.download(scope, request, new AbortController().signal)).rejects.toThrow('下载校验失败');
    await expect(trustedQueryClient.download(scope, request, new AbortController().signal)).rejects.toThrow('身份已变化');
  });

  it('acknowledges verified bytes and reports DOM separately, without resubmitting a query on receipt failure', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const text = JSON.stringify({ status: 'clarification', message: '请明确季度。' });
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('');
    const fetch = vi.fn(async (url: string) => url.endsWith('/receipt') ? Response.json({ status: 'recorded' })
      : new Response(text, { status: 422, headers: { 'Content-Type': 'application/json', 'X-Query-Delivery-Token': 'synthetic-delivery-token', 'X-Query-Body-Sha256': hash } }));
    vi.stubGlobal('fetch', fetch);
    const reply = await trustedQueryClient.submit(scope, { idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', question: '租金' }, new AbortController().signal);
    await vi.waitFor(() => expect(fetch.mock.calls.filter(([url]) => url.endsWith('/receipt'))).toHaveLength(1));
    expect(JSON.parse((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ phase: 'client_received', bodySha256: hash });
    expect(await trustedQueryClient.reportDelivery(scope, reply, 'client_dom_committed', { surface: 'clarification' })).toBe(true);
    fetch.mockImplementation(async () => Response.json({ status: 'unavailable' }, { status: 503 }));
    expect(await trustedQueryClient.reportDelivery(scope, reply, 'client_dom_committed', { surface: 'clarification' })).toBe(false);
    expect(fetch.mock.calls.filter(([url]) => url === '/api/intelligence/query')).toHaveLength(1);
    state.actor = 'other'; const calls = fetch.mock.calls.length;
    expect(await trustedQueryClient.reportDelivery(scope, reply, 'client_dom_committed', { surface: 'clarification' })).toBe(false);
    expect(fetch.mock.calls).toHaveLength(calls);
  });
  it('does not acknowledge a tampered body or manufacture metadata for an old response', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'ready' }), { headers: { 'Content-Type': 'application/json', 'X-Query-Delivery-Token': 'synthetic', 'X-Query-Body-Sha256': '0'.repeat(64) } }));
    vi.stubGlobal('fetch', fetch);
    await expect(trustedQueryClient.submit(scope, { idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', question: 'CBD' }, new AbortController().signal)).rejects.toThrow('交付校验失败');
    expect(fetch).toHaveBeenCalledOnce();
    expect(await trustedQueryClient.reportDelivery(scope, {}, 'client_received')).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  });

});
