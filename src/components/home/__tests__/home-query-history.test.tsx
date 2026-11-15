import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryOpened, HistoryPage } from '@/src/lib/intelligence/query/historyProtocol';
const client = vi.hoisted(() => ({ list: vi.fn(), open: vi.fn(), change: vi.fn() }));
vi.mock('@/src/services/trustedQueryHistoryClient', () => ({ trustedQueryHistoryClient: client }));
import { HomeQueryHistory } from '../HomeQueryHistory';

const scope = { actorId: 'first', effectiveId: 'first', sessionId: 'session', targetId: null };
const conversationId = '11111111-1111-4111-8111-111111111111', requestId = '22222222-2222-4222-8222-222222222222';
const entry = { conversationId, requestId, title: 'CBD季度分析', latestQuestion: 'CBD净有效租金是多少', updatedAt: '2026-11-15T10:00:00.000Z', archived: false };
const page: HistoryPage = { entries: [entry], hasMore: false, indexing: false, unavailable: 0 };
const opened: HistoryOpened = { title: entry.title, conversation: { id: conversationId, parentRequestId: requestId, resumeToken: 'signed-reference' },
  turns: [{ requestId, question: entry.latestQuestion, state: 'succeeded', submittedAt: entry.updatedAt }],
  selected: { requestId, question: entry.latestQuestion, state: 'succeeded', submittedAt: entry.updatedAt, reply: { requestId, status: 'ready' } }, hasMore: true, nextCursor: 'older' };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

describe('own history mounted input and bounded record lifecycle', () => {
  beforeEach(() => { client.list.mockReset().mockResolvedValue(page); client.open.mockReset().mockResolvedValue(opened); client.change.mockReset().mockResolvedValue(undefined); });
  afterEach(cleanup);
  it('keeps history search focus and caret through pending results, Chinese composition and empty pages', async () => {
    render(<HomeQueryHistory scope={scope} permissionRevision="one" onOpen={() => {}} />);
    await screen.findByText(entry.title); const user = userEvent.setup();
    const input = screen.getByRole('searchbox', { name: '搜索标题或最近问题' }) as HTMLInputElement;
    await user.click(input); await user.type(input, 'C'); expect(input).toHaveFocus();
    await waitFor(() => expect(client.list).toHaveBeenLastCalledWith(scope, expect.objectContaining({ search: 'C' }), expect.any(AbortSignal)));
    expect(input).toHaveFocus(); expect(input).toBeEnabled();
    await user.type(input, 'BD'); input.setSelectionRange(1, 1); await user.keyboard('X');
    expect(input).toHaveValue('CXBD'); expect(input.selectionStart).toBe(2);
    const pending = deferred<HistoryPage>(); client.list.mockReturnValueOnce(pending.promise);
    await user.keyboard('项'); await waitFor(() => expect(client.list).toHaveBeenLastCalledWith(scope, expect.objectContaining({ search: 'CX项BD' }), expect.any(AbortSignal)));
    expect(input).toHaveFocus(); const calls = client.list.mock.calls.length;
    fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: '中文组词' } }); fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    await new Promise(resolve => setTimeout(resolve, 280)); expect(client.list).toHaveBeenCalledTimes(calls); expect(input).toHaveFocus();
    client.list.mockResolvedValue({ ...page, entries: [] }); fireEvent.compositionEnd(input);
    await screen.findByText('本页没有匹配的记录。'); expect(input).toHaveFocus(); expect(input).toHaveValue('中文组词');
    pending.resolve(page); fireEvent.input(input, { target: { value: '中文组词继续' }, inputType: 'insertText', data: '继续' }); expect(input).toHaveValue('中文组词继续'); expect(input).toHaveFocus();
    await user.clear(input); await waitFor(() => expect(client.list).toHaveBeenLastCalledWith(scope, expect.objectContaining({ search: '' }), expect.any(AbortSignal)));
    expect(input).toHaveFocus();
  });
  it('keeps rename editable during IME and preserves the title when save fails', async () => {
    render(<HomeQueryHistory scope={scope} onOpen={() => {}} />); await screen.findByText(entry.title);
    await userEvent.click(screen.getByRole('button', { name: '重命名' }));
    const input = screen.getByRole('textbox', { name: '对话标题' }) as HTMLInputElement;
    const user = userEvent.setup(); await user.click(input); await user.clear(input); await user.type(input, '研究');
    input.setSelectionRange(1, 1); await user.keyboard('季度'); expect(input).toHaveValue('研季度究'); expect(input.selectionStart).toBe(3);
    fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: '研究季度摘要' } }); fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(client.change).not.toHaveBeenCalled(); expect(input).toHaveFocus(); fireEvent.compositionEnd(input);
    expect(input).toHaveValue('研究季度摘要'); expect(input).toHaveFocus();
    client.change.mockRejectedValueOnce(new Error('未保存，请稍后重试。')); await user.click(screen.getByRole('button', { name: '保存标题' }));
    await screen.findByText('未保存，请稍后重试。'); expect(input).toHaveValue('研究季度摘要'); expect(input).toBeEnabled();
  });
  it('opens one archived snapshot and exposes older turns without submitting another query', async () => {
    const onOpen = vi.fn(); render(<HomeQueryHistory scope={scope} onOpen={onOpen} />);
    await userEvent.click(await screen.findByRole('button', { name: '打开对话：CBD季度分析' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(opened));
    expect(screen.getByRole('region', { name: '对话中的提问' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看更早提问' }));
    await waitFor(() => expect(client.open).toHaveBeenLastCalledWith(scope, { conversationId, cursor: 'older' }, expect.any(AbortSignal)));
    expect(client.change).not.toHaveBeenCalled();
  });
  it('clears old account history immediately and ignores delayed results after owner or permission changes', async () => {
    const pending = deferred<HistoryPage>(); client.list.mockReturnValueOnce(pending.promise);
    const view = render(<HomeQueryHistory scope={scope} permissionRevision="one" onOpen={() => {}} />);
    await waitFor(() => expect(client.list).toHaveBeenCalledOnce());
    client.list.mockResolvedValue({ ...page, entries: [] });
    view.rerender(<HomeQueryHistory scope={{ ...scope, actorId: 'second', effectiveId: 'second' }} permissionRevision="two" onOpen={() => {}} />);
    expect(screen.queryByText(entry.title)).not.toBeInTheDocument(); pending.resolve(page);
    await screen.findByText('本页暂无可查看的工作记录。'); expect(screen.queryByText(entry.title)).not.toBeInTheDocument();
    expect(client.list.mock.calls[0][2].aborted).toBe(true);
  });
  it('keeps only one page mounted and exposes archive recovery and unfinished legacy indexing', async () => {
    client.list.mockResolvedValue({ ...page, hasMore: true, nextCursor: 'page-two', indexing: true });
    render(<HomeQueryHistory scope={scope} onOpen={() => {}} />); await screen.findByText(entry.title);
    client.list.mockResolvedValue({ ...page, entries: [{ ...entry, title: '第二页工作' }], indexing: false });
    await userEvent.click(screen.getByRole('button', { name: '下一页记录' })); await screen.findByText('第二页工作');
    expect(screen.queryByText(entry.title)).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: '上一页记录' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '归档' }));
    await waitFor(() => expect(client.change).toHaveBeenCalledWith(scope, { action: 'archive', conversationId, archived: true }, expect.any(AbortSignal)));
  });
});
