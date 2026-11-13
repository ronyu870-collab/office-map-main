import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  loadResult: { data: [] as unknown[], error: null as unknown },
  removeChannel: vi.fn(),
  realtimeHandler: null as null | ((payload: { new: unknown }) => void),
  getNotices: vi.fn(),
  fetch: vi.fn(),
  notificationLoad: vi.fn(),
  notificationUpdate: vi.fn(),
}));

vi.mock('@/src/services/supabaseClient', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({
      data: { session: { access_token: 'synthetic-token', user: { id: '11111111-1111-4111-8111-111111111111' } } },
    })) },
    from: vi.fn((table: string) => {
      if (table === 'messages') {
        return { select: vi.fn(() => ({
          order: vi.fn(() => ({ limit: vi.fn(async () => state.loadResult) })),
        })) };
      }
      if (table === 'message_notifications') {
        return {
          select: vi.fn(() => ({
            is: vi.fn(() => ({
              order: vi.fn(() => ({ limit: state.notificationLoad })),
            })),
          })),
          update: vi.fn(() => ({ in: state.notificationUpdate })),
        };
      }
      throw new Error('Unexpected table: ' + table);
    }),
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
vi.mock('@/src/components/demo', () => ({ MaskedText: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/src/services/apiClient', () => ({ getAllActiveNotices: state.getNotices }));
import { CommunicationBoard } from '@/src/components/CommunicationBoard';
import { NoticeBanner } from '@/src/components/NoticeBanner';

function installFrame() {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
}

describe('market communication on homepage', () => {
  beforeEach(() => {
    state.loadResult = { data: [], error: null };
    state.removeChannel.mockReset();
    state.realtimeHandler = null;
    state.getNotices.mockReset().mockResolvedValue([]);
    state.notificationLoad.mockReset().mockResolvedValue({ data: [], error: null });
    state.notificationUpdate.mockReset().mockResolvedValue({ error: null });
    state.fetch.mockReset().mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') return { ok: true, status: 201, json: async () => ({ id: 42 }) };
      return { ok: true, json: async () => ({ members: [
        { id: '22222222-2222-4222-8222-222222222222', name: '测试同事' },
        { id: '33333333-3333-4333-8333-333333333333', name: '测试经理' },
      ], canMentionEveryone: true }) };
    });
    vi.stubGlobal('fetch', state.fetch);
    window.history.replaceState({}, '', '/');
    installFrame();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(function(this: HTMLElement, options: ScrollToOptions) { this.scrollTop = Number(options.top ?? 0); }),
    });
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const editor = () => screen.getByRole('textbox', { name: '市场交流消息内容' });

  it('allows direct homepage editing; Enter starts newline and Ctrl+Enter sends once', async () => {
    const user = userEvent.setup();
    render(<CommunicationBoard userEmail="me@colliers.com" userName="Me" />);
    await screen.findByText('暂无市场交流');
    expect(screen.queryByRole('dialog', { name: '市场交流' })).not.toBeInTheDocument();
    await user.click(editor());
    await user.type(editor(), '第一行{enter}第二行');
    expect(state.fetch).not.toHaveBeenCalledWith('/api/communication', expect.objectContaining({ method: 'POST' }));
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(state.fetch).toHaveBeenCalledWith('/api/communication', expect.objectContaining({ method: 'POST' })));
    const request = state.fetch.mock.calls.find(call => call[1]?.method === 'POST');
    expect(JSON.parse(String(request?.[1]?.body)).segments.map((part: {text:string}) => part.text).join('')).toContain('第一行');
    await waitFor(() => expect(editor().textContent).toBe('');
  });

  it('replies to an existing message and can retain draft across full-screen transition', async () => {
    state.loadResult.data = [
      { id: 1, user_name: '同事A', user_email: 'a@example.test', content: '初始消息', created_at: '2026-11-11T06:00:00Z' },
    ];
    const user = userEvent.setup();
    render(<CommunicationBoard userEmail="me@colliers.com" userName="Me" />);
    await screen.findByText('初始消息');
    await user.click(screen.getByRole('button', { name: '回复' }));
    expect(screen.getByRole('button', { name: '取消回复' })).toBeInTheDocument();
    await user.type(editor(), '确认');
    await user.click(screen.getByRole('button', { name: /打开市场交流/ }));
    expect(screen.getByRole('dialog', { name: '市场交流' })).toBeInTheDocument();
    expect(editor().textContent).toContain('确认');
    fireEvent.keyDown(editor(), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(state.fetch).toHaveBeenCalledWith('/api/communication', expect.objectContaining({ method: 'POST' })));
    const request = state.fetch.mock.calls.find(call => call[1]?.method === 'POST');
    expect(JSON.parse(String(request?.[1]?.body)).replyToId).toBe(1);
  });

  it('searches actual directory members and publishes selected user and everyone tokens', async () => {
    const user = userEvent.setup();
    render(<CommunicationBoard userEmail="me@colliers.com" userName="Me" />);
    await screen.findByText('暂无市场交流');
    await user.type(editor(), '@测试');
    const chosen = await screen.findByRole('option', { name: '@测试同事' });
    await user.click(chosen);
    expect(editor().textContent).toContain('@测试同事');
    await user.type(editor(), '请看');
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(state.fetch.mock.calls.some(call => call[1]?.method === 'POST')).toBe(true));
    const request = state.fetch.mock.calls.find(call => call[1]?.method === 'POST');
    expect(JSON.parse(String(request?.[1]?.body)).segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ mentionUserId: '22222222-2222-4222-8222-222222222222' }),
    ]));
    await user.type(editor(), '@所');
    await user.click(await screen.findByRole('option', { name: /@所有人/ }));
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(state.fetch.mock.calls.filter(call => call[1]?.method === 'POST').length).toBe(2));
    const last = state.fetch.mock.calls.filter(call => call[1]?.method === 'POST').at(-1);
    expect(JSON.parse(String(last?.[1]?.body)).segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ everyone: true, text: '@所有人' }),
    ]));
  });

  it('retains content when sending fails, and blocks duplicate in-flight request', async () => {
    let resolvePost!: (result: {ok:boolean;status:number;json:()=>Promise<{error?:string}>}) => void;
    state.fetch.mockImplementation(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') return new Promise(resolve => { resolvePost = resolve; });
      return { ok: true, json: async () => ({ members: [], canMentionEveryone: false }) };
    });
    const user = userEvent.setup();
    render(<CommunicationBoard userEmail="me@colliers.com" userName="Me" />);
    await screen.findByText('暂无市场交流');
    await user.type(editor(), '保留内容');
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(state.fetch.mock.calls.filter(call => call[1]?.method === 'POST').length).toBe(1));
    resolvePost({ ok: false, status: 503, json: async () => ({ error: '网络异常' }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('内容已保留');
    expect(editor().textContent).toContain('保留内容');
  });

  it('keeps internal auto-scroll and full-screen escape/history behavior', async () => {
    const historyBack = vi.spyOn(window.history,'back').mockImplementation(() => undefined);
    state.loadResult.data = [{ id: 1, user_name: '同事A', user_email: 'a@example.test', content: '初始消息', created_at: '2026-11-11T06:00:00Z' }];
    const user = userEvent.setup();
    render(<CommunicationBoard userEmail="me@colliers.com" userName="Me" />);
    const viewport = screen.getByRole('region',{name:'市场交流摘要'}).querySelector<HTMLElement>('.overflow-y-auto')!;
    Object.defineProperty(viewport,'scrollHeight',{configurable:true,value:900});
    await screen.findByText('初始消息');
    await waitFor(() => expect(viewport.scrollTop).toBe(900));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /打开市场交流/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(historyBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog',{name:'市场交流'})).not.toBeInTheDocument();
    act(() => state.realtimeHandler?.({new:{id:2,user_name:'同事B',user_email:'b@example.test',content:'最新消息',created_at:'2026-11-11T07:00:00Z'}}));
    expect(await screen.findByText('最新消息')).toBeInTheDocument();
  });

  it('retains system notice failure and manual retry semantics', async () => {
    state.getNotices.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([
      { id: 1, content: '恢复后的公告', updated_at: '2026-08-25T00:00:00Z' },
    ]);
    const user=userEvent.setup();
    render(<NoticeBanner />);
    expect(await screen.findByText('公告暂时无法加载')).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'重试'}));
    expect(await screen.findByText('恢复后的公告')).toBeInTheDocument();
  });
});
