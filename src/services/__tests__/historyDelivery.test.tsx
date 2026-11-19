import * as React from 'react';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAggregateResult } from '@/src/lib/intelligence/query/result';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import type { HistoryOpened, HistorySnapshot } from '@/src/lib/intelligence/query/historyProtocol';

const state = vi.hoisted(() => ({ append: vi.fn(), receive: vi.fn(), open: vi.fn(), recheck: vi.fn() }));
const identity = { actorId: '11111111-1111-4111-8111-111111111111', effectiveUserId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222', expiresAt: Date.now() + 600000 };
const scope = { actorId: identity.actorId, effectiveId: identity.effectiveUserId, sessionId: identity.sessionId, targetId: null };
const keys = { keyId: 'history-delivery-fixture', encryptionKey: new Uint8Array(32).fill(1), digestKey: new Uint8Array(32).fill(2) };
vi.mock('@/src/services/impersonationHeaders', () => ({ getImpersonationTargetUserId: () => null,
  withImpersonationHeaders: (headers: HeadersInit) => new Headers(headers) }));
vi.mock('@/src/lib/intelligence/query/serverAuthority', () => ({ verifyQueryIdentity: async () => identity,
  loadDataAuthority: async () => ({ ...identity, sessionActive: true, grants: ['query:catalog'], fields: [],
    policyVersion: 'fixture', permissionRevision: 'a'.repeat(64) }) }));
vi.mock('@/src/lib/intelligence/query/auditStore', () => ({ createRpcAuditPort: () => ({ receive: state.receive, append: state.append }) }));
vi.mock('@/src/lib/intelligence/query/intake', () => ({ recordQueryIntake: async () => undefined }));
vi.mock('@/src/lib/intelligence/query/historyStore', () => ({ openOwnHistory: (...args: unknown[]) => state.open(...args),
  listOwnHistory: vi.fn(), changeOwnHistory: vi.fn() }));
import { handleOwnHistory } from '@/src/lib/intelligence/query/historyHttp';
import { handleDeliveryReport } from '@/src/lib/intelligence/query/deliveryHttp';
import { verifyDeliveryToken } from '@/src/lib/intelligence/query/deliveryToken';
import { trustedQueryHistoryClient } from '../trustedQueryHistoryClient';
import { trustedQueryClient } from '../trustedQueryClient';
import * as Auth from '@/src/services/Auth';
import { HomeQueryResult } from '@/src/components/home/HomeQueryResult';

const dependencies = { client: {} as SupabaseClient, keys, enabled: true };
function historyFixture(conversationId = randomUUID()): HistoryOpened {
  const conversation = { id: conversationId };
  const turns: HistorySnapshot[] = [2, 3].map(quarter => {
    const requestId = randomUUID();
    const result = resultViewSchema.parse(buildAggregateResult(fixture({ year: 2026, quarter }), 'rent'));
    return { requestId, question: `第${quarter}季度租金`, submittedAt: new Date(Date.UTC(2026, quarter, 1)).toISOString(), state: 'succeeded',
      reply: { requestId, status: 'ready', conversation, result } };
  });
  return { conversation, title: '租金比较', turns: turns.map(({ requestId, question, submittedAt, state }) => ({ requestId, question, submittedAt, state })),
    selected: turns[1], timeline: turns, hasMore: false };
}
function mockTransport(tamper?: (body: { opened: HistoryOpened }) => void) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const request = new Request(`http://localhost${url}`, init);
    if (url.endsWith('/receipt')) return handleDeliveryReport(request, dependencies);
    if (!url.endsWith('/history')) throw new Error(`Unexpected endpoint: ${url}`);
    const response = await handleOwnHistory(request, dependencies);
    if (!tamper) return response;
    const body = await response.json();
    tamper(body);
    const serialized = JSON.stringify(body), headers = new Headers(response.headers);
    headers.set('x-query-body-sha256', createHash('sha256').update(serialized).digest('hex'));
    return new Response(serialized, { headers, status: response.status });
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('history timeline delivery through the real HTTP and client receipt paths', () => {
  beforeEach(() => {
    // Keep concurrent dynamic Auth imports on the same explicit session stub.
    vi.spyOn(Auth, 'getSessionFast').mockResolvedValue({ user: { id: identity.effectiveUserId }, sessionId: identity.sessionId,
      session: { user: { id: identity.actorId }, access_token: 'synthetic' } } as Awaited<ReturnType<typeof Auth.getSessionFast>>);
    vi.stubGlobal('crypto', webcrypto); state.append.mockReset().mockResolvedValue(undefined);
    state.receive.mockReset().mockResolvedValue({ replayed: false }); state.recheck.mockReset().mockResolvedValue(undefined);
    state.open.mockReset().mockImplementation(async (_context, input) => ({ opened: historyFixture(input.conversationId), recheck: state.recheck }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('binds each saved result to its own token, then reports its actual DOM and source selection', async () => {
    mockTransport();
    const opened = await trustedQueryHistoryClient.open(scope, { conversationId: randomUUID(), includeTimeline: true }, new AbortController().signal);
    const older = opened.timeline![0], selected = opened.selected;
    const reported = await trustedQueryClient.reportDelivery(scope, older.reply, 'client_dom_committed',
      { surface: 'answer_table', page: 0, pageSize: 25, sourceIds: [] });
    expect(reported).toBe(true);
    expect(await trustedQueryClient.reportDelivery(scope, selected.reply, 'client_dom_committed',
      { surface: 'answer_table', page: 0, pageSize: 25, sourceIds: [] })).toBe(true);
    // JSON/Zod create distinct objects for selected and the same timeline turn;
    // both may be retained by the workspace and need the identical valid receipt.
    const timelineSelected = opened.timeline!.find(turn => turn.requestId === selected.requestId)!;
    expect(timelineSelected.reply).not.toBe(selected.reply);
    expect(await trustedQueryClient.reportDelivery(scope, timelineSelected.reply, 'client_dom_committed',
      { surface: 'answer_table', page: 0, pageSize: 25, sourceIds: [] })).toBe(true);
    await waitFor(() => expect(state.append.mock.calls.filter(call => call[1] === 'delivery_receipt'
      && call[2].phase === 'client_received')).toHaveLength(3));
    expect(new Set(state.append.mock.calls.filter(call => call[1] === 'delivery_receipt' && call[2].phase === 'client_received')
      .map(call => call[2].delivery.resultId))).toEqual(new Set([null, older.reply.result!.resultId, selected.reply.result!.resultId]));
    const prepared = state.append.mock.calls.filter(call => call[1] === 'delivery_receipt' && call[2].surface === 'history_snapshot');
    expect(prepared).toHaveLength(2);
    expect(new Set(prepared.map(call => call[2].sourceRequestId))).toEqual(new Set([older.requestId, selected.requestId]));
    for (const snapshot of [older, selected]) {
      const entry = prepared.find(call => call[2].sourceRequestId === snapshot.requestId)![2];
      expect(entry.delivery.resultId).toBe(snapshot.reply.result!.resultId);
      expect(entry.delivery.itemCount).toBe(snapshot.reply.result!.table.rows.length);
    }
    const priorDomReceipts = state.append.mock.calls.filter(call => call[1] === 'delivery_receipt'
      && call[2].phase === 'client_dom_committed' && call[2].delivery.resultId === older.reply.result!.resultId).length;
    render(<HomeQueryResult result={older.reply.result!} delivery={older.reply} scope={scope} />);
    await waitFor(() => expect(state.append.mock.calls.filter(call => call[1] === 'delivery_receipt'
      && call[2].phase === 'client_dom_committed' && call[2].delivery.resultId === older.reply.result!.resultId)).toHaveLength(priorDomReceipts + 1));
    fireEvent.click(screen.getByRole('button', { name: /^查看来源：面积加权/ }));
    await waitFor(() => expect(state.append.mock.calls.some(call => call[1] === 'delivery_receipt'
      && call[2].phase === 'client_dom_committed' && call[2].delivery.resultId === older.reply.result!.resultId
      && call[2].view?.sourceIds.length > 0)).toBe(true));
    expect(state.recheck).toHaveBeenCalledOnce();
  });

  it('rejects a nested receipt swapped between two snapshots before displaying either', async () => {
    mockTransport(body => {
      const [older, newer] = body.opened.timeline!;
      [older.delivery, newer.delivery] = [newer.delivery, older.delivery];
    });
    await expect(trustedQueryHistoryClient.open(scope, { conversationId: randomUUID(), includeTimeline: true }, new AbortController().signal)).rejects.toThrow(/交付校验/);
    expect(state.append.mock.calls.some(call => call[1] === 'delivery_receipt' && call[2].phase === 'client_received')).toBe(false);
  });

  it('keeps an envelope receipt separate from its per-result page bounds', async () => {
    let wire: HistoryOpened | undefined;
    mockTransport(body => { wire = body.opened; });
    const opened = await trustedQueryHistoryClient.open(scope, { conversationId: randomUUID(), includeTimeline: true }, new AbortController().signal);
    const token = wire!.timeline![0].delivery!;
    const claims = verifyDeliveryToken(token.deliveryToken, keys, identity);
    expect(claims.resultId).toBe(opened.timeline![0].reply.result!.resultId);
    expect(claims.itemCount).toBe(1);
    expect(await trustedQueryClient.reportDelivery(scope, opened.timeline![0].reply, 'client_dom_committed',
      { surface: 'answer_table', page: 1, pageSize: 25, sourceIds: [] })).toBe(false);
  });
});
