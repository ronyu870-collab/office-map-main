import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ capabilities: vi.fn(), submit: vi.fn(), submitAgent: vi.fn(), submitAgentStream: vi.fn(), recover: vi.fn(), reportDelivery: vi.fn() }));
const historyClient = vi.hoisted(() => ({ list: vi.fn(), open: vi.fn(), change: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client, queryScopeKey: () => 'polish-owner' }));
vi.mock('@/src/services/trustedQueryHistoryClient', () => ({ trustedQueryHistoryClient: historyClient }));
import { HomeQuery } from '../HomeQuery';

const scope = { actorId: 'owner', effectiveId: 'owner', sessionId: 'session', targetId: null };
const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
const conversationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const access = { enabled: true, examples: [], permissionRevision: 'one', agentEnabled: true };
const entry = { conversationId, requestId: ids[1], title: '市场研究', latestQuestion: '第二个问题', updatedAt: '2026-11-19T10:00:00.000Z', archived: false };
function snapshot(index: number) {
  return { requestId: ids[index], question: ['第一个问题', '第二个问题', '更早的问题'][index], state: 'succeeded', submittedAt: `2026-11-${18 + index}T10:00:00.000Z`,
    reply: { requestId: ids[index], status: 'assistant', isNativeAgent: true, message: `**历史重点${index + 1}**`, conversation: { id: conversationId } } };
}
function opened() {
  return { title: entry.title, conversation: { id: conversationId, parentRequestId: ids[1], resumeToken: 'original-resume-token' },
    selected: snapshot(1), turns: [snapshot(1), snapshot(0)], timeline: [snapshot(0), snapshot(1)], hasMore: true, nextCursor: 'older' };
}
async function open() {
  const view = render(<HomeQuery scope={scope} />);
  const input = screen.getByRole('textbox', { name: '向 Colliers AI 提问' });
  await waitFor(() => expect(input).toBeEnabled());
  return { ...view, input };
}
function send(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
}
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear();
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('min-width') || query.includes('reduced-motion'), media: query,
    onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })));
  client.capabilities.mockResolvedValue(access); client.reportDelivery.mockResolvedValue(true);
  historyClient.list.mockResolvedValue({ entries: [entry], hasMore: false, indexing: false, unavailable: 0 });
  historyClient.open.mockResolvedValue(opened());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AI experience regression fixes', () => {
  it('renders actual emphasis for a completed answer and keeps the same formatting in earlier turns', async () => {
    client.submitAgent.mockImplementation(async (_scope, body) => ({ requestId: ids[0], status: 'assistant', message: '**重点结论**\n\n- 第一项\n- 第二项', conversation: body.conversation }));
    const { input } = await open(); send(input, '市场怎么样');
    const strong = await screen.findByText('重点结论');
    expect(strong.tagName).toBe('STRONG');
    expect(screen.queryByText('回复完成。')).not.toBeInTheDocument();
    client.submitAgent.mockImplementation(async (_scope, body) => ({ requestId: ids[1], status: 'assistant', message: '继续分析', conversation: body.conversation }));
    send(input, '继续'); await screen.findByText('继续分析');
    expect(within(screen.getByRole('article', { name: '此前问答' })).getByText('重点结论').tagName).toBe('STRONG');
  });
  it('removes the requested notice and its stale accessible description while keeping help reachable', async () => {
    const { input } = await open();
    expect(screen.queryByText(/提问与回答会留存供获权审计/)).not.toBeInTheDocument();
    expect(input.getAttribute('aria-describedby')).not.toContain('home-query-notice');
    fireEvent.click(screen.getByRole('button', { name: '能力与范围' }));
    expect(screen.getByText(/我是 Colliers AI，高力国际北京办公楼市场的智能研究助手/)).toBeVisible();
  });
  it('opens a chronological conversation once, preserves the unsent draft, and prepends older answers without changing its parent', async () => {
    const { input } = await open();
    fireEvent.change(input, { target: { value: '尚未发送的问题' } });
    fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开对话：市场研究' }));
    const earlier = await screen.findByText('历史重点1');
    const selected = screen.getByText('历史重点2');
    expect(earlier.compareDocumentPosition(selected) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText('历史重点2')).toHaveLength(1);
    expect(input).toHaveValue('尚未发送的问题');
    historyClient.open.mockResolvedValue({ ...opened(), timeline: [snapshot(2)], hasMore: false, nextCursor: undefined,
      conversation: { id: conversationId, parentRequestId: ids[2], resumeToken: 'older-resume-token' } });
    fireEvent.click(screen.getByRole('button', { name: '加载更早问答' }));
    await screen.findByText('历史重点3');
    expect(screen.getByText('历史重点1')).toBeInTheDocument();
    expect(input).toHaveValue('尚未发送的问题');
    client.submitAgent.mockImplementation(async (_scope, body) => ({ requestId: ids[2], status: 'assistant', message: '继续当前会话', conversation: body.conversation }));
    send(input, '沿用最新上下文'); await screen.findByText('继续当前会话');
    expect(client.submitAgent.mock.calls[0][1].conversation).toEqual({ id: conversationId, parentRequestId: ids[1], resumeToken: 'original-resume-token' });
  });
  it('keeps a new conversation when an older history open finishes late without replacing either editor', async () => {
    let finish!: (value: ReturnType<typeof opened>) => void;
    historyClient.open.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { input } = await open();
    fireEvent.change(input, { target: { value: '新对话中尚未发送的问题' } });
    fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    const panel = await screen.findByRole('complementary', { name: '历史工作记录' });
    const search = within(panel).getByRole('searchbox', { name: '搜索标题或最近问题' });
    fireEvent.change(search, { target: { value: '市场' } });
    await waitFor(() => expect(historyClient.list).toHaveBeenCalledWith(scope, { search: '市场', archived: false }, expect.any(AbortSignal)));
    const openButton = await within(panel).findByRole('button', { name: '打开对话：市场研究' });
    await waitFor(() => expect(openButton).toBeEnabled());
    fireEvent.click(openButton);
    const signal = historyClient.open.mock.calls[0][2] as AbortSignal;
    const toolbar = input.closest('#colliers-ai')!.querySelector('header')!;
    fireEvent.click(within(toolbar).getByRole('button', { name: '新对话' }));
    // A transport can settle even after cancellation; the late snapshot still
    // must not replace the explicitly created conversation.
    await act(async () => finish(opened()));
    expect(screen.queryByRole('article', { name: '本次问答' })).not.toBeInTheDocument();
    expect(screen.queryByText('历史重点2')).not.toBeInTheDocument();
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole('textbox', { name: '向 Colliers AI 提问' })).toBe(input);
    expect(input).toHaveValue('新对话中尚未发送的问题');
    expect(panel).toBeInTheDocument(); expect(panel).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    expect(screen.getByRole('complementary', { name: '历史工作记录' })).toBe(panel);
    expect(within(panel).getByRole('searchbox', { name: '搜索标题或最近问题' })).toBe(search);
    expect(search).toHaveValue('市场'); expect(openButton).toBeEnabled();
    expect(client.submitAgent).not.toHaveBeenCalled(); expect(client.recover).not.toHaveBeenCalled();
  });
  it('formats provisional Markdown and flushes the authoritative answer when streaming finishes', async () => {
    client.capabilities.mockResolvedValue({ ...access, agentStreamEnabled: true });
    let finish!: (reply: unknown) => void;
    client.submitAgentStream.mockImplementation((_scope, body, _signal, progress) => {
      progress({ type: 'run_started', requestId: ids[0] });
      progress({ type: 'message_delta', delta: '**正在形成的结论**' });
      return new Promise(resolve => { finish = reply => resolve({ requestId: ids[0], status: 'assistant', conversation: body.conversation, ...reply as object }); });
    });
    const { input } = await open(); send(input, '请分析');
    const partial = await screen.findByLabelText('正在生成的部分回答');
    await waitFor(() => expect(within(partial).getByText('正在形成的结论').tagName).toBe('STRONG'));
    await act(async () => finish({ message: '**最终结论**' }));
    expect(screen.getByText('最终结论').tagName).toBe('STRONG');
    expect(screen.queryByLabelText('正在生成的部分回答')).not.toBeInTheDocument();
    expect(screen.queryByText(/DeepSeek/)).not.toBeInTheDocument();
  });
  it('contains narrow history focus, preserves IME and closes the drawer before the workspace', async () => {
    vi.stubGlobal('innerWidth', 390);
    const { input } = await open();
    fireEvent.change(input, { target: { value: '手机上的未发送草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    const drawer = await screen.findByRole('dialog', { name: '历史记录侧栏' });
    const search = await within(drawer).findByRole('searchbox');
    search.focus(); fireEvent.compositionStart(search);
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(drawer).toBeVisible(); expect(search).toHaveFocus();
    fireEvent.compositionEnd(search);
    fireEvent.keyDown(search, { key: 'Tab' });
    expect(within(drawer).getByRole('tab', { name: '最近对话' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(within(drawer).getByRole('tab', { name: '已归档' })).not.toHaveFocus();
    drawer.focus(); fireEvent.keyDown(drawer, { key: 'Tab', shiftKey: true });
    expect(within(drawer).getByRole('button', { name: '历史与归档说明' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '历史记录侧栏' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Colliers AI 工作空间' })).toBeVisible();
    expect(screen.getByRole('button', { name: '历史记录' })).toHaveFocus();
    expect(input).toHaveValue('手机上的未发送草稿');
  });
  it('returns focus to the retained composer after choosing an example from help', async () => {
    client.capabilities.mockResolvedValue({ ...access, examples: ['示例1', '示例2', '示例3', '示例4'] });
    const { input } = await open();
    fireEvent.click(screen.getByRole('button', { name: '能力与范围' }));
    const help = screen.getByRole('dialog', { name: '能力与范围' });
    fireEvent.click(within(help).getByRole('button', { name: '示例4' }));
    expect(screen.queryByRole('dialog', { name: '能力与范围' })).not.toBeInTheDocument();
    expect(input).toHaveFocus(); expect(input).toHaveValue('示例4');
    expect(client.submitAgent).not.toHaveBeenCalled();
  });
});
