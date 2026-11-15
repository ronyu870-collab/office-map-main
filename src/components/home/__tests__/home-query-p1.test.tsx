import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAggregateResult } from '@/src/lib/intelligence/query/result';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';

const client = vi.hoisted(() => ({ capabilities: vi.fn(), submit: vi.fn(), recover: vi.fn(), chart: vi.fn(), download: vi.fn(), reportDelivery: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({
  trustedQueryClient: client,
  queryScopeKey: (scope: { actorId: string; effectiveId: string; sessionId: string; targetId: string | null }) => JSON.stringify([scope.actorId, scope.effectiveId, scope.sessionId, scope.targetId]),
}));
import { HomeQuery } from '../HomeQuery';

const scope = { actorId: 'p1', effectiveId: 'p1', sessionId: 'session-one', targetId: null };
const requestIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
const access = { enabled: true, permissionRevision: 'one', examples: ['2026Q3 CBD净有效租金'] };
type Submission = { idempotencyKey: string; question: string; conversation: { id: string; parentRequestId?: string } };
function response(input: Submission, index: number, suggestions: { id: string; label: string; question: string }[] = []) {
  const result = buildAggregateResult(fixture(), 'rent');
  return { status: 'ready', requestId: requestIds[index], conversation: input.conversation,
    result: { ...result, parameters: { ...result.parameters, suggestions } } };
}
async function open() {
  const view = render(<HomeQuery scope={scope} />);
  const input = screen.getByRole('textbox');
  await waitFor(() => expect(input).toBeEnabled());
  return { view, input };
}
function send(input: HTMLElement, question: string) {
  fireEvent.change(input, { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
}
describe('homepage AI P1 structured conversation and request ownership', () => {
  beforeEach(() => {
    sessionStorage.clear(); vi.resetAllMocks();
    client.capabilities.mockResolvedValue(access); client.reportDelivery.mockResolvedValue(true);
  });
  afterEach(cleanup);

  it('T01/T02 sends only one conversation reference and the confirmed parent for each follow-up', async () => {
    client.submit.mockImplementation(async (_scope, input: Submission) => response(input, client.submit.mock.calls.length - 1));
    const { input } = await open();
    send(input, '2026年第三季度CBD净有效租金是多少'); await screen.findByRole('region', { name: '查询结果' });
    send(input, '金融街呢'); await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(2)); await screen.findByRole('region', { name: '查询结果' });
    send(input, '把两者比较一下'); await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(3));
    const [first, second, third] = client.submit.mock.calls.map(call => call[1] as Submission);
    expect(first.conversation).toEqual({ id: expect.any(String) });
    expect(second.conversation).toEqual({ id: first.conversation.id, parentRequestId: requestIds[0] });
    expect(third.conversation).toEqual({ id: first.conversation.id, parentRequestId: requestIds[1] });
    expect(Object.keys(third).sort()).toEqual(['conversation', 'idempotencyKey', 'question']);
    expect(JSON.stringify(sessionStorage)).not.toContain(first.conversation.id);
    expect(JSON.stringify(sessionStorage)).not.toContain('净有效租金');
  });

  it('T04 sends a server clarification option with its parent while preserving a newly typed draft', async () => {
    client.submit.mockImplementationOnce(async (_scope, input: Submission) => ({ status: 'clarification', requestId: requestIds[0], conversation: input.conversation,
      message: '最贵指哪个指标？', options: [{ id: 'rent', label: '净有效租金', question: '按净有效租金比较' }] }))
      .mockImplementationOnce(async (_scope, input: Submission) => response(input, 1));
    const { input } = await open(); send(input, 'CBD最贵的楼');
    const option = await screen.findByRole('button', { name: '净有效租金' });
    fireEvent.change(input, { target: { value: '保留这条草稿' } }); fireEvent.click(option);
    await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(2));
    expect(client.submit.mock.calls[1][1]).toMatchObject({ question: '按净有效租金比较', conversation: { parentRequestId: requestIds[0] } });
    expect(input).toHaveValue('保留这条草稿');
  });

  it('T12/T13 retains the original context and nonce during a retry and never overwrites a pending draft', async () => {
    let resolve!: (value: unknown) => void;
    client.submit.mockImplementationOnce(async (_scope, input: Submission) => response(input, 0))
      .mockRejectedValueOnce(new Error('network lost'))
      .mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { input } = await open(); send(input, '2026Q3 CBD租金'); await screen.findByRole('region', { name: '查询结果' });
    send(input, '金融街呢'); await screen.findByText(/未能取得查询响应/);
    fireEvent.change(input, { target: { value: '下一条尚未发送' } });
    fireEvent.click(screen.getByRole('button', { name: '重试本次请求' }));
    expect(client.submit.mock.calls[2][1]).toEqual(client.submit.mock.calls[1][1]);
    expect(client.submit.mock.calls[2][1].conversation.parentRequestId).toBe(requestIds[0]);
    await act(async () => resolve(response(client.submit.mock.calls[2][1], 1)));
    expect(input).toHaveValue('下一条尚未发送');
  });

  it('T14 uses the suggestion source request and does not replace the user draft', async () => {
    const suggestions = [{ id: 'trend', label: '查看过去四季度变化', question: '最近四季度变化' }];
    client.submit.mockImplementationOnce(async (_scope, input: Submission) => response(input, 0, suggestions))
      .mockImplementationOnce(async (_scope, input: Submission) => response(input, 1));
    const { input } = await open(); send(input, '2026Q3 CBD租金');
    const suggestion = await screen.findByRole('button', { name: '查看过去四季度变化' });
    fireEvent.change(input, { target: { value: '尚未发送的其他问题' } }); fireEvent.click(suggestion);
    await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(2));
    expect(client.submit.mock.calls[1][1]).toMatchObject({ question: '最近四季度变化', conversation: { parentRequestId: requestIds[0] } });
    expect(input).toHaveValue('尚未发送的其他问题');
  });

  it('keeps a historical suggestion bound to that earlier answer when another turn is current', async () => {
    const action = { id: 'trend', label: '查看当时的四季度变化', question: '最近四季度变化' };
    client.submit.mockImplementationOnce(async (_scope, input: Submission) => response(input, 0, [action]))
      .mockImplementationOnce(async (_scope, input: Submission) => response(input, 1))
      .mockImplementationOnce(async (_scope, input: Submission) => response(input, 2));
    const { input } = await open(); send(input, '2026Q3 CBD租金'); await screen.findByRole('button', { name: action.label });
    send(input, '金融街呢'); await screen.findByRole('region', { name: '查询结果' });
    fireEvent.click(screen.getByText('Colliers AI · 查看此前回答'));
    fireEvent.click(await screen.findByRole('button', { name: action.label }));
    await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(3));
    expect(client.submit.mock.calls[2][1].conversation.parentRequestId).toBe(requestIds[0]);
  });

  it('does not import another conversation when restoring an earlier saved result', async () => {
    sessionStorage.setItem(`trusted-query:last:${JSON.stringify([scope.actorId, scope.effectiveId, scope.sessionId, scope.targetId])}`, requestIds[0]);
    const oldInput = { idempotencyKey: requestIds[2], question: '旧页问题', conversation: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } };
    client.recover.mockResolvedValue(response(oldInput, 0, [{ id: 'trend', label: '旧对话建议', question: '最近四季度' }]));
    client.submit.mockImplementationOnce(async (_scope, input: Submission) => response(input, 1));
    const { input } = await open(); fireEvent.click(await screen.findByRole('button', { name: '检查状态并恢复结果' }));
    await screen.findByRole('region', { name: '查询结果' });
    expect(screen.queryByRole('button', { name: '旧对话建议' })).not.toBeInTheDocument();
    send(input, '2026Q2 CBD租金'); await waitFor(() => expect(client.submit).toHaveBeenCalledOnce());
    expect(client.submit.mock.calls[0][1].conversation).toEqual({ id: expect.any(String) });
    expect(client.submit.mock.calls[0][1].conversation.id).not.toBe(oldInput.conversation.id);
  });

  it('starts a separate conversation without inheriting the previous conditions or discarding a draft', async () => {
    client.submit.mockImplementation(async (_scope, input: Submission) => response(input, client.submit.mock.calls.length - 1));
    const { input } = await open(); send(input, '2026Q3 CBD租金'); await screen.findByRole('region', { name: '查询结果' });
    fireEvent.change(input, { target: { value: '全新问题' } });
    fireEvent.click(screen.getByRole('button', { name: '新对话' }));
    expect(screen.queryByText('2026Q3 CBD租金')).not.toBeInTheDocument(); expect(input).toHaveValue('全新问题');
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(2));
    expect(client.submit.mock.calls[1][1].conversation).toEqual({ id: expect.any(String) });
    expect(client.submit.mock.calls[1][1].conversation.id).not.toBe(client.submit.mock.calls[0][1].conversation.id);
  });

  it.each([
    { ...scope, actorId: 'other', effectiveId: 'other' },
    { ...scope, sessionId: 'session-two' },
    { ...scope, effectiveId: 'simulated', targetId: 'simulated' },
  ])('T11 isolates identity/session %j, including delayed requests', async nextScope => {
    let resolve!: (value: unknown) => void;
    client.submit.mockImplementationOnce(async (_scope, input: Submission) => response(input, 0))
      .mockImplementationOnce(() => new Promise(done => { resolve = done; }))
      .mockImplementationOnce(async (_scope, input: Submission) => response(input, 2));
    const { input, view } = await open(); send(input, '旧身份结果'); await screen.findByRole('region', { name: '查询结果' });
    send(input, '旧身份在途问题'); const pendingInput = client.submit.mock.calls[1][1];
    view.rerender(<HomeQuery scope={nextScope} />); const freshInput = screen.getByRole('textbox'); await waitFor(() => expect(freshInput).toBeEnabled());
    await act(async () => resolve(response(pendingInput, 1)));
    expect(screen.queryByRole('region', { name: '查询结果' })).not.toBeInTheDocument(); expect(freshInput).toHaveValue('');
    expect(screen.queryByText('旧身份结果')).not.toBeInTheDocument();
    send(freshInput, '新的独立查询'); await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(3));
    expect(client.submit.mock.calls[2][1].conversation).toEqual({ id: expect.any(String) });
    expect(client.submit.mock.calls[2][1].conversation.id).not.toBe(client.submit.mock.calls[0][1].conversation.id);
  });

  it('T11 clears drafts, history, recovery and context when capability verification fails', async () => {
    client.submit.mockImplementationOnce(async (_scope, input: Submission) => response(input, 0));
    const { input } = await open(); send(input, '待清除的问题'); await screen.findByRole('region', { name: '查询结果' });
    fireEvent.change(input, { target: { value: '敏感草稿' } }); client.capabilities.mockRejectedValue(new Error('offline')); fireEvent.focus(window);
    await waitFor(() => expect(input).toBeDisabled()); expect(input).toHaveValue('');
    expect(screen.queryByText('待清除的问题')).not.toBeInTheDocument(); expect(sessionStorage.length).toBe(0);
    client.capabilities.mockResolvedValue(access); fireEvent.focus(window); await waitFor(() => expect(input).toBeEnabled());
    client.submit.mockImplementationOnce(async (_scope, submitted: Submission) => response(submitted, 1)); send(input, '重新独立查询');
    await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(2));
    expect(client.submit.mock.calls[1][1].conversation).toEqual({ id: expect.any(String) });
    expect(client.submit.mock.calls[1][1].conversation.id).not.toBe(client.submit.mock.calls[0][1].conversation.id);
  });

  it('T11 clears visible old answers immediately on a denied response', async () => {
    client.submit.mockImplementationOnce(async (_scope, input: Submission) => response(input, 0))
      .mockResolvedValueOnce({ status: 'denied', error: '当前查询已无权限。' });
    const { input } = await open(); send(input, '旧的可见答案'); await screen.findByRole('region', { name: '查询结果' });
    send(input, '撤权后的问题'); await waitFor(() => expect(input).toBeDisabled());
    expect(screen.queryByText('旧的可见答案')).not.toBeInTheDocument(); expect(screen.queryByText('撤权后的问题')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '查询结果' })).not.toBeInTheDocument(); expect(sessionStorage.length).toBe(0);
  });
});
