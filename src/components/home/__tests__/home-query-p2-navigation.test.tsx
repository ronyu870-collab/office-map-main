import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAggregateResult } from '@/src/lib/intelligence/query/result';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
import { buildingAnalysisHref, queryReturnHref } from '@/src/lib/intelligence/query/buildingNavigation';
import type { QueryConversation } from '@/src/lib/intelligence/query/conversationProtocol';
import type { HistoryOpened } from '@/src/lib/intelligence/query/historyProtocol';

const client = vi.hoisted(() => ({ capabilities: vi.fn(), submit: vi.fn(), recover: vi.fn(), reportDelivery: vi.fn() }));
const historyClient = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client,
  queryScopeKey: (scope: { actorId: string; effectiveId: string; sessionId: string }) => JSON.stringify(scope) }));
vi.mock('@/src/services/trustedQueryHistoryClient', () => ({ trustedQueryHistoryClient: historyClient }));
import { HomeQuery } from '../HomeQuery';

const scope = { actorId: 'navigation-owner', effectiveId: 'navigation-owner', sessionId: 'current-session', targetId: null };
const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
const conversationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const result = resultViewSchema.parse(buildAggregateResult(fixture(), 'rent'));
const turn = { requestId: ids[0], question: '去年同期呢', submittedAt: '2026-11-15T08:00:00Z', state: 'succeeded' };
const archived: HistoryOpened = { conversation: { id: conversationId, parentRequestId: ids[0], resumeToken: 'verified-current-session-token' },
  title: '原季度分析', turns: [turn], selected: { ...turn, reply: { status: 'ready', requestId: ids[0], result } }, hasMore: false };
type Submission = { question: string; idempotencyKey: string; conversation: QueryConversation; replayRequestId?: string };
const response = (input: Submission, requestId = ids[1]) => ({ status: 'ready', requestId, conversation: input.conversation, result });
async function open() {
  const view = render(<HomeQuery scope={scope} />);
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
  return view;
}
async function openArchived() {
  window.history.replaceState(null, '', queryReturnHref(ids[0]));
  const view = await open();
  await screen.findByRole('region', { name: '查询结果' });
  return view;
}
function send(question: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
}

describe('P2 AI, map and original historical snapshot navigation', () => {
  beforeEach(() => {
    sessionStorage.clear(); window.history.replaceState(null, '', '/'); vi.resetAllMocks();
    client.capabilities.mockResolvedValue({ enabled: true, permissionRevision: 'revision', examples: [] });
    client.reportDelivery.mockResolvedValue(true); historyClient.open.mockResolvedValue(archived);
  });
  afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

  it('brings explicit map IDs into the editable composer and retains them for an idempotent retry', async () => {
    window.history.replaceState(null, '', buildingAnalysisHref(ids, 'compare'));
    client.submit.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ status: 'running', requestId: ids[0] });
    await open();
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('比较选中楼宇最新有数据季度的净有效租金和空置面积'));
    expect(client.submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    await screen.findByText(/网络连接中断/);
    expect(client.submit.mock.calls[0][1]).toMatchObject({ buildingSelection: { ids, intent: 'compare' } });
    fireEvent.click(screen.getByRole('button', { name: '重试本次请求' }));
    await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(2));
    expect(client.submit.mock.calls[1][1]).toEqual(client.submit.mock.calls[0][1]);
  });

  it('opens the original map-linked snapshot without issuing a new query or replacing its period', async () => {
    await openArchived();
    expect(historyClient.open).toHaveBeenCalledWith(scope, { requestId: ids[0], includeTimeline: true }, expect.any(AbortSignal));
    expect(client.submit).not.toHaveBeenCalled(); expect(client.recover).not.toHaveBeenCalled();
    expect(screen.getByText(turn.question)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '查询结果' })).toHaveAttribute('data-result-id', result.resultId);
    expect(JSON.stringify(sessionStorage)).not.toContain(turn.question);
    expect(JSON.stringify(sessionStorage)).not.toContain(archived.conversation.resumeToken);
  });

  it('uses the signed historical parent only for the first continuation then follows the new request', async () => {
    client.submit.mockImplementation(async (_scope, input: Submission) => response(input));
    await openArchived(); send('金融街呢');
    await waitFor(() => expect(client.submit).toHaveBeenCalledOnce());
    expect(client.submit.mock.calls[0][1].conversation).toEqual(archived.conversation);
    await screen.findByRole('region', { name: '查询结果' }); send('最近四季度呢');
    await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(2));
    expect(client.submit.mock.calls[1][1].conversation).toEqual({ id: conversationId, parentRequestId: ids[1] });
  });

  it('explicitly reexecutes the archived plan in a new conversation and preserves that reference on retry', async () => {
    client.submit.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(async (_scope, input: Submission) => response(input));
    await openArchived(); fireEvent.click(await screen.findByText('更多操作')); fireEvent.click(screen.getByRole('button', { name: '重新查询' }));
    await screen.findByText(/网络连接中断/);
    const request = client.submit.mock.calls[0][1];
    expect(request).toEqual({ idempotencyKey: expect.any(String), question: turn.question,
      replayRequestId: ids[0], conversation: { id: expect.any(String) } });
    expect(request.conversation.id).not.toBe(conversationId);
    fireEvent.click(screen.getByRole('button', { name: '重试本次请求' }));
    await screen.findByRole('region', { name: '查询结果' });
    expect(client.submit.mock.calls[1][1]).toEqual(request);
    send('金融街呢'); await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(3));
    expect(client.submit.mock.calls[2][1].conversation).toEqual({ id: request.conversation.id, parentRequestId: ids[1] });
    expect(client.submit.mock.calls[2][1].replayRequestId).toBeUndefined();
  });

  it('falls back to the original permission-checked recovery when conversation metadata is unavailable', async () => {
    historyClient.open.mockRejectedValue(new Error('history metadata unavailable'));
    client.recover.mockResolvedValue(archived.selected.reply);
    await openArchived();
    expect(client.recover).toHaveBeenCalledWith(scope, ids[0], expect.any(AbortSignal));
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('asks to reopen an expired verified history context without revoking independent query access', async () => {
    client.submit.mockResolvedValueOnce({ status: 'failed', reason: 'history_reopen', requestId: ids[1] })
      .mockImplementation(async (_scope, input: Submission) => response(input));
    await openArchived(); send('金融街呢');
    await screen.findByText(/此历史上下文已过期，请重新打开历史记录/);
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(screen.queryByRole('button', { name: '重试本次请求' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '检查状态并恢复结果' })).not.toBeInTheDocument();
    send('2026Q3 CBD净有效租金');
    await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(2));
    expect(client.submit.mock.calls[1][1].conversation).toEqual({ id: expect.any(String) });
    expect(client.submit.mock.calls[1][1].conversation.id).not.toBe(conversationId);
  });

  it('discards a late original-history response after switching verified accounts', async () => {
    let resolve!: (value: HistoryOpened) => void;
    historyClient.open.mockImplementationOnce(() => new Promise(done => { resolve = done; }))
      .mockRejectedValueOnce(new Error('not owner'));
    client.recover.mockResolvedValue({ status: 'denied', error: '不可访问此记录' });
    window.history.replaceState(null, '', queryReturnHref(ids[0]));
    const view = await open(); await waitFor(() => expect(historyClient.open).toHaveBeenCalledOnce());
    view.rerender(<HomeQuery scope={{ ...scope, actorId: 'other', effectiveId: 'other' }} />);
    await waitFor(() => expect(historyClient.open).toHaveBeenCalledTimes(2));
    await act(async () => resolve(archived));
    expect(screen.queryByRole('region', { name: '查询结果' })).not.toBeInTheDocument();
    expect(screen.queryByText(turn.question)).not.toBeInTheDocument();
    expect(client.submit).not.toHaveBeenCalled();
  });
});
