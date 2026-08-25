import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  loadResult: { data: [] as unknown[], error: null as unknown },
  insert: vi.fn(),
  removeChannel: vi.fn(),
  logAction: vi.fn(),
  realtimeHandler: null as null | ((payload: { new: unknown }) => void),
  getNotices: vi.fn(),
}));

vi.mock('@/src/services/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(async () => state.loadResult),
        })),
      })),
      insert: state.insert,
    })),
    channel: vi.fn(() => {
      const channel = {
        on: vi.fn((_event: string, _filter: unknown, handler: (payload: { new: unknown }) => void) => {
          state.realtimeHandler = handler;
          return channel;
        }),
        subscribe: vi.fn(() => channel),
      };
      return channel;
    }),
    removeChannel: state.removeChannel,
  },
}));

vi.mock('@/src/utils/audit', () => ({ logAction: state.logAction }));
vi.mock('@/src/components/demo', () => ({ MaskedText: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/src/services/apiClient', () => ({ getAllActiveNotices: state.getNotices }));

import { CommunicationBoard } from '@/src/components/CommunicationBoard';
import { NoticeBanner } from '@/src/components/NoticeBanner';

function installAnimationFrame() {
  let nextId = 1;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextId++;
    const timer = setTimeout(() => callback(performance.now()), 0);
    timers.set(id, timer);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
  });
}

describe('Home collaboration behavior', () => {
  beforeEach(() => {
    state.loadResult = { data: [], error: null };
    state.insert.mockReset();
    state.insert.mockResolvedValue({ error: null });
    state.removeChannel.mockReset();
    state.logAction.mockReset();
    state.realtimeHandler = null;
    state.getNotices.mockReset();
    state.getNotices.mockResolvedValue([]);
    window.history.replaceState({}, '', '/');
    installAnimationFrame();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps failed send content and does not emit an audit event', async () => {
    state.insert.mockResolvedValue({ error: new Error('network') });
    const user = userEvent.setup();
    render(<CommunicationBoard userEmail="me@colliers.com" userName="Me" />);

    await screen.findByText('暂无市场交流');
    await user.click(screen.getByRole('button', { name: /打开市场交流/ }));
    const input = screen.getByPlaceholderText('分享市场动态…');
    await user.type(input, '保留这条消息{enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('发送失败，内容已保留，请重试。');
    expect(input).toHaveValue('保留这条消息');
    expect(state.insert).toHaveBeenCalledTimes(1);
    expect(state.logAction).not.toHaveBeenCalled();
  });

  it('submits Enter once and emits one audit event after success', async () => {
    const user = userEvent.setup();
    render(<CommunicationBoard userEmail="me@colliers.com" userName="Me" />);

    await screen.findByText('暂无市场交流');
    await user.click(screen.getByRole('button', { name: /打开市场交流/ }));
    const input = screen.getByPlaceholderText('分享市场动态…');
    await user.type(input, '单次发送{enter}');

    await waitFor(() => expect(state.insert).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(state.logAction).toHaveBeenCalledTimes(1));
    expect(state.logAction).toHaveBeenCalledWith('me@colliers.com', 'POST_MESSAGE', { content: '单次发送' });
    expect(input).toHaveValue('');
  });

  it('blocks same-frame duplicate form submission until the first send resolves', async () => {
    let resolveInsert!: (value: { error: null }) => void;
    const pendingInsert = new Promise<{ error: null }>((resolve) => {
      resolveInsert = resolve;
    });
    state.insert.mockReturnValue(pendingInsert);
    const user = userEvent.setup();
    render(<CommunicationBoard userEmail="me@colliers.com" userName="Me" />);

    await screen.findByText('暂无市场交流');
    await user.click(screen.getByRole('button', { name: /打开市场交流/ }));
    const input = screen.getByPlaceholderText('分享市场动态…');
    await user.type(input, '快速发送');
    const form = input.closest('form');
    expect(form).not.toBeNull();

    fireEvent.submit(form!);
    fireEvent.submit(form!);
    expect(state.insert).toHaveBeenCalledTimes(1);

    resolveInsert({ error: null });
    await waitFor(() => expect(state.logAction).toHaveBeenCalledTimes(1));
  });

  it('closes fullscreen with Escape or Back state and restores it with Forward state', async () => {
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const { unmount } = render(<CommunicationBoard userEmail="me@colliers.com" userName="Me" />);

    await screen.findByText('暂无市场交流');
    await user.click(screen.getByRole('button', { name: /打开市场交流/ }));
    expect(screen.getByRole('dialog', { name: '市场交流' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(historyBack).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '市场交流' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: /打开市场交流/ })).toHaveFocus());

    await user.click(screen.getByRole('button', { name: /打开市场交流/ }));
    fireEvent(window, new PopStateEvent('popstate', { state: {} }));
    expect(screen.queryByRole('dialog', { name: '市场交流' })).not.toBeInTheDocument();

    fireEvent(window, new PopStateEvent('popstate', { state: { __colliersCommunicationFullscreen: true } }));
    expect(screen.getByRole('dialog', { name: '市场交流' })).toBeInTheDocument();

    unmount();
    expect(state.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('renders a distinct notice error state and retries successfully', async () => {
    state.getNotices.mockRejectedValueOnce(new Error('offline'));
    state.getNotices.mockResolvedValueOnce([
      { id: 1, content: '恢复后的公告', updated_at: '2026-08-25T00:00:00Z' },
    ]);
    const user = userEvent.setup();
    render(<NoticeBanner />);

    expect(await screen.findByText('公告暂时无法加载')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('恢复后的公告')).toBeInTheDocument();
    expect(state.getNotices).toHaveBeenCalledTimes(2);
  });
});
