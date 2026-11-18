import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryConversation } from '@/src/lib/intelligence/query/conversationProtocol';

const client = vi.hoisted(() => ({ capabilities: vi.fn(), submit: vi.fn(), recover: vi.fn(), reportDelivery: vi.fn() }));
const historyClient = vi.hoisted(() => ({ list: vi.fn(), open: vi.fn(), change: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client,
  queryScopeKey: (scope: object) => JSON.stringify(scope) }));
vi.mock('@/src/services/trustedQueryHistoryClient', () => ({ trustedQueryHistoryClient: historyClient }));
import { HomeQuery } from '../HomeQuery';

const scope = { actorId: 'focus-owner', effectiveId: 'focus-owner', sessionId: 'focus-session', targetId: null };
const question = '按子市场比较北京2026年第3季度的净有效租金和空置率，并列出数据来源';
const access = { enabled: true, permissionRevision: 'focus-revision', examples: [question] };
const expandName = '展开 Colliers AI 工作空间', collapseName = '收起 Colliers AI 工作空间';
const fullscreenName = '全屏 Colliers AI 工作空间', leaveFullscreenName = '退出全屏 Colliers AI 工作空间';
type Submission = { idempotencyKey: string; question: string; conversation: QueryConversation };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function reply(body: Submission) {
  return { requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'clarification', reason: 'assistant_help',
    conversation: body.conversation, message: `已回答：${body.question}`, options: [] };
}
async function open() {
  const view = render(<div style={{ overflowY: 'auto', height: '400px' }} data-testid="homepage-scroll">
    <button type="button">主页业务入口</button><HomeQuery scope={scope} displayName="Ron" />
  </div>);
  const input = screen.getByRole('textbox', { name: '向 Colliers AI 提问' }) as HTMLTextAreaElement;
  await waitFor(() => expect(input).toBeEnabled());
  return { ...view, input, surface: input.closest('#colliers-ai') as HTMLElement };
}
type MotionTarget = 'surface' | 'composer' | 'editor';
function controlSpatialMotion(surface: HTMLElement, input: HTMLTextAreaElement) {
  vi.mocked(window.matchMedia).mockImplementation(query => ({ matches: false, media: query,
    onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }));
  const composer = input.parentElement!, slot = composer.parentElement!, anchor = surface.parentElement!;
  const mode = () => surface.dataset.mode;
  vi.spyOn(surface, 'getBoundingClientRect').mockImplementation(() => mode() === 'expanded'
    ? new DOMRect(0, 0, 1280, 800) : mode() === 'focus' ? new DOMRect(80, 60, 1120, 680)
      : new DOMRect(Number.parseFloat(surface.style.getPropertyValue('--query-compact-left')) || 80,
        Number.parseFloat(surface.style.getPropertyValue('--query-compact-top')) || 160, 720, 300));
  vi.spyOn(composer, 'getBoundingClientRect').mockImplementation(() => mode() === 'compact'
    ? new DOMRect(140, 240, 600, 56) : new DOMRect(240, mode() === 'focus' ? 600 : 650, 800, 120));
  vi.spyOn(input, 'getBoundingClientRect').mockImplementation(() => mode() === 'compact'
    ? new DOMRect(156, 254, 524, 28) : new DOMRect(260, mode() === 'focus' ? 616 : 666, 760, 56));
  const anchorBounds = vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(80, 160, 720, 300));
  const motions: Array<{ target: MotionTarget; animation: Animation; keyframes: Keyframe[] }> = [];
  for (const [target, node] of [['surface', surface], ['composer', composer], ['editor', input]] as const) {
    Object.defineProperty(node, 'animate', { configurable: true, value: vi.fn((keyframes: Keyframe[]) => {
      let resolve!: (value: Animation) => void, reject!: (reason: Error) => void;
      const finished = new Promise<Animation>((done, fail) => { resolve = done; reject = fail; });
      const animation = { finished, finish: vi.fn(() => resolve(animation)),
        cancel: vi.fn(() => reject(new DOMException('Superseded geometry', 'AbortError'))) } as unknown as Animation;
      motions.push({ target, animation, keyframes }); return animation;
    }) });
  }
  return { composer, slot, anchor, anchorBounds, motions,
    latest: (target: MotionTarget) => motions.findLast(motion => motion.target === target)! };
}
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); window.history.replaceState(null, '', '/');
  client.capabilities.mockResolvedValue(access); client.reportDelivery.mockResolvedValue(true);
  historyClient.list.mockResolvedValue({ entries: [], hasMore: false, indexing: false, unavailable: 0 });
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query,
    onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Colliers AI 3.0 focus entry', () => {
  it('opens focus from the real editor and keeps continuous typing, middle edits and selection across all three modes', async () => {
    const { input, surface } = await open(); const user = userEvent.setup();
    expect(surface).toHaveAttribute('data-mode', 'compact'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(input); await user.keyboard('C');
    await waitFor(() => expect(surface).toHaveAttribute('data-mode', 'focus'));
    expect(screen.getByRole('dialog', { name: 'Colliers AI 工作空间' })).toBe(surface);
    expect(input).toHaveFocus(); expect(input).toHaveValue('C');
    await user.keyboard('BD市场'); input.setSelectionRange(1, 2); await user.keyboard('栋');
    expect(input).toHaveValue('C栋D市场');
    input.setSelectionRange(1, 4);
    fireEvent.pointerDown(screen.getByRole('button', { name: fullscreenName }));
    fireEvent.click(screen.getByRole('button', { name: fullscreenName }));
    expect(surface).toHaveAttribute('data-mode', 'expanded');
    fireEvent.pointerDown(screen.getByRole('button', { name: leaveFullscreenName }));
    fireEvent.click(screen.getByRole('button', { name: leaveFullscreenName }));
    expect(surface).toHaveAttribute('data-mode', 'focus');
    expect(input).toHaveFocus(); expect([input.selectionStart, input.selectionEnd]).toEqual([1, 4]);
    fireEvent.click(screen.getByRole('button', { name: collapseName }));
    await waitFor(() => expect(surface).toHaveAttribute('data-floating', 'false'));
    expect(surface).toHaveAttribute('data-mode', 'compact');
    expect(screen.getByRole('textbox', { name: '向 Colliers AI 提问' })).toBe(input);
    expect(document.querySelectorAll('#home-query')).toHaveLength(1);
    expect(input).toHaveValue('C栋D市场'); expect([input.selectionStart, input.selectionEnd]).toEqual([1, 4]);
    expect(client.submit).not.toHaveBeenCalled(); expect(client.recover).not.toHaveBeenCalled();
  });

  it('edits the complete suggested question in focus and waits for explicit submission', async () => {
    client.submit.mockImplementation(async (_scope, body: Submission) => reply(body));
    const { input, surface } = await open(); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: `比较不同区域：${question}` }));
    expect(surface).toHaveAttribute('data-mode', 'focus'); expect(input).toHaveFocus();
    expect(input).toHaveValue(question); expect(client.submit).not.toHaveBeenCalled();
    await user.keyboard('，请解释口径');
    expect(input).toHaveValue(`${question}，请解释口径`);
    await user.keyboard('{Enter}');
    await screen.findByText(`已回答：${question}，请解释口径`);
    expect(client.submit).toHaveBeenCalledOnce();
    expect(client.submit.mock.calls[0][1].question).toBe(`${question}，请解释口径`);
  });

  it('opens directly into full screen without automatically opening or fetching history on desktop', async () => {
    vi.mocked(window.matchMedia).mockImplementation(query => ({ matches: query.includes('min-width') || query.includes('prefers-reduced-motion'), media: query,
      onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }));
    const { surface } = await open();
    fireEvent.click(screen.getByRole('button', { name: expandName }));
    expect(surface).toHaveAttribute('data-mode', 'expanded');
    expect(screen.getByRole('button', { name: collapseName })).toBeVisible();
    expect(screen.getByRole('button', { name: leaveFullscreenName })).toBeVisible();
    expect(screen.queryByRole('complementary', { name: '历史工作记录' })).not.toBeInTheDocument();
    expect(historyClient.list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    await screen.findByRole('complementary', { name: '历史工作记录' });
    expect(historyClient.list).toHaveBeenCalledOnce();
  });

  it('does not collapse on ordinary blur and does not reopen when explicit close restores focus', async () => {
    const { input, surface } = await open(); const user = userEvent.setup();
    await user.click(input); await user.keyboard('保留的草稿');
    fireEvent.blur(input);
    expect(surface).toHaveAttribute('data-mode', 'focus');
    fireEvent.click(screen.getByRole('button', { name: collapseName }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: expandName })).toHaveFocus();
    expect(surface).toHaveAttribute('data-mode', 'compact');
    expect(input).toHaveValue('保留的草稿');
    await user.click(input);
    expect(surface).toHaveAttribute('data-mode', 'focus'); expect(input).toHaveFocus();
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('preserves composition and editor focus while explicitly switching focus and full screen', async () => {
    client.submit.mockImplementation(async (_scope, body: Submission) => reply(body));
    const { input, surface } = await open(); const user = userEvent.setup();
    await user.click(input); fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '正在组合的中文' } }); input.setSelectionRange(2, 5);
    const fullscreen = screen.getByRole('button', { name: fullscreenName });
    expect(fireEvent.pointerDown(fullscreen)).toBe(false); fireEvent.click(fullscreen);
    expect(surface).toHaveAttribute('data-mode', 'expanded'); expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); fireEvent.keyDown(input, { key: 'Escape' });
    const restore = screen.getByRole('button', { name: leaveFullscreenName });
    expect(fireEvent.pointerDown(restore)).toBe(false); fireEvent.click(restore);
    expect(surface).toHaveAttribute('data-mode', 'focus');
    expect(input).toHaveFocus(); expect(input).toHaveValue('正在组合的中文');
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
    expect(client.submit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input); fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(client.submit).not.toHaveBeenCalled();
    input.setSelectionRange(input.value.length, input.value.length); await user.keyboard('继续');
    await user.keyboard('{Enter}'); await screen.findByText('已回答：正在组合的中文继续');
    expect(client.submit).toHaveBeenCalledOnce();
  });

  it('keeps an in-flight request and the next draft through focus, full screen and closing to the homepage', async () => {
    const pending = deferred<unknown>(); client.submit.mockReturnValue(pending.promise);
    const { input, surface } = await open(); const user = userEvent.setup();
    await user.click(input); await user.keyboard('第一个问题{Enter}');
    const [, body, signal] = client.submit.mock.calls[0] as [object, Submission, AbortSignal];
    await user.keyboard('尚未发送的新草稿'); input.setSelectionRange(2, 5);
    fireEvent.click(screen.getByRole('button', { name: fullscreenName }));
    fireEvent.click(screen.getByRole('button', { name: collapseName }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(signal.aborted).toBe(false);
    await act(async () => pending.resolve(reply(body)));
    const answer = await screen.findByText('已回答：第一个问题');
    expect(surface).toHaveAttribute('data-mode', 'compact');
    expect(input).toHaveValue('尚未发送的新草稿');
    act(() => input.focus());
    expect(surface).toHaveAttribute('data-mode', 'focus');
    expect(screen.getByText('已回答：第一个问题')).toBe(answer);
    expect(input).toHaveFocus(); expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
    expect(client.submit).toHaveBeenCalledOnce(); expect(client.recover).not.toHaveBeenCalled();
    await waitFor(() => expect(client.reportDelivery).toHaveBeenCalledOnce());
  });

  it('tracks the keyboard viewport and restores the real homepage scroll container when leaving focus', async () => {
    const viewport = Object.assign(new EventTarget(), { width: 390, height: 760, offsetTop: 0, offsetLeft: 0 });
    vi.stubGlobal('visualViewport', viewport);
    const { input, surface } = await open(); const user = userEvent.setup();
    const homepage = screen.getByTestId('homepage-scroll'); homepage.scrollTop = 222;
    await user.click(input); await user.keyboard('键盘弹起时的草稿');
    expect(surface).toHaveAttribute('data-mode', 'focus');
    viewport.height = 330; viewport.offsetTop = 36;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(surface.style.getPropertyValue('--query-viewport-height')).toBe('330px');
    expect(surface.style.getPropertyValue('--query-viewport-top')).toBe('36px');
    expect(input).toHaveFocus(); expect(input).toHaveValue('键盘弹起时的草稿');
    // Mobile engines can adjust a scroll ancestor while revealing a focused
    // editor. Closing restores the captured homepage position, not that offset.
    homepage.scrollTop = 286;
    fireEvent.click(screen.getByRole('button', { name: collapseName }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    viewport.height = 760; viewport.offsetTop = 0;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(homepage.scrollTop).toBe(222);
    expect(homepage.style.overflow).not.toBe('hidden');
    expect(screen.getByRole('textbox', { name: '向 Colliers AI 提问' })).toBe(input);
    expect(input).toHaveValue('键盘弹起时的草稿');
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('does not hide an actively composing history editor when closing focus', async () => {
    const { input, surface } = await open(); const user = userEvent.setup();
    await user.click(input); fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    const search = await screen.findByRole('searchbox', { name: '搜索标题或最近问题' });
    act(() => search.focus()); fireEvent.compositionStart(search);
    fireEvent.change(search, { target: { value: '正在组合的历史检索词' } });
    const close = screen.getByRole('button', { name: collapseName });
    expect(fireEvent.pointerDown(close)).toBe(false); fireEvent.click(close);
    expect(surface).toHaveAttribute('data-mode', 'focus');
    expect(search).toHaveFocus(); expect(search).toBeVisible();
    fireEvent.compositionEnd(search); fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(search).toBeInTheDocument(); expect(search).toHaveValue('正在组合的历史检索词');
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('settles the latest ticket when focus and Escape reverse a pending collapse in one React batch', async () => {
    const { input, surface } = await open();
    const motion = controlSpatialMotion(surface, input);
    fireEvent.click(screen.getByRole('button', { name: expandName }));
    await act(async () => motion.latest('surface').animation.finish());
    fireEvent.click(screen.getByRole('button', { name: collapseName }));
    const previousClose = motion.latest('surface').animation;
    expect(surface).toHaveAttribute('data-mode', 'compact');
    expect(surface).toHaveAttribute('data-transitioning', 'true');
    const writes = vi.spyOn(surface, 'setAttribute');
    act(() => {
      input.focus();
      // Use native events inside the shared batch. fireEvent would flush its
      // own act boundary, hiding a same-mode/updated-ticket scheduling defect.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(writes.mock.calls.some(([name, value]) => name === 'data-mode' && value === 'focus')).toBe(false);
    expect(surface).toHaveAttribute('data-mode', 'compact');
    expect(previousClose.cancel).toHaveBeenCalledOnce();
    expect(motion.motions.filter(item => item.target === 'surface')).toHaveLength(3);
    await act(async () => motion.latest('surface').animation.finish());
    expect(surface).toHaveAttribute('data-transitioning', 'false');
    expect(surface).toHaveAttribute('data-floating', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '主页业务入口' }).inert).not.toBe(true);
    expect(screen.getByTestId('homepage-scroll').style.overflow).not.toBe('hidden');
    expect(input).toBe(screen.getByRole('textbox', { name: '向 Colliers AI 提问' }));
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('finishes shell, composer and editor motions on an offset-only visual viewport scroll', async () => {
    const viewport = Object.assign(new EventTarget(), { width: 390, height: 760, offsetTop: 0, offsetLeft: 0 });
    vi.stubGlobal('visualViewport', viewport);
    const { input, surface } = await open(); const motion = controlSpatialMotion(surface, input);
    fireEvent.change(input, { target: { value: '平移视口时保留的草稿' } });
    act(() => input.focus()); input.setSelectionRange(2, 5);
    const opening = [...motion.motions];
    expect(opening.map(item => item.target).sort()).toEqual(['composer', 'editor', 'surface']);
    expect(motion.composer.style.position).toBe('fixed');
    viewport.offsetTop = 44; viewport.offsetLeft = 3;
    await act(async () => viewport.dispatchEvent(new Event('scroll')));
    for (const item of opening) expect(item.animation.finish).toHaveBeenCalledOnce();
    expect(surface.style.getPropertyValue('--query-viewport-top')).toBe('44px');
    expect(surface.style.getPropertyValue('--query-viewport-left')).toBe('3px');
    expect(surface.style.getPropertyValue('--query-viewport-height')).toBe('760px');
    expect(surface).toHaveAttribute('data-transitioning', 'false');
    expect(motion.composer.style.position).toBe(''); expect(motion.slot.style.height).toBe('');
    expect(input).toHaveFocus(); expect(input).toHaveValue('平移视口时保留的草稿');
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
    fireEvent.click(screen.getByRole('button', { name: collapseName }));
    const closing = motion.motions.slice(opening.length);
    viewport.offsetTop = 0; viewport.offsetLeft = 0;
    await act(async () => viewport.dispatchEvent(new Event('scroll')));
    for (const item of closing) expect(item.animation.finish).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(input.parentElement).toBe(motion.composer);
  });

  it('restores the locked homepage position before measuring the collapse destination', async () => {
    const { input, surface } = await open(); const motion = controlSpatialMotion(surface, input);
    const homepage = screen.getByTestId('homepage-scroll');
    homepage.scrollTop = 222; homepage.scrollLeft = 12;
    const measured: Array<{ top: number; left: number }> = [];
    motion.anchorBounds.mockImplementation(() => {
      measured.push({ top: homepage.scrollTop, left: homepage.scrollLeft });
      return new DOMRect(80 - homepage.scrollLeft, 382 - homepage.scrollTop, 720, 300);
    });
    act(() => input.focus());
    await act(async () => motion.latest('surface').animation.finish());
    homepage.scrollTop = 286; homepage.scrollLeft = 44; measured.length = 0;
    fireEvent.click(screen.getByRole('button', { name: collapseName }));
    // Observe the destination while the reverse motion is still running, not
    // only the cleanup's eventual restored scrollTop after its final frame.
    expect(surface).toHaveAttribute('data-transitioning', 'true');
    expect(measured).not.toHaveLength(0);
    expect(measured.every(position => position.top === 222 && position.left === 12)).toBe(true);
    expect(surface.style.getPropertyValue('--query-compact-top')).toBe('160px');
    expect(surface.style.getPropertyValue('--query-compact-left')).toBe('68px');
    expect(motion.latest('surface').keyframes.at(-1)).toMatchObject({ top: '160px', left: '68px' });
    expect(homepage.scrollTop).toBe(222); expect(homepage.scrollLeft).toBe(12);
    await act(async () => motion.latest('surface').animation.finish());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(homepage.scrollTop).toBe(222);
  });

  it('cancels all superseded motions and restores inline styles without reparenting the editor or its text node', async () => {
    const { input, surface, unmount } = await open(); const motion = controlSpatialMotion(surface, input);
    fireEvent.change(input, { target: { value: '反向和卸载仍保留编辑节点' } });
    const textNode = input.firstChild, composerParent = motion.composer.parentElement;
    expect(textNode).not.toBeNull();
    motion.composer.style.borderColor = 'rgb(1, 2, 3)'; motion.slot.style.height = '14px';
    input.style.minHeight = '19px'; input.style.flexShrink = '.5';
    const normalComposerStyle = motion.composer.style.cssText;
    act(() => input.focus()); input.setSelectionRange(2, 6);
    const opening = [...motion.motions];
    fireEvent.click(screen.getByRole('button', { name: fullscreenName }));
    for (const item of opening) expect(item.animation.cancel).toHaveBeenCalledOnce();
    const full = motion.motions.slice(opening.length);
    fireEvent.click(screen.getByRole('button', { name: collapseName }));
    for (const item of full) expect(item.animation.cancel).toHaveBeenCalledOnce();
    await act(async () => {
      opening.find(item => item.target === 'surface')!.animation.finish();
      full.find(item => item.target === 'surface')!.animation.finish();
    });
    expect(surface).toHaveAttribute('data-transitioning', 'true');
    expect(screen.getByRole('button', { name: '主页业务入口' }).inert).toBe(true);
    await act(async () => motion.latest('surface').animation.finish());
    expect(surface).toHaveAttribute('data-floating', 'false');
    expect(motion.composer.style.cssText).toBe(normalComposerStyle); expect(motion.slot.style.height).toBe('14px');
    expect(input.style.minHeight).toBe('19px'); expect(input.style.flexShrink).toBe('0.5');
    expect(input.parentElement).toBe(motion.composer); expect(motion.composer.parentElement).toBe(composerParent);
    expect(input.firstChild).toBe(textNode); expect([input.selectionStart, input.selectionEnd]).toEqual([2, 6]);
    expect(input).toHaveValue('反向和卸载仍保留编辑节点');
    act(() => input.focus()); const pending = motion.motions.slice(-3);
    expect(motion.composer.style.position).toBe('fixed');
    unmount();
    for (const item of pending) expect(item.animation.cancel).toHaveBeenCalledOnce();
    expect(motion.composer.style.cssText).toBe(normalComposerStyle); expect(motion.slot.style.height).toBe('14px');
    expect(input.style.minHeight).toBe('19px'); expect(input.style.flexShrink).toBe('0.5');
    expect(input.parentElement).toBe(motion.composer); expect(input.firstChild).toBe(textNode);
    await act(async () => pending.find(item => item.target === 'surface')!.animation.finish());
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(client.submit).not.toHaveBeenCalled();
  });
});
