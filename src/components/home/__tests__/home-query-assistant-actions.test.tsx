import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const client = vi.hoisted(() => ({ copy: vi.fn() }));
vi.mock('@/src/services/assistantCopyClient', () => ({ copyAssistantResponse: client.copy }));
import { HomeQueryAssistantActions } from '../HomeQueryAssistantActions';

const scope = { actorId: 'one', effectiveId: 'one', sessionId: 'session', targetId: null };
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const conversationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const message = '**净有效租金**需要结合期间和样本口径理解。';
const clipboard = vi.fn();
const props = { scope, requestId, conversationId, message, internalExport: true };

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
  clipboard.mockResolvedValue(undefined); client.copy.mockResolvedValue({ requestId, conversationId, text: message });
});
afterEach(cleanup);

describe('ordinary assistant copying', () => {
  it('copies the exact archived Markdown only after server approval', async () => {
    render(<HomeQueryAssistantActions {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '复制回答' }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith(message));
    expect(client.copy).toHaveBeenCalledWith(scope, { requestId, conversationId }, expect.any(AbortSignal));
    expect(screen.getByRole('status')).toHaveTextContent('已复制回答');
  });
  it('hides copying without export qualification and rejects changed snapshot text', async () => {
    const view = render(<HomeQueryAssistantActions {...props} internalExport={false} />);
    expect(screen.queryByRole('button', { name: '复制回答' })).toBeNull();
    view.rerender(<HomeQueryAssistantActions {...props} />);
    client.copy.mockResolvedValue({ text: '另一个回答' });
    fireEvent.click(screen.getByRole('button', { name: '复制回答' }));
    await screen.findByText('复制内容与当前回答不一致，请重新打开对话。');
    expect(clipboard).not.toHaveBeenCalled();
  });
  it('does not copy a denied response or a late response after identity changes', async () => {
    client.copy.mockRejectedValueOnce(new Error('当前没有复制权限。'));
    const view = render(<HomeQueryAssistantActions {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '复制回答' }));
    await screen.findByText('当前没有复制权限。');
    let resolve!: (value: unknown) => void;
    client.copy.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    fireEvent.click(screen.getByRole('button', { name: '复制回答' }));
    view.rerender(<HomeQueryAssistantActions {...props} scope={{ ...scope, actorId: 'two', effectiveId: 'two' }} />);
    await act(async () => resolve({ text: message }));
    expect(clipboard).not.toHaveBeenCalled();
  });
  it('offers selectable text only after approval when clipboard access fails', async () => {
    clipboard.mockRejectedValueOnce(new Error('unavailable'));
    render(<HomeQueryAssistantActions {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '复制回答' }));
    const textbox = await screen.findByRole('textbox', { name: '可手动复制的回答' });
    expect(textbox).toHaveValue(message);
    fireEvent.click(screen.getByRole('button', { name: '选择全部文字' }));
    expect(textbox).toHaveFocus();
    expect((textbox as HTMLTextAreaElement).selectionEnd).toBe(message.length);
    const close = screen.getByRole('button', { name: '关闭复制内容' });
    close.focus(); fireEvent.click(close);
    expect(screen.queryByRole('textbox', { name: '可手动复制的回答' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制回答' })).toHaveFocus();
  });
});
