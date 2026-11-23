import * as React from 'react';
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAggregateResult } from '@/src/lib/intelligence/query/result';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
import { buildingAnalysisHref } from '@/src/lib/intelligence/query/buildingNavigation';
import type { QueryConversation } from '@/src/lib/intelligence/query/conversationProtocol';
import type { AgentProgressEvent } from '@/src/lib/intelligence/agent/agentStreamProtocol';
import type { HistoryOpened } from '@/src/lib/intelligence/query/historyProtocol';

const client = vi.hoisted(() => ({ capabilities: vi.fn(), submit: vi.fn(), submitAgent: vi.fn(), submitAgentStream: vi.fn(), recover: vi.fn(), reportDelivery: vi.fn() }));
const historyClient = vi.hoisted(() => ({ list: vi.fn(), open: vi.fn(), change: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client,
  queryScopeKey: (scope: object) => JSON.stringify(scope) }));
vi.mock('@/src/services/trustedQueryHistoryClient', () => ({ trustedQueryHistoryClient: historyClient }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: async () => ({
  session: { user: { id: 'workspace-owner' }, access_token: 'isolated-workspace-test-token' },
  user: { id: 'workspace-owner' }, sessionId: 'session-one',
}) }));
vi.mock('@/src/services/impersonationHeaders', () => ({
  getImpersonationTargetUserId: () => null, withImpersonationHeaders: (headers: object) => headers,
}));
// Result/table/source/action state is real. File/chart HTTP is outside this workspace lifecycle suite.
vi.mock('../HomeQueryArtifacts', async () => {
  const { HomeQueryResultActions } = await import('../HomeQueryResultActions');
  return { HomeQueryArtifacts: (props: React.ComponentProps<typeof HomeQueryResultActions>) => <HomeQueryResultActions {...props} /> };
});
import { HomeQuery } from '../HomeQuery';

const scope = { actorId: 'workspace-owner', effectiveId: 'workspace-owner', sessionId: 'session-one', targetId: null };
const requestIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
const access = { enabled: true, permissionRevision: 'revision-one', examples: [] };
const expandName = '展开 Colliers AI 工作空间', collapseName = '收起 Colliers AI 工作空间';
const result = resultViewSchema.parse(buildAggregateResult(fixture(), 'rent'));
type Submission = { idempotencyKey: string; question: string; conversation: QueryConversation };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function help(body: Submission, index = 0) {
  return { requestId: requestIds[index % requestIds.length], status: 'clarification', reason: 'assistant_help',
    conversation: body.conversation, message: `助手回应：${body.question}`, options: [] };
}
function page(actorId = scope.actorId) {
  return <><button type="button">主页其他操作</button><label htmlFor="home-query">Colliers AI</label>
    <HomeQuery scope={actorId === scope.actorId ? scope : { ...scope, actorId, effectiveId: actorId }} displayName={actorId === scope.actorId ? 'Ron' : '新账号'} /></>;
}
async function open() {
  const view = render(page());
  const input = screen.getByLabelText('Colliers AI') as HTMLTextAreaElement;
  await waitFor(() => expect(input).toBeEnabled());
  return { ...view, input };
}
function send(input: HTMLTextAreaElement, question: string) {
  fireEvent.change(input, { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
}
async function expand() {
  const button = screen.queryByRole('button', { name: expandName })
    ?? screen.queryByRole('button', { name: '全屏 Colliers AI 工作空间' });
  if (button) fireEvent.click(button);
  return screen.findByRole('dialog', { name: 'Colliers AI 工作空间' });
}
async function collapse() {
  fireEvent.click(screen.getByRole('button', { name: collapseName }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Colliers AI 工作空间' })).not.toBeInTheDocument());
}
function controlNativeMotion(surface: HTMLElement, reduced = false) {
  vi.mocked(window.matchMedia).mockImplementation(query => ({ matches: reduced && query.includes('prefers-reduced-motion'), media: query,
    onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }));
  vi.spyOn(surface, 'getBoundingClientRect').mockImplementation(() => surface.dataset.mode === 'expanded'
    ? new DOMRect(0, 0, 1280, 800) : new DOMRect(80, 160, 720, 480));
  vi.spyOn(surface.parentElement!, 'getBoundingClientRect').mockReturnValue(new DOMRect(80, 160, 720, 480));
  const motions: Animation[] = [];
  const animate = vi.fn(() => {
    let resolve!: (value: Animation) => void, reject!: (reason: Error) => void;
    const finished = new Promise<Animation>((done, fail) => { resolve = done; reject = fail; });
    const animation = { finished, finish: vi.fn(() => resolve(animation)),
      cancel: vi.fn(() => reject(new DOMException('Animation superseded', 'AbortError'))) } as unknown as Animation;
    motions.push(animation); return animation;
  });
  Object.defineProperty(surface, 'animate', { configurable: true, value: animate });
  return { motions, animate };
}
function controlResponsiveWidth(initialWidth: number) {
  let width = initialWidth;
  const media = new Map<string, MediaQueryList>();
  const matches = (query: string) => query.includes('prefers-reduced-motion')
    || (query.match(/min-width:\s*(\d+)px/) ? width >= Number(query.match(/min-width:\s*(\d+)px/)![1]) : false);
  vi.stubGlobal('innerWidth', width);
  vi.mocked(window.matchMedia).mockImplementation(query => {
    let item = media.get(query);
    if (!item) {
      item = Object.assign(new EventTarget(), { media: query, onchange: null,
        addListener: vi.fn(), removeListener: vi.fn() }) as unknown as MediaQueryList;
      Object.defineProperty(item, 'matches', { get: () => matches(query) });
      media.set(query, item);
    }
    return item;
  });
  return { resize: (nextWidth: number) => {
    const previous = [...media.values()].map(item => ({ item, matches: item.matches }));
    width = nextWidth; vi.stubGlobal('innerWidth', width);
    for (const prior of previous) if (prior.matches !== prior.item.matches) {
      const event = Object.assign(new Event('change'), { matches: prior.item.matches, media: prior.item.media });
      prior.item.dispatchEvent(event);
    }
    window.dispatchEvent(new Event('resize'));
  } };
}
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); window.history.replaceState(null, '', '/');
  client.capabilities.mockResolvedValue(access); client.reportDelivery.mockResolvedValue(true);
  historyClient.list.mockResolvedValue({ entries: [], hasMore: false, indexing: false, unavailable: 0 });
  historyClient.change.mockResolvedValue(undefined);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query,
    onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

describe('Conversational Experience P1 shared workspace lifecycle', () => {
  it('uses the native Agent only when the authorized capabilities advertise an available model', async () => {
    client.capabilities.mockResolvedValue({ ...access, agentEnabled: true });
    client.submitAgent.mockImplementation(async (_scope, body: Submission) => ({
      requestId: requestIds[0], status: 'assistant', conversation: body.conversation,
      message: '模型回答：' + body.question, historySaved: false,
    }));
    const { input } = await open(); send(input, '你好');
    await screen.findByText('模型回答：你好');
    expect(client.submitAgent).toHaveBeenCalledTimes(1);
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('shows only observed DeepSeek progress until the signed terminal reply has arrived', async () => {
    client.capabilities.mockResolvedValue({ ...access, agentEnabled: true, agentStreamEnabled: true });
    const terminal = deferred<void>();
    client.submitAgentStream.mockImplementation(async (_scope: typeof scope, body: Submission,
      _signal: AbortSignal, onProgress: (event: AgentProgressEvent) => void) => {
      onProgress({ type: 'run_started', requestId: requestIds[0] });
      onProgress({ type: 'tool_started', name: 'query_quarterly_metrics' });
      onProgress({ type: 'tool_completed', name: 'query_quarterly_metrics', status: 'ready' });
      onProgress({ type: 'message_delta', delta: '逐步' });
      await terminal.promise;
      return { requestId: requestIds[0], status: 'assistant', conversation: body.conversation,
        message: '逐步形成的正式模型回答。', historySaved: false };
    });
    const { input } = await open(); send(input, 'CBD 季度数据如何？');
    const provisional = await screen.findByLabelText('正在生成的部分回答');
    expect(provisional).toHaveTextContent('逐步');
    expect(screen.getByText('正在生成回答…')).toBeInTheDocument();
    expect(client.submitAgent).not.toHaveBeenCalled();
    expect(client.submit).not.toHaveBeenCalled();
    terminal.resolve(undefined);
    await screen.findByText('逐步形成的正式模型回答。');
    expect(screen.queryByLabelText('正在生成的部分回答')).not.toBeInTheDocument();
    expect(client.submitAgentStream).toHaveBeenCalledOnce();
  });

  it.each(['disconnect', 'stop', 'reload'])('retains the streamed request reference for recovery after %s', async mode => {
    client.capabilities.mockResolvedValue({ ...access, agentEnabled: true, agentStreamEnabled: true });
    const terminal = deferred<void>();
    client.submitAgentStream.mockImplementation(async (_scope: typeof scope, _body: Submission,
      _signal: AbortSignal, onProgress: (event: AgentProgressEvent) => void) => {
      onProgress({ type: 'run_started', requestId: requestIds[0] });
      await terminal.promise;
      throw new TypeError('connection interrupted');
    });
    client.recover.mockResolvedValue({ status: 'assistant', requestId: requestIds[0], message: '已恢复流式原请求' });
    const opened = await open(); send(opened.input, '需要恢复的流式请求');
    await screen.findByText('正在研究你的问题…');
    const storageKey = `trusted-query:last:${JSON.stringify(scope)}`;
    expect(sessionStorage.getItem(storageKey)).toBe(requestIds[0]);
    if (mode === 'disconnect') await act(async () => terminal.resolve(undefined));
    else if (mode === 'stop') fireEvent.click(screen.getByRole('button', { name: '停止等待' }));
    else {
      opened.unmount();
      await open();
    }
    fireEvent.click(await screen.findByRole('button', { name: '检查状态并恢复结果' }));
    await screen.findByText('已恢复流式原请求');
    expect(client.recover).toHaveBeenCalledWith(scope, requestIds[0], expect.any(AbortSignal));
    expect(client.submitAgentStream).toHaveBeenCalledOnce();
    expect(client.submitAgent).not.toHaveBeenCalled();
    expect(client.submit).not.toHaveBeenCalled();
    await act(async () => terminal.resolve(undefined));
  });

  it('does not describe a limited tool observation as completed', async () => {
    client.capabilities.mockResolvedValue({ ...access, agentEnabled: true, agentStreamEnabled: true });
    const terminal = deferred<void>();
    client.submitAgentStream.mockImplementation(async (_scope: typeof scope, body: Submission,
      _signal: AbortSignal, onProgress: (event: AgentProgressEvent) => void) => {
      onProgress({ type: 'run_started', requestId: requestIds[0] });
      onProgress({ type: 'tool_completed', name: 'query_quarterly_metrics', status: 'limited' });
      await terminal.promise;
      return { requestId: requestIds[0], status: 'assistant', conversation: body.conversation, message: '本轮查询未完成。' };
    });
    const { input } = await open(); send(input, '当前查询');
    await screen.findByText('部分数据步骤未完成，正在整理说明…');
    expect(screen.queryByText('数据步骤已完成，正在整理回答…')).not.toBeInTheDocument();
    await act(async () => terminal.resolve(undefined));
  });

  it('ignores a late stream start after the request was stopped', async () => {
    client.capabilities.mockResolvedValue({ ...access, agentEnabled: true, agentStreamEnabled: true });
    const terminal = deferred<void>(); let progress!: (event: AgentProgressEvent) => void;
    client.submitAgentStream.mockImplementation(async (_scope: typeof scope, body: Submission,
      _signal: AbortSignal, onProgress: (event: AgentProgressEvent) => void) => {
      progress = onProgress; await terminal.promise;
      return { requestId: requestIds[0], status: 'assistant', conversation: body.conversation, message: '迟到终态' };
    });
    const { input } = await open(); send(input, '稍后才开始的流');
    fireEvent.click(await screen.findByRole('button', { name: '停止等待' }));
    act(() => progress({ type: 'run_started', requestId: requestIds[0] }));
    expect(sessionStorage.getItem(`trusted-query:last:${JSON.stringify(scope)}`)).toBeNull();
    expect(screen.queryByRole('button', { name: '检查状态并恢复结果' })).not.toBeInTheDocument();
    await act(async () => terminal.resolve(undefined));
    expect(screen.queryByText('迟到终态')).not.toBeInTheDocument();
  });

  it('closes a history action menu with Escape before closing the workspace', async () => {
    historyClient.list.mockResolvedValue({ entries: [{ conversationId: requestIds[0], requestId: requestIds[1],
      title: '季度研究', latestQuestion: '租金趋势', updatedAt: '2026-11-18T01:00:00.000Z', archived: false }],
      hasMore: false, indexing: false, unavailable: 0 });
    const { input } = await open(); const surface = await expand();
    fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    const trigger = await screen.findByRole('button', { name: '对话操作：季度研究' });
    const user = userEvent.setup(); await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: '重命名' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Colliers AI 工作空间' })).toBe(surface);
    expect(screen.getByRole('textbox', { name: '向 Colliers AI 提问' })).toBe(input);
    expect(within(screen.getByRole('complementary', { name: '历史工作记录' })).getByRole('button', { name: '新对话' })).toBeEnabled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Colliers AI 工作空间' })).not.toBeInTheDocument());
    expect(client.submit).not.toHaveBeenCalled(); expect(historyClient.change).not.toHaveBeenCalled();
  });
  it('skips the closed help panel when cycling workspace focus', async () => {
    client.submit.mockImplementation(async (_scope, body: Submission) => help(body));
    const { input } = await open();
    send(input, '你好');
    await screen.findByText('助手回应：你好');
    await expand();
    expect(screen.getByText(/我是 Colliers AI，高力国际北京办公楼市场的智能研究助手/)).not.toBeVisible();
    fireEvent.change(input, { target: { value: '正在继续编辑的草稿' } });
    const first = screen.getByRole('button', { name: '新对话' });
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: '发送问题' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();
    expect(screen.getByRole('textbox', { name: '向 Colliers AI 提问' })).toBe(input);
    expect(input).toHaveValue('正在继续编辑的草稿');
    expect(client.submit).toHaveBeenCalledOnce();
  });

  it.each([false, true])('reveals a clipped keyboard target while keeping hidden layout ancestors fixed (native scrolling: %s)', async nativeScrolling => {
    client.submit.mockImplementation(async (_scope, body: Submission) => ({ requestId: requestIds[0], status: 'ready', result, conversation: body.conversation }));
    const { input } = await open(); await expand(); send(input, 'CBD净有效租金');
    const rendered = await screen.findByRole('region', { name: '查询结果' });
    const target = within(rendered).getByRole('button', { name: '数据依据' });
    const transcript = screen.getByRole('region', { name: '对话记录' });
    const surface = screen.getByRole('dialog', { name: 'Colliers AI 工作空间' });
    // Model native focus scrolling an overflow-hidden layout ancestor as well
    // as the intended reader. The workspace must reveal through its reader only.
    const layout = transcript.parentElement!; layout.style.overflowY = 'hidden';
    const focus = target.focus.bind(target);
    vi.spyOn(target, 'focus').mockImplementation(options => {
      focus(options); if (nativeScrolling && !options?.preventScroll) layout.scrollTop = 200;
    });
    transcript.style.overflowY = 'auto';
    Object.defineProperties(transcript, { clientHeight: { configurable: true, value: 300 }, scrollHeight: { configurable: true, value: 1200 } });
    vi.spyOn(transcript, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 60, 768, 300));
    vi.spyOn(target, 'getBoundingClientRect').mockImplementation(() => new DOMRect(32, 640 - transcript.scrollTop, 56, 32));
    const controls = Array.from(surface.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, summary'))
      .filter(node => node.tabIndex >= 0 && !node.closest('[hidden], [inert], details:not([open]) > :not(summary)'));
    const previous = controls[controls.indexOf(target) - 1];
    previous.focus(); transcript.scrollTop = 0; document.documentElement.scrollTop = 47;
    fireEvent.keyDown(previous, { key: 'Tab' });
    expect(target).toHaveFocus();
    expect(target.getBoundingClientRect().bottom).toBeLessThanOrEqual(360);
    expect(transcript.scrollTop).toBe(312);
    expect(layout.scrollTop).toBe(0);
    expect(document.documentElement.scrollTop).toBe(47);
    fireEvent.keyDown(target, { key: 'Tab' });
    expect(target).not.toHaveFocus();
  });

  it('keeps the greeting compact until editor interaction and never uses question length to force full screen', async () => {
    client.submit.mockImplementation(async (_scope, body: Submission) => help(body));
    const { input } = await open();
    expect(screen.getByRole('heading', { name: '你好，Ron。' })).toBeVisible();
    expect(screen.getByRole('button', { name: expandName })).toBeEnabled();
    send(input, '你好'); await screen.findByText('助手回应：你好');
    expect(input.closest('#colliers-ai')).toHaveAttribute('data-mode', 'focus');
    const longQuestion = '继续说明当前获权查询范围。'.repeat(45);
    send(input, longQuestion); await screen.findByText(`助手回应：${longQuestion}`);
    expect(input.closest('#colliers-ai')).toHaveAttribute('data-mode', 'focus');
    expect(client.submit).toHaveBeenCalledTimes(2);
  });

  it('keeps the exact composer node, draft and selection through repeated mode changes', async () => {
    const { input } = await open();
    fireEvent.change(input, { target: { value: 'CBD季度研究的下一条草稿' } });
    input.focus(); input.setSelectionRange(3, 7);
    for (let index = 0; index < 3; index++) {
      await expand();
      expect(screen.getByLabelText('Colliers AI')).toBe(input);
      expect(input).toHaveValue('CBD季度研究的下一条草稿');
      expect([input.selectionStart, input.selectionEnd]).toEqual([3, 7]);
      await collapse();
      expect(screen.getByLabelText('Colliers AI')).toBe(input);
      expect([input.selectionStart, input.selectionEnd]).toEqual([3, 7]);
    }
    expect(client.submit).not.toHaveBeenCalled(); expect(client.recover).not.toHaveBeenCalled();
  });

  it('does not abort, duplicate or replay an in-flight query when modes change and retains the next draft on arrival', async () => {
    const pending = deferred<unknown>(); client.submit.mockReturnValue(pending.promise);
    const { input } = await open(); send(input, '2026Q3 CBD净有效租金');
    const [, body, signal] = client.submit.mock.calls[0] as [object, Submission, AbortSignal];
    fireEvent.change(input, { target: { value: '下一条还在输入的问题' } });
    await expand(); await collapse(); await expand();
    expect(signal.aborted).toBe(false); expect(client.submit).toHaveBeenCalledOnce();
    input.focus(); input.setSelectionRange(2, 4);
    await act(async () => pending.resolve({ requestId: requestIds[0], status: 'ready', result, conversation: body.conversation }));
    const rendered = await screen.findByRole('region', { name: '查询结果' });
    expect(input).toHaveValue('下一条还在输入的问题'); expect(input).toHaveFocus();
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 4]);
    await waitFor(() => expect(client.reportDelivery).toHaveBeenCalledOnce());
    await collapse(); await expand();
    expect(screen.getByRole('region', { name: '查询结果' })).toBe(rendered);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(client.reportDelivery).toHaveBeenCalledOnce();
    expect(client.submit).toHaveBeenCalledOnce(); expect(client.recover).not.toHaveBeenCalled();
  });

  it('preserves the confirmed parent and conversation across compact/expanded follow-ups', async () => {
    client.submit.mockImplementation(async (_scope, body: Submission) => help(body, client.submit.mock.calls.length - 1));
    const { input } = await open(); send(input, '第一个问题'); await screen.findByText('助手回应：第一个问题');
    await expand(); send(input, '继续第二个问题'); await screen.findByText('助手回应：继续第二个问题');
    await collapse(); await expand(); send(input, '再追问第三个问题'); await screen.findByText('助手回应：再追问第三个问题');
    const [first, second, third] = client.submit.mock.calls.map(call => call[1] as Submission);
    expect(first.conversation).toEqual({ id: expect.any(String) });
    expect(second.conversation).toEqual({ id: first.conversation.id, parentRequestId: requestIds[0] });
    expect(third.conversation).toEqual({ id: first.conversation.id, parentRequestId: requestIds[1] });
    expect(screen.getByText('助手回应：第一个问题')).toBeVisible();
    expect(screen.getByText('助手回应：继续第二个问题')).toBeVisible();
    expect(client.recover).not.toHaveBeenCalled();
  });

  it('retains every current-session question and answer after more than ten turns', async () => {
    client.submit.mockImplementation(async (_scope, body: Submission) => help(body));
    const { input } = await open();
    for (let index = 1; index <= 12; index++) {
      send(input, `第${index}个独立问题`); await screen.findByText(`助手回应：第${index}个独立问题`);
    }
    for (let index = 1; index <= 12; index++) {
      expect(screen.getAllByText(`第${index}个独立问题`)[0]).toBeInTheDocument();
      expect(screen.getByText(`助手回应：第${index}个独立问题`)).toBeInTheDocument();
    }
    await expand(); await collapse();
    expect(screen.getByText('助手回应：第1个独立问题')).toBeInTheDocument();
    expect(client.submit).toHaveBeenCalledTimes(12);
  });

  it('keeps the explicit map building scope and original idempotency key through expansion and retry', async () => {
    window.history.replaceState(null, '', buildingAnalysisHref(requestIds.slice(0, 2), 'compare'));
    client.submit.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ requestId: requestIds[0], status: 'running' });
    const { input } = await open();
    await waitFor(() => expect(input).toHaveValue('比较选中楼宇最新有数据季度的净有效租金和空置面积'));
    await expand(); await collapse(); fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    await screen.findByText(/网络连接中断/);
    const original = client.submit.mock.calls[0][1];
    expect(original.buildingSelection).toEqual({ ids: requestIds.slice(0, 2), intent: 'compare' });
    await expand(); fireEvent.click(screen.getByRole('button', { name: '重试本次请求' }));
    await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(2));
    expect(client.submit.mock.calls[1][1]).toEqual(original);
  });

  it('protects Chinese composition and keyCode 229 from both accidental submission and Escape dismissal', async () => {
    client.submit.mockImplementation(async (_scope, body: Submission) => help(body));
    const { input } = await open(); await expand(); input.focus();
    fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: '正在组词的中文' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(client.submit).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Colliers AI 工作空间' })).toBeInTheDocument();
    expect(input).toHaveFocus(); expect(input).toHaveValue('正在组词的中文');
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 });
    expect(client.submit).not.toHaveBeenCalled(); expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true }); expect(client.submit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' }); await screen.findByText('助手回应：正在组词的中文');
    expect(client.submit).toHaveBeenCalledOnce();
  });

  it('contains keyboard focus while modal and restores the expand control after Escape', async () => {
    await open(); const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: expandName }); trigger.focus();
    await user.click(trigger); const dialog = await screen.findByRole('dialog', { name: 'Colliers AI 工作空间' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    for (let index = 0; index < 36; index++) {
      await user.tab({ shift: index >= 18 });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: expandName })).toHaveFocus();
    expect(screen.getByRole('button', { name: '主页其他操作' })).toBeEnabled();
  });

  it('clears old content, draft, modal and in-flight ownership immediately when the verified account changes', async () => {
    const pending = deferred<unknown>(); client.submit.mockReturnValue(pending.promise);
    const { input, rerender } = await open(); send(input, '旧账号正在查询的内容');
    const signal = client.submit.mock.calls[0][2] as AbortSignal;
    fireEvent.change(input, { target: { value: '旧账号草稿' } }); await expand();
    rerender(page('another-owner'));
    await screen.findByRole('heading', { name: '你好，新账号。' });
    expect(signal.aborted).toBe(true); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Colliers AI')).not.toBe(input); expect(screen.getByLabelText('Colliers AI')).toHaveValue('');
    await act(async () => pending.resolve({ requestId: requestIds[0], status: 'clarification', message: '旧账号迟到回答' }));
    expect(screen.queryByText('旧账号迟到回答')).not.toBeInTheDocument();
    expect(screen.queryByText('旧账号正在查询的内容')).not.toBeInTheDocument();
  });

  it('discards the displayed answer and next request after a permission revocation while expanded', async () => {
    const pending = deferred<unknown>();
    client.submit.mockImplementationOnce(async (_scope, body: Submission) => help(body)).mockReturnValueOnce(pending.promise);
    const { input } = await open(); send(input, '之前获权的回答'); await screen.findByText('助手回应：之前获权的回答');
    await expand(); send(input, '正在请求的数据');
    const signal = client.submit.mock.calls[1][2] as AbortSignal;
    fireEvent.change(input, { target: { value: '资格撤销前草稿' } });
    client.capabilities.mockResolvedValue({ enabled: false, permissionRevision: 'revoked', examples: [] });
    fireEvent.focus(window);
    await waitFor(() => expect(input).toBeDisabled());
    expect(signal.aborted).toBe(true); expect(input).toHaveValue('');
    expect(screen.queryByText('助手回应：之前获权的回答')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => pending.resolve({ status: 'ready', result, requestId: requestIds[1] }));
    expect(screen.queryByRole('region', { name: '查询结果' })).not.toBeInTheDocument();
  });

  it('preserves stopped-waiting semantics, ignores late replies and retries with the same request key after switching mode', async () => {
    const pending = deferred<unknown>(); client.submit.mockReturnValueOnce(pending.promise)
      .mockImplementationOnce(async (_scope, body: Submission) => help(body, 1));
    const { input } = await open(); send(input, '需要等待的问题');
    const [, original, signal] = client.submit.mock.calls[0] as [object, Submission, AbortSignal];
    await expand(); await collapse(); await expand();
    fireEvent.click(screen.getByRole('button', { name: '停止等待' }));
    expect(signal.aborted).toBe(true); expect(screen.getByText(/已停止等待，回答可能仍在生成/)).toBeVisible();
    fireEvent.change(input, { target: { value: '停止之后的草稿' } });
    await collapse(); fireEvent.click(screen.getByRole('button', { name: '重试本次请求' }));
    await screen.findByText('助手回应：需要等待的问题');
    expect(client.submit.mock.calls[1][1]).toEqual(original);
    expect(input).toHaveValue('停止之后的草稿');
    await act(async () => pending.resolve({ requestId: requestIds[0], status: 'clarification', message: '已停止请求的迟到内容' }));
    expect(screen.queryByText('已停止请求的迟到内容')).not.toBeInTheDocument();
    expect(client.submit).toHaveBeenCalledTimes(2);
  });

  it('retains a timeout explanation and original recovery reference across mode changes', async () => {
    client.submit.mockRejectedValueOnce(new DOMException('deadline exceeded', 'TimeoutError'))
      .mockResolvedValueOnce({ status: 'running', requestId: requestIds[0] });
    client.recover.mockResolvedValue({ status: 'clarification', requestId: requestIds[0], reason: 'assistant_help', message: '已恢复原请求' });
    const { input } = await open(); send(input, '超时的原请求');
    await screen.findByText(/等待响应超时/); await expand();
    expect(screen.getByText(/等待响应超时/)).toHaveTextContent('服务端可能仍在处理');
    fireEvent.click(screen.getByRole('button', { name: '重试本次请求' }));
    await screen.findByText(/服务端仍在处理/); await collapse(); await expand();
    fireEvent.click(screen.getByRole('button', { name: '检查状态并恢复结果' }));
    await screen.findByText('已恢复原请求');
    expect(client.submit.mock.calls[1][1]).toEqual(client.submit.mock.calls[0][1]);
    expect(client.recover).toHaveBeenCalledWith(scope, requestIds[0], expect.any(AbortSignal));
    expect(client.submit).toHaveBeenCalledTimes(2);
  });

  it('continues an authenticated native Agent history through the Agent endpoint, not legacy query', async () => {
    client.capabilities.mockResolvedValue({ ...access, agentEnabled: true });
    const conversationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const entry = { conversationId, requestId: requestIds[0], title: 'Agent 市场分析',
      latestQuestion: 'CBD 市场情况', updatedAt: '2026-11-18T01:00:00.000Z', archived: false };
    const turn = { requestId: requestIds[0], question: entry.latestQuestion,
      state: 'succeeded', submittedAt: entry.updatedAt };
    const opened: HistoryOpened = { title: entry.title, turns: [turn],
      selected: { ...turn, reply: { requestId: requestIds[0], status: 'assistant',
        isNativeAgent: true, message: '已完成 CBD 市场分析。' } },
      conversation: { id: conversationId, parentRequestId: requestIds[0], resumeToken: 'signed-native-agent-parent' },
      hasMore: false };
    historyClient.list.mockResolvedValue({ entries: [entry], hasMore: false, indexing: false, unavailable: 0 });
    historyClient.open.mockResolvedValue(opened);
    client.submitAgent.mockImplementation(async (_scope, body: Submission) => ({
      requestId: requestIds[1], status: 'assistant', conversation: body.conversation,
      message: '模型追问：' + body.question,
    }));
    const { input } = await open(); await expand();
    if (!screen.queryByRole('button', { name: '打开对话：Agent 市场分析' }))
      fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开对话：Agent 市场分析' }));
    expect((await screen.findAllByText('已完成 CBD 市场分析。')).length).toBeGreaterThan(0);
    send(input, '为什么不同？');
    await screen.findByText('模型追问：为什么不同？');
    expect(client.submitAgent).toHaveBeenCalledOnce();
    expect(client.submit).not.toHaveBeenCalled();
    expect(client.submitAgent.mock.calls[0][1].conversation).toEqual(opened.conversation);
  });

  it('opens an existing historical snapshot once and continues its signed parent after a workspace round trip', async () => {
    const conversationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const entry = { conversationId, requestId: requestIds[0], title: '原始季度研究', latestQuestion: '历史季度的净有效租金',
      updatedAt: '2026-11-10T06:00:00.000Z', archived: false };
    const turn = { requestId: requestIds[0], question: entry.latestQuestion, state: 'succeeded', submittedAt: entry.updatedAt };
    const opened: HistoryOpened = { title: entry.title, conversation: { id: conversationId, parentRequestId: requestIds[0], resumeToken: 'signed-current-session-parent' },
      turns: [turn], selected: { ...turn, reply: { requestId: requestIds[0], status: 'ready', result } }, hasMore: false };
    historyClient.list.mockResolvedValue({ entries: [entry], hasMore: false, indexing: false, unavailable: 0 });
    historyClient.open.mockResolvedValue(opened);
    client.submit.mockImplementation(async (_scope, body: Submission) => help(body, 1));
    const { input } = await open(); await expand();
    if (!screen.queryByRole('button', { name: '打开对话：原始季度研究' })) fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开对话：原始季度研究' }));
    const rendered = await screen.findByRole('region', { name: '查询结果' });
    expect(client.submit).not.toHaveBeenCalled(); expect(client.recover).not.toHaveBeenCalled();
    await collapse(); await expand();
    expect(screen.getByRole('region', { name: '查询结果' })).toBe(rendered);
    expect(historyClient.open).toHaveBeenCalledOnce();
    expect(screen.queryByText(/已打开原始历史快照，未重新查询/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: '本次问答' })).getByText(entry.latestQuestion)).toBeVisible();
    send(input, '在原范围继续分析'); await screen.findByText('助手回应：在原范围继续分析');
    expect(client.submit.mock.calls[0][1].conversation).toEqual(opened.conversation);
    expect(JSON.stringify(sessionStorage)).not.toContain(opened.conversation.resumeToken);
    expect(JSON.stringify(sessionStorage)).not.toContain(entry.latestQuestion);
  });

  it('keeps selected source details and the mounted result across expand/collapse without another query', async () => {
    client.submit.mockImplementation(async (_scope, body: Submission) => ({ requestId: requestIds[0], status: 'ready', result, conversation: body.conversation }));
    const { input } = await open(); send(input, 'CBD净有效租金');
    const rendered = await screen.findByRole('region', { name: '查询结果' });
    fireEvent.click(within(rendered).getByRole('button', { name: /^查看来源：/ }));
    const sourcePanel = await screen.findByRole('region', { name: '来源详情' });
    await expand(); await collapse(); await expand();
    expect(screen.getByRole('region', { name: '查询结果' })).toBe(rendered);
    expect(sourcePanel).not.toBeInTheDocument();
    fireEvent.click(within(rendered).getByRole('button', { name: /^查看来源：/ }));
    expect(screen.getByRole('region', { name: '来源详情' })).toBeVisible();
    expect(client.submit).toHaveBeenCalledOnce(); expect(client.recover).not.toHaveBeenCalled();
  });

  it('continues Tab navigation beside a programmatically focused source panel and restores its trigger on close', async () => {
    client.submit.mockImplementation(async (_scope, body: Submission) => ({ requestId: requestIds[0], status: 'ready', result, conversation: body.conversation }));
    const user = userEvent.setup();
    const { input } = await open(); await expand(); send(input, 'CBD净有效租金');
    const rendered = await screen.findByRole('region', { name: '查询结果' });
    const trigger = within(rendered).getByRole('button', { name: /^查看来源：/ });
    await user.click(trigger);
    const sourcePanel = await screen.findByRole('region', { name: '来源详情' });
    await waitFor(() => expect(sourcePanel).toHaveFocus());
    await user.tab();
    expect(within(sourcePanel).getByRole('button', { name: '关闭来源' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('region', { name: '来源详情' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole('region', { name: '来源详情' })).toHaveFocus());
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: '返回对话' })).toHaveFocus();
    expect(screen.getByRole('region', { name: '查询结果' })).toBe(rendered);
    expect(screen.getByLabelText('Colliers AI')).toBe(input);
    expect(client.submit).toHaveBeenCalledOnce(); expect(client.recover).not.toHaveBeenCalled();
  });

  it('continues Tab navigation beside a programmatically focused analysis summary and restores its trigger on close', async () => {
    client.submit.mockImplementation(async (_scope, body: Submission) => ({ requestId: requestIds[0], status: 'ready', result, conversation: body.conversation }));
    const user = userEvent.setup();
    const { input } = await open(); await expand(); send(input, 'CBD净有效租金');
    const rendered = await screen.findByRole('region', { name: '查询结果' });
    await user.click(within(rendered).getByText('更多操作'));
    const trigger = within(rendered).getByRole('button', { name: '生成分析摘要' });
    await user.click(trigger);
    const summaryPanel = await screen.findByRole('region', { name: '市场分析摘要' });
    await waitFor(() => expect(summaryPanel).toHaveFocus());
    await user.tab();
    expect(within(summaryPanel).getByRole('button', { name: '收起摘要' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('region', { name: '市场分析摘要' })).not.toBeInTheDocument();
    expect(within(rendered).getByText('更多操作')).toHaveFocus();
    await user.click(within(rendered).getByText('更多操作'));
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole('region', { name: '市场分析摘要' })).toHaveFocus());
    await user.tab({ shift: true });
    expect(within(rendered).getByText('更多操作')).toHaveFocus();
    expect(screen.getByRole('region', { name: '查询结果' })).toBe(rendered);
    expect(screen.getByLabelText('Colliers AI')).toBe(input);
    expect(client.submit).toHaveBeenCalledOnce(); expect(client.recover).not.toHaveBeenCalled();
  });

  it('does not pull a reader away from earlier messages on reply arrival and offers an explicit return to latest', async () => {
    const pending = deferred<unknown>();
    client.submit.mockImplementationOnce(async (_scope, body: Submission) => help(body)).mockReturnValueOnce(pending.promise);
    const { input } = await open(); send(input, '已有回答'); await screen.findByText('助手回应：已有回答');
    await expand(); send(input, '等候的新回答');
    const transcript = screen.getByRole('region', { name: '对话记录' });
    let scrollHeight = 1200;
    Object.defineProperties(transcript, { clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTo: { configurable: true, value: vi.fn((options: ScrollToOptions) => {
        transcript.scrollTop = Math.min(options.top ?? transcript.scrollTop, scrollHeight - 300);
      }) } });
    transcript.scrollTop = 100; fireEvent.scroll(transcript);
    scrollHeight = 1600;
    await act(async () => pending.resolve(help(client.submit.mock.calls[1][1], 1)));
    await screen.findByText('助手回应：等候的新回答');
    expect(transcript.scrollTop).toBe(100);
    const latest = await screen.findByRole('button', { name: '回到最新消息' });
    fireEvent.click(latest);
    await waitFor(() => expect(transcript.scrollTop).toBeGreaterThanOrEqual(1300));
    expect(client.submit).toHaveBeenCalledTimes(2);
  });

  it('keeps a reader position through a mode round trip without reloading the existing answer', async () => {
    client.submit.mockImplementation(async (_scope, body: Submission) => help(body));
    const { input } = await open(); send(input, '保留阅读位置的问题'); await screen.findByText('助手回应：保留阅读位置的问题');
    const transcript = screen.getByRole('region', { name: '对话记录' });
    Object.defineProperties(transcript, { clientHeight: { configurable: true, value: 300 }, scrollHeight: { configurable: true, value: 1800 } });
    transcript.scrollTop = 240; fireEvent.scroll(transcript);
    await expand(); await collapse();
    expect(screen.getByRole('region', { name: '对话记录' })).toBe(transcript);
    expect(transcript.scrollTop).toBe(240);
    expect(client.submit).toHaveBeenCalledOnce(); expect(client.recover).not.toHaveBeenCalled();
  });

  it('runs the real authenticated client, protocol validation and delivery receipts once across an in-flight mode transition', async () => {
    const { trustedQueryClient: actual } = await vi.importActual<typeof import('@/src/services/trustedQueryClient')>('@/src/services/trustedQueryClient');
    client.capabilities.mockImplementation(actual.capabilities); client.submit.mockImplementation(actual.submit);
    client.recover.mockImplementation(actual.recover); client.reportDelivery.mockImplementation(actual.reportDelivery);
    vi.stubGlobal('crypto', webcrypto);
    const pending = deferred<Response>();
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/capabilities')) return Response.json(access);
      if (url.endsWith('/receipt')) return Response.json({ status: 'recorded' });
      if (url === '/api/intelligence/query' && options?.method === 'POST') return pending.promise;
      throw new Error(`Unexpected isolated endpoint: ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const { input } = await open(); send(input, '你好');
    await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url === '/api/intelligence/query')).toHaveLength(1));
    const [, init] = fetcher.mock.calls.find(([url]) => url === '/api/intelligence/query')!;
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store',
      headers: { Authorization: 'Bearer isolated-workspace-test-token', 'Content-Type': 'application/json' } });
    const body = JSON.parse(init!.body as string) as Submission;
    await expand(); await collapse(); await expand();
    expect(init!.signal!.aborted).toBe(false);
    const text = JSON.stringify(help(body));
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
      .map(value => value.toString(16).padStart(2, '0')).join('');
    await act(async () => pending.resolve(new Response(text, { headers: { 'Content-Type': 'application/json',
      'X-Query-Delivery-Token': 'isolated-workspace-delivery-token', 'X-Query-Body-Sha256': digest } })));
    await screen.findByText('助手回应：你好');
    await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/receipt'))).toHaveLength(2));
    const receipts = fetcher.mock.calls.filter(([url]) => url.endsWith('/receipt')).map(([, options]) => JSON.parse(options!.body as string));
    expect(receipts.map(item => item.phase).sort()).toEqual(['client_dom_committed', 'client_received']);
    expect(receipts.every(item => item.bodySha256 === digest)).toBe(true);
    await collapse(); await expand(); await new Promise(resolve => setTimeout(resolve, 50));
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/intelligence/query')).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/receipt'))).toHaveLength(2);
    expect(client.recover).not.toHaveBeenCalled();
  });

  it('keeps only the latest asynchronous native animation in control after rapid expand/collapse reversals', async () => {
    const { input } = await open();
    fireEvent.change(input, { target: { value: '动画进行中也要保留的草稿' } }); input.setSelectionRange(2, 5);
    const surface = input.closest('#colliers-ai') as HTMLElement;
    const { motions, animate } = controlNativeMotion(surface);
    const background = screen.getByRole('button', { name: '主页其他操作' });
    await expand(); expect(animate).toHaveBeenCalledOnce(); expect(background.inert).toBe(true);
    // The first animation resolves just before the reverse click. Its queued
    // completion must not settle the newer transition or unlock the background.
    await act(async () => { motions[0].finish(); fireEvent.click(screen.getByRole('button', { name: collapseName })); });
    expect(motions).toHaveLength(2); expect(screen.getByRole('dialog')).toBe(surface);
    fireEvent.click(screen.getByRole('button', { name: expandName }));
    expect(motions).toHaveLength(3); expect(motions[1].cancel).toHaveBeenCalledOnce();
    await act(async () => motions[1].finish());
    expect(screen.getByRole('button', { name: collapseName })).toHaveAttribute('aria-expanded', 'true');
    expect(background.inert).toBe(true);
    await act(async () => motions[2].finish());
    fireEvent.click(screen.getByRole('button', { name: collapseName }));
    expect(motions).toHaveLength(4); expect(background.inert).toBe(true);
    await act(async () => motions[3].finish());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(background.inert).not.toBe(true); expect(document.body.style.overflow).not.toBe('hidden');
    expect(screen.getByLabelText('Colliers AI')).toBe(input); expect(input).toHaveValue('动画进行中也要保留的草稿');
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
    expect(screen.getByRole('button', { name: expandName })).toHaveFocus();
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('cancels native animation and restores background interaction when the account changes before finish', async () => {
    const pending = deferred<unknown>(); client.submit.mockReturnValue(pending.promise);
    const { input, rerender } = await open(); send(input, '旧账号的动画中请求');
    const signal = client.submit.mock.calls[0][2] as AbortSignal;
    const surface = input.closest('#colliers-ai') as HTMLElement;
    const { motions } = controlNativeMotion(surface);
    const background = screen.getByRole('button', { name: '主页其他操作' });
    await expand(); expect(background.inert).toBe(true);
    rerender(page('account-after-animation'));
    await screen.findByRole('heading', { name: '你好，新账号。' });
    expect(motions[0].cancel).toHaveBeenCalledOnce(); expect(signal.aborted).toBe(true);
    expect(background.inert).not.toBe(true); expect(document.body.style.overflow).not.toBe('hidden');
    const currentInput = screen.getByLabelText('Colliers AI'); currentInput.focus();
    await act(async () => {
      motions[0].finish(); pending.resolve({ status: 'clarification', message: '旧账号的动画后回包' });
    });
    expect(currentInput).toHaveFocus();
    expect(screen.getByRole('dialog')).toHaveAttribute('data-mode', 'focus');
    expect(screen.queryByText('旧账号的动画后回包')).not.toBeInTheDocument();
  });

  it('settles native geometry on a visual viewport resize without replacing the draft or leaving the page locked', async () => {
    const viewport = Object.assign(new EventTarget(), { width: 390, height: 760, offsetTop: 0, offsetLeft: 0 });
    vi.stubGlobal('visualViewport', viewport);
    const { input } = await open(); fireEvent.change(input, { target: { value: '软键盘打开时的草稿' } }); input.focus();
    const surface = input.closest('#colliers-ai') as HTMLElement;
    const { motions } = controlNativeMotion(surface);
    await expand();
    viewport.height = 360; viewport.offsetTop = 44;
    await act(async () => viewport.dispatchEvent(new Event('resize')));
    expect(motions[0].finish).toHaveBeenCalledOnce();
    expect(surface.style.getPropertyValue('--query-viewport-height')).toBe('360px');
    expect(surface.style.getPropertyValue('--query-viewport-top')).toBe('44px');
    expect(input).toHaveValue('软键盘打开时的草稿'); expect(input).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: collapseName }));
    viewport.height = 760; viewport.offsetTop = 0;
    await act(async () => viewport.dispatchEvent(new Event('resize')));
    expect(motions[1].finish).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('closes side panels before a narrow drawer could cover a composing draft and does not reopen them on widening', async () => {
    const viewport = controlResponsiveWidth(1440);
    client.submit.mockImplementation(async (_scope, body: Submission) => ({ requestId: requestIds[0], status: 'ready', result, conversation: body.conversation }));
    const { input } = await open(); send(input, '2026Q3 CBD净有效租金');
    await screen.findByRole('region', { name: '查询结果' }); await expand();
    fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    const historyPanel = await screen.findByRole('complementary', { name: '历史工作记录' });
    const search = within(historyPanel).getByRole('searchbox', { name: '搜索标题或最近问题' });
    fireEvent.click(screen.getByRole('button', { name: '研究资料' }));
    const researchPanel = await screen.findByRole('complementary', { name: '研究资料与口径' });
    expect(historyPanel).toBeVisible(); expect(researchPanel).toBeVisible();
    fireEvent.change(input, { target: { value: '缩窄窗口时仍在编辑的草稿' } });
    input.focus(); input.setSelectionRange(2, 6); fireEvent.compositionStart(input);
    act(() => viewport.resize(320));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '历史工作记录' })).not.toBeInTheDocument());
    expect(screen.queryByRole('complementary', { name: '研究资料与口径' })).not.toBeInTheDocument();
    expect(historyPanel).toBeInTheDocument(); expect(historyPanel).not.toBeVisible();
    expect(search).toBeInTheDocument(); expect(input).toHaveFocus(); expect(input).toHaveValue('缩窄窗口时仍在编辑的草稿');
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 6]);
    fireEvent.keyDown(input, { key: 'Escape' }); expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => viewport.resize(1440));
    expect(screen.queryByRole('complementary', { name: '历史工作记录' })).not.toBeInTheDocument();
    expect(researchPanel).not.toBeVisible();
    fireEvent.compositionEnd(input); fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    expect(screen.getByRole('complementary', { name: '历史工作记录' })).toBe(historyPanel);
    expect(within(historyPanel).getByRole('searchbox', { name: '搜索标题或最近问题' })).toBe(search);
    expect(client.submit).toHaveBeenCalledOnce(); expect(client.recover).not.toHaveBeenCalled();
  });

  it('keeps the history search and its IME focus when a dual-panel desktop workspace becomes narrow', async () => {
    const viewport = controlResponsiveWidth(1440);
    client.submit.mockImplementation(async (_scope, body: Submission) => ({ requestId: requestIds[0], status: 'ready', result, conversation: body.conversation }));
    const { input } = await open(); send(input, '2026Q3 CBD净有效租金');
    await screen.findByRole('region', { name: '查询结果' }); await expand();
    fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    const historyPanel = await screen.findByRole('complementary', { name: '历史工作记录' });
    fireEvent.click(screen.getByRole('button', { name: '研究资料' }));
    const researchPanel = await screen.findByRole('complementary', { name: '研究资料与口径' });
    const search = within(historyPanel).getByRole('searchbox', { name: '搜索标题或最近问题' });
    search.focus(); fireEvent.compositionStart(search); fireEvent.change(search, { target: { value: '中文历史研究' } });
    act(() => viewport.resize(320));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '研究资料与口径' })).not.toBeInTheDocument());
    expect(screen.getByRole('complementary', { name: '历史工作记录' })).toBe(historyPanel);
    expect(researchPanel).toBeInTheDocument(); expect(researchPanel).not.toBeVisible();
    expect(search).toHaveFocus(); expect(search).toHaveValue('中文历史研究');
    fireEvent.keyDown(search, { key: 'Escape' }); expect(screen.getByRole('dialog', { name: 'Colliers AI 工作空间' })).toBeInTheDocument();
    act(() => viewport.resize(1440));
    expect(screen.queryByRole('complementary', { name: '研究资料与口径' })).not.toBeInTheDocument();
    expect(search).toHaveFocus(); expect(search).toHaveValue('中文历史研究');
    fireEvent.compositionEnd(search); fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: expandName })).toHaveFocus();
    expect(client.submit).toHaveBeenCalledOnce(); expect(client.recover).not.toHaveBeenCalled();
  });

  it('keeps the focused research panel when both side panels become a drawer', async () => {
    const viewport = controlResponsiveWidth(1440);
    client.submit.mockImplementation(async (_scope, body: Submission) => ({ requestId: requestIds[0], status: 'ready', result, conversation: body.conversation }));
    const { input } = await open(); send(input, '2026Q3 CBD净有效租金');
    await screen.findByRole('region', { name: '查询结果' }); await expand();
    fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    const historyPanel = await screen.findByRole('complementary', { name: '历史工作记录' });
    const search = within(historyPanel).getByRole('searchbox', { name: '搜索标题或最近问题' });
    fireEvent.change(search, { target: { value: '保留的历史筛选' } });
    fireEvent.click(screen.getByRole('button', { name: '研究资料' }));
    const researchPanel = await screen.findByRole('complementary', { name: '研究资料与口径' });
    const sourceButton = within(researchPanel).getByRole('button', { name: '查看来源明细' });
    sourceButton.focus();
    act(() => viewport.resize(320));
    expect(screen.getByRole('dialog', { name: '研究资料侧栏' })).toBeVisible();
    expect(screen.getByRole('complementary', { name: '研究资料与口径' })).toBe(researchPanel);
    expect(sourceButton).toHaveFocus();
    expect(historyPanel).toBeInTheDocument(); expect(historyPanel).not.toBeVisible();
    expect(search).toBeInTheDocument(); expect(search).toHaveValue('保留的历史筛选');
    act(() => viewport.resize(1440));
    expect(sourceButton).toHaveFocus(); expect(researchPanel).toBeVisible();
    expect(historyPanel).not.toBeVisible(); expect(screen.getByLabelText('Colliers AI')).toBe(input);
    fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    expect(within(historyPanel).getByRole('searchbox', { name: '搜索标题或最近问题' })).toBe(search);
    expect(search).toHaveValue('保留的历史筛选');
    expect(client.submit).toHaveBeenCalledOnce(); expect(client.recover).not.toHaveBeenCalled();
  });

  it('honors reduced motion even when native animation is available', async () => {
    const { input } = await open(); const surface = input.closest('#colliers-ai') as HTMLElement;
    const { animate } = controlNativeMotion(surface, true);
    await expand(); await collapse();
    expect(animate).not.toHaveBeenCalled(); expect(screen.getByLabelText('Colliers AI')).toBe(input);
    expect(screen.getByRole('button', { name: expandName })).toHaveFocus();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('does not lose the new-message position when a pending reply arrives during the native transition', async () => {
    const pending = deferred<unknown>(); client.submit.mockReturnValue(pending.promise);
    const { input } = await open(); send(input, '在动画中完成的问题');
    const surface = input.closest('#colliers-ai') as HTMLElement;
    const transcript = screen.getByRole('region', { name: '对话记录' });
    let height = 900;
    Object.defineProperties(transcript, { clientHeight: { configurable: true, value: 300 }, scrollHeight: { configurable: true, get: () => height } });
    transcript.scrollTop = 600; fireEvent.scroll(transcript);
    const { motions } = controlNativeMotion(surface);
    await expand(); height = 1500;
    await act(async () => pending.resolve(help(client.submit.mock.calls[0][1])));
    await screen.findByText('助手回应：在动画中完成的问题');
    await act(async () => motions[0].finish());
    // Either continue following the end or offer an explicit latest-message
    // action. A response must not silently stay below the visible scroll area.
    expect(transcript.scrollTop >= height - 300 || !!screen.queryByRole('button', { name: '回到最新消息' })).toBe(true);
    expect(client.submit).toHaveBeenCalledOnce();
  });

  it('keeps the expanded workspace open while history search is composing even without a reliable native composing flag', async () => {
    await open(); await expand(); fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    const search = await screen.findByRole('searchbox', { name: '搜索标题或最近问题' });
    search.focus(); fireEvent.compositionStart(search); fireEvent.change(search, { target: { value: '中文历史检索' } });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Colliers AI 工作空间' })).toBeInTheDocument();
    expect(search).toHaveFocus(); expect(search).toHaveValue('中文历史检索');
    fireEvent.compositionEnd(search); fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('does not keep a stale composition lock after a permission change removes history input or resets the retained composer', async () => {
    const { input } = await open(); await expand(); fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    const search = await screen.findByRole('searchbox', { name: '搜索标题或最近问题' });
    search.focus(); fireEvent.compositionStart(search); fireEvent.change(search, { target: { value: '权限变化前正在组词' } });
    client.capabilities.mockResolvedValue({ ...access, permissionRevision: 'revision-two' });
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(search).not.toBeInTheDocument(); expect(input).toBeEnabled();
    // An element removed during composition need not deliver compositionend to
    // the still-mounted surface. It must not lock keyboard navigation forever.
    await expand(); input.focus(); fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: expandName })).toHaveFocus();
    await expand(); input.focus(); fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '主输入框也正在组词' } });
    client.capabilities.mockResolvedValue({ ...access, permissionRevision: 'revision-three' }); fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(input).toBeInTheDocument(); expect(input).toHaveValue('');
    await expand(); input.focus(); fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
