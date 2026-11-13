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
      const name = new URL(url, 'https://synthetic.invalid').searchParams.get('name');
      return { ok: true, json: async () => ({
        members: name === 'alice' ? [{ id: '22222222-2222-4222-8222-222222222222', name: 'Alice Wang' }]
          : name === '所有人' ? [{ id: '__everyone__', name: '所有人' }] : [],
      }) };
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
    await waitFor(() => expect(editor().textContent).toBe(''));
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

  it('keeps bare @ and partial names ordinary text, showing only a completed English first-name match', async () => {
    const user = userEvent.setup();
    render(<CommunicationBoard userEmail="me@colliers.com" userName="Me" />);
    await screen.findByText('暂无市场交流');
    await user.type(editor(), '@');
    expect(screen.queryByRole('listbox', { name: '匹配的提及成员' })).not.toBeInTheDocument();
    expect(state.fetch.mock.calls.some(call => String(call[0]).includes('name='))).toBe(false);
    await user.type(editor(), 'Ali');
    await new Promise(resolve => setTimeout(resolve, 240));
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    const sentQueries = state.fetch.mock.calls.filter(call => String(call[0]).includes('?name='));
    expect(sentQueries.every(call => String(call[0]).includes('name=ali'))).toBe(true);
    await user.type(editor(), 'ce');
    const chosen = await screen.findByRole('option', { name: '@Alice Wang' });
    expect(editor()).toHaveFocus();
    await user.click(chosen);
    expect(editor().textContent).toContain('@Alice Wang');
    await user.type(editor(), '请看');
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(state.fetch.mock.calls.some(call => call[1]?.method === 'POST')).toBe(true));
    const post = state.fetch.mock.calls.find(call => call[1]?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body)).segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: '@Alice Wang', mentionUserId: '22222222-2222-4222-8222-222222222222' }),
    ]));
    expect(state.fetch.mock.calls.some(call => String(call[0]) === '/api/communication' && !call[1]?.method)).toBe(false);
  });

  it('treats typed @alice as plain content until a suggestion is explicitly selected', async () => {
    const user = userEvent.setup();
    render(<CommunicationBoard userEmail="me@colliers.com" userName="Me" />);
    await screen.findByText('暂无市场交流');
    await user.type(editor(), '@alice');
    await screen.findByRole('option', { name: '@Alice Wang' });
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(state.fetch.mock.calls.some(call => call[1]?.method === 'POST')).toBe(true));
    const post = state.fetch.mock.calls.find(call => call[1]?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body)).segments).toEqual([{ text: '@alice' }]);
  });

  it('never resurfaces a stale member after the user changes an @ name', async () => {
    let releaseAlice!: () => void;
    state.fetch.mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ id: 42 }) });
      if (url.includes('name=alice')) {
        return new Promise(resolve => {
          releaseAlice = () => resolve({ ok: true, json: async () => ({
            members: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Alice Wang' }],
          }) });
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ members: [] }) });
    });
    const user = userEvent.setup();
    render(<CommunicationBoard userEmail="me@colliers.com" userName="Me" />);
    await screen.findByText('暂无市场交流');
    await user.type(editor(), '@Alice');
    await waitFor(() => expect(state.fetch.mock.calls.some(call => String(call[0]).includes('name=alice'))).toBe(true));
    await user.type(editor(), '{backspace}{backspace}{backspace}');
    expect(editor().textContent).toBe('@Al');
    await act(async () => { releaseAlice(); });
    expect(screen.queryByRole('option', { name: '@Alice Wang' })).not.toBeInTheDocument();
  });

  it('never suggests administrators broadcast until the full @所有人 token is entered', async () => {
    const user = userEvent.setup();
    render(<CommunicationBoard userEmail="me@colliers.com" userName="Me" />);
    await screen.findByText('暂无市场交流');
    await user.type(editor(), '@所');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    await user.type(editor(), '有人');
    await user.click(await screen.findByRole('option', { name: /@所有人/ }));
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(state.fetch.mock.calls.filter(call => call[1]?.method === 'POST').length).toBe(1));
    const post = state.fetch.mock.calls.find(call => call[1]?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body)).segments).toEqual([
      expect.objectContaining({ everyone: true, text: '@所有人' }),
    ]);
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
