import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ actor: '11111111-1111-4111-8111-111111111111' }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: vi.fn(async () => ({ user: { id: state.actor }, session: { access_token: 'synthetic-token' } })) }));
import { discardUnsentLeaseTransfer, getPendingLeaseTransfers, prepareLeaseTransfer, submitLeaseTransfer } from '../leaseTransferService';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const OTHER_ACTOR = '33333333-3333-4333-8333-333333333333';
const TARGET = '22222222-2222-4222-8222-222222222222';
const RECORD = '55555555-5555-4555-8555-000000000001';
const VERSION = '2026-10-26T03:04:05.123456+00:00';
const record = () => ({ id: RECORD, submitter_id: 'legacy-text-owner', updated_at: VERSION });
const fetchMock = vi.fn<typeof fetch>();
const receipt = (body: string, overrides = {}) => {
  const request = JSON.parse(body);
  return { success: true, requestId: request.requestId, submissionId: request.submissionId, targetUserId: request.targetUserId,
    targetUserName: 'Verified recipient', updatedAt: '2026-10-27T00:00:00+00:00', transferredAt: '2026-10-27T00:00:00+00:00', replayed: false, ...overrides };
};

beforeEach(() => { state.actor = ACTOR; localStorage.clear(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('durable lease transfer requests', () => {
  it('persists exact legacy/null preconditions and reuses the same request across preparation', () => {
    const pending = prepareLeaseTransfer(ACTOR, record(), TARGET);
    expect(pending.expectedSubmitterId).toBe('legacy-text-owner');
    expect(pending.expectedUpdatedAt).toBe(VERSION);
    expect(prepareLeaseTransfer(ACTOR, { ...record(), updated_at: 'different-current-version' }, TARGET)).toEqual(pending);
    expect(getPendingLeaseTransfers(ACTOR)).toEqual([pending]);
    expect(getPendingLeaseTransfers(OTHER_ACTOR)).toEqual([]);
    expect(JSON.stringify(pending)).not.toMatch(/token|company|name/i);
    discardUnsentLeaseTransfer(pending);
    const nullable = prepareLeaseTransfer(ACTOR, { id: RECORD, submitter_id: null, updated_at: null }, TARGET);
    expect(nullable.expectedSubmitterId).toBeNull();
    expect(nullable.expectedUpdatedAt).toBeNull();
  });

  it('does not silently replace a pending recipient or guess missing record versions', () => {
    const pending = prepareLeaseTransfer(ACTOR, record(), TARGET);
    expect(() => prepareLeaseTransfer(ACTOR, record(), OTHER_ACTOR)).toThrow('先确认原接收人');
    discardUnsentLeaseTransfer(pending);
    expect(() => prepareLeaseTransfer(ACTOR, { id: RECORD, submitter_id: ACTOR }, TARGET)).toThrow('版本信息缺失');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to send if browser storage cannot durably retain the request', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('synthetic quota'); });
    expect(() => prepareLeaseTransfer(ACTOR, record(), TARGET)).toThrow('本次未发送');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send if persisting the attempt marker fails after preparing a request', async () => {
    const pending = prepareLeaseTransfer(ACTOR, record(), TARGET);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('synthetic quota'); });
    await expect(submitLeaseTransfer(pending)).rejects.toMatchObject({ certainty: 'not-sent' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getPendingLeaseTransfers(ACTOR)[0].state).toBe('prepared');
  });

  it('fails closed for malformed retained confirmation data', () => {
    const pending = prepareLeaseTransfer(ACTOR, record(), TARGET);
    const key = localStorage.key(0)!;
    localStorage.setItem(key, JSON.stringify({ ...pending, requestId: 'invalid' }));
    expect(() => getPendingLeaseTransfers(ACTOR)).toThrow('确认信息损坏');
    expect(() => prepareLeaseTransfer(ACTOR, record(), TARGET)).toThrow();
  });

  it('marks unknown before sending, sends no caller name/token in payload, and deduplicates a double click', async () => {
    const pending = prepareLeaseTransfer(ACTOR, record(), TARGET);
    let finish!: (value: Response) => void;
    fetchMock.mockImplementation(async (_url, options) => {
      expect(getPendingLeaseTransfers(ACTOR)[0].state).toBe('unknown');
      expect(JSON.parse(options!.body as string)).toEqual({ requestId: pending.requestId, submissionId: RECORD, targetUserId: TARGET,
        expectedSubmitterId: 'legacy-text-owner', expectedUpdatedAt: VERSION });
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    const first = submitLeaseTransfer(pending);
    const second = submitLeaseTransfer(pending);
    expect(first).toBe(second);
    await expect(submitLeaseTransfer({ ...pending, targetUserId: OTHER_ACTOR })).rejects.toMatchObject({ certainty: 'not-sent' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    finish(Response.json(receipt(fetchMock.mock.calls[0][1]!.body as string)));
    expect((await first).targetUserName).toBe('Verified recipient');
    expect(getPendingLeaseTransfers(ACTOR)).toEqual([]);
  });

  it('retains a network-unknown request across cancel/reopen and retries its exact key', async () => {
    const pending = prepareLeaseTransfer(ACTOR, record(), TARGET);
    fetchMock.mockRejectedValueOnce(new TypeError('synthetic lost response'));
    await expect(submitLeaseTransfer(pending)).rejects.toMatchObject({ certainty: 'unknown' });
    discardUnsentLeaseTransfer(pending);
    const restored = getPendingLeaseTransfers(ACTOR)[0];
    expect(restored.state).toBe('unknown');
    expect(prepareLeaseTransfer(ACTOR, record(), TARGET).requestId).toBe(pending.requestId);
    fetchMock.mockImplementationOnce(async (_url, options) => Response.json(receipt(options!.body as string, { replayed: true })));
    expect((await submitLeaseTransfer(restored)).replayed).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).requestId).toBe(pending.requestId);
    expect(getPendingLeaseTransfers(ACTOR)).toEqual([]);
  });

  it('retains unknown requests after 5xx and malformed successful responses', async () => {
    const pending = prepareLeaseTransfer(ACTOR, record(), TARGET);
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Unavailable' }, { status: 503 }));
    await expect(submitLeaseTransfer(pending)).rejects.toMatchObject({ certainty: 'unknown' });
    fetchMock.mockResolvedValueOnce(Response.json({ success: true, requestId: pending.requestId }));
    await expect(submitLeaseTransfer(getPendingLeaseTransfers(ACTOR)[0])).rejects.toMatchObject({ certainty: 'unknown' });
    expect(getPendingLeaseTransfers(ACTOR)[0].requestId).toBe(pending.requestId);
  });

  it('a first definite rejection clears the request but a later rejection cannot erase an earlier unknown result', async () => {
    let pending = prepareLeaseTransfer(ACTOR, record(), TARGET);
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Record changed' }, { status: 409 }));
    await expect(submitLeaseTransfer(pending)).rejects.toMatchObject({ certainty: 'rejected' });
    expect(getPendingLeaseTransfers(ACTOR)).toEqual([]);
    pending = prepareLeaseTransfer(ACTOR, record(), TARGET);
    fetchMock.mockRejectedValueOnce(new Error('lost response'));
    await expect(submitLeaseTransfer(pending)).rejects.toMatchObject({ certainty: 'unknown' });
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Account disabled' }, { status: 403 }));
    await expect(submitLeaseTransfer(getPendingLeaseTransfers(ACTOR)[0])).rejects.toMatchObject({ certainty: 'unknown' });
    expect(getPendingLeaseTransfers(ACTOR)[0].requestId).toBe(pending.requestId);
  });

  it('does not accept a mismatched receipt as success', async () => {
    const pending = prepareLeaseTransfer(ACTOR, record(), TARGET);
    fetchMock.mockImplementationOnce(async (_url, options) => Response.json(receipt(options!.body as string, { targetUserId: OTHER_ACTOR })));
    await expect(submitLeaseTransfer(pending)).rejects.toMatchObject({ certainty: 'unknown' });
    expect(getPendingLeaseTransfers(ACTOR)[0].requestId).toBe(pending.requestId);
  });

  it('one tab rejection cannot erase a concurrently attempted retry with a lost response', async () => {
    const pending = prepareLeaseTransfer(ACTOR, record(), TARGET);
    let rejectFirst!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { rejectFirst = resolve; }));
    const first = submitLeaseTransfer(pending).catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // A fresh module instance models another tab's independent in-flight map.
    vi.resetModules();
    const secondTab = await import('../leaseTransferService');
    fetchMock.mockRejectedValueOnce(new Error('second tab lost its committed response'));
    await expect(secondTab.submitLeaseTransfer(secondTab.getPendingLeaseTransfers(ACTOR)[0])).rejects.toMatchObject({ certainty: 'unknown' });
    rejectFirst(Response.json({ error: 'first request rejected' }, { status: 403 }));
    expect(await first).toMatchObject({ certainty: 'unknown' });
    expect(getPendingLeaseTransfers(ACTOR)[0].requestId).toBe(pending.requestId);
    expect(getPendingLeaseTransfers(ACTOR)[0].state).toBe('unknown');
  });

  it('treats a request timeout as unknown and retains the original request', async () => {
    vi.useFakeTimers();
    const pending = prepareLeaseTransfer(ACTOR, record(), TARGET);
    fetchMock.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new DOMException('Synthetic abort', 'AbortError')));
    }));
    const outcome = expect(submitLeaseTransfer(pending)).rejects.toMatchObject({ certainty: 'unknown' });
    await vi.advanceTimersByTimeAsync(25_000);
    await outcome;
    expect(getPendingLeaseTransfers(ACTOR)[0].requestId).toBe(pending.requestId);
  });

  it('refuses a changed account before sending and ignores old response after account switch', async () => {
    const pending = prepareLeaseTransfer(ACTOR, record(), TARGET);
    state.actor = OTHER_ACTOR;
    await expect(submitLeaseTransfer(pending)).rejects.toMatchObject({ certainty: 'not-sent' });
    expect(fetchMock).not.toHaveBeenCalled();
    state.actor = ACTOR;
    fetchMock.mockImplementationOnce(async (_url, options) => { state.actor = OTHER_ACTOR; return Response.json(receipt(options!.body as string)); });
    await expect(submitLeaseTransfer(pending)).rejects.toMatchObject({ certainty: 'unknown' });
    expect(getPendingLeaseTransfers(ACTOR)[0].requestId).toBe(pending.requestId);
    expect(getPendingLeaseTransfers(OTHER_ACTOR)).toEqual([]);
  });
});
