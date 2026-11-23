import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQueryScroll } from '../useQueryWorkspace';

const callbacks = new Set<ResizeObserverCallback>();
function notifyLayout() {
  act(() => { for (const callback of callbacks) callback([], {} as ResizeObserver); });
}
function Harness({ update = 0, transitioning = false }: { update?: number; transitioning?: boolean }) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const scroll = useQueryScroll(scroller, update, transitioning);
  return <>
    <button onClick={scroll.toLatest}>最新消息</button>
    <button onClick={scroll.followNext}>继续跟随</button>
    <button onClick={scroll.revealNextAnswer}>准备显示正式结果</button>
    <button onClick={scroll.preserveBeforePrepend}>准备加载更早问答</button>
    <div ref={scroller} data-testid="scroller" onScroll={scroll.onScroll}><div>
      <article data-query-turn="first">第一轮<button>查看第一轮来源</button></article><article data-query-turn="second" aria-label="本次问答">第二轮</article>
    </div></div>
    {scroll.unseen && <span>有新回答</span>}
  </>;
}
function geometry(initialHeight: number) {
  const node = screen.getByTestId('scroller');
  let height = initialHeight, top = 0, prepended = 0;
  Object.defineProperties(node, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, get: () => height },
    scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, height - 200)); } },
  });
  vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 600, 200));
  vi.spyOn(screen.getByText('第一轮'), 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, prepended - top, 600, 500));
  vi.spyOn(screen.getByText('第二轮'), 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, prepended + 500 - top, 600, 700));
  return { node, resize: (next: number) => { height = next; }, prepend: (next: number) => { height += next; prepended += next; },
    userScroll: (value: number) => { node.scrollTop = value; fireEvent.scroll(node); } };
}
beforeEach(() => {
  callbacks.clear();
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) { callbacks.add(callback); }
    observe() {} unobserve() {}
    disconnect() { callbacks.delete(this.callback); }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('conversation scroll after asynchronous rendering', () => {
  it('follows actual Markdown height changes after the parent update has already committed', () => {
    render(<Harness />); const view = geometry(500);
    fireEvent.click(screen.getByRole('button', { name: '最新消息' }));
    expect(view.node.scrollTop).toBe(300);
    view.resize(900); notifyLayout();
    expect(view.node.scrollTop).toBe(700);
    fireEvent.scroll(view.node); // Browser reports our programmatic movement.
    view.resize(1100); notifyLayout();
    expect(view.node.scrollTop).toBe(900);
  });
  it('keeps a reader of old messages still, and only marks actual response updates as unseen', () => {
    const rendered = render(<Harness />); const view = geometry(900);
    fireEvent.click(screen.getByRole('button', { name: '最新消息' }));
    view.userScroll(100); view.resize(1100); notifyLayout();
    expect(view.node.scrollTop).toBe(100);
    expect(screen.queryByText('有新回答')).toBeNull();
    rendered.rerender(<Harness update={1} />);
    expect(screen.getByText('有新回答')).toBeInTheDocument();
    view.resize(1300); notifyLayout();
    expect(view.node.scrollTop).toBe(100);
    fireEvent.click(screen.getByRole('button', { name: '最新消息' }));
    expect(view.node.scrollTop).toBe(1100); expect(screen.queryByText('有新回答')).toBeNull();
  });
  it('reveals a newly completed structured answer from its lead and keeps that lead through lazy chart layout', () => {
    const rendered = render(<Harness />); const view = geometry(1200);
    fireEvent.click(screen.getByRole('button', { name: '最新消息' }));
    fireEvent.click(screen.getByRole('button', { name: '准备显示正式结果' }));
    rendered.rerender(<Harness update={1} />);
    expect(view.node.scrollTop).toBe(484);
    expect(screen.queryByText('有新回答')).toBeNull();
    view.resize(1700); notifyLayout();
    expect(view.node.scrollTop).toBe(484);
    view.userScroll(650); view.resize(1900); notifyLayout();
    expect(view.node.scrollTop).toBe(650);
  });
  it('never reveals a structured result over a reader who has scrolled back', () => {
    const rendered = render(<Harness />); const view = geometry(1200);
    fireEvent.click(screen.getByRole('button', { name: '最新消息' }));
    view.userScroll(100);
    fireEvent.click(screen.getByRole('button', { name: '准备显示正式结果' }));
    rendered.rerender(<Harness update={1} />);
    expect(view.node.scrollTop).toBe(100);
    expect(screen.getByText('有新回答')).toBeInTheDocument();
  });
  it('cancels a pending lead reveal when the reader moves before the result commits', () => {
    const rendered = render(<Harness />); const view = geometry(1200);
    fireEvent.click(screen.getByRole('button', { name: '最新消息' }));
    fireEvent.click(screen.getByRole('button', { name: '准备显示正式结果' }));
    view.userScroll(100);
    rendered.rerender(<Harness update={1} />);
    expect(view.node.scrollTop).toBe(100);
    expect(screen.getByText('有新回答')).toBeInTheDocument();
  });
  it('retains the same turn offset through prepending and later lazy rendering until the reader scrolls', () => {
    render(<Harness />); const view = geometry(1200);
    view.userScroll(550);
    fireEvent.click(screen.getByRole('button', { name: '准备加载更早问答' }));
    view.prepend(200); notifyLayout(); expect(view.node.scrollTop).toBe(750);
    fireEvent.scroll(view.node);
    view.prepend(300); notifyLayout(); expect(view.node.scrollTop).toBe(1050);
    expect(screen.getByText('第二轮').getBoundingClientRect().top).toBe(-50);
    view.userScroll(900);
    view.prepend(300); notifyLayout(); expect(view.node.scrollTop).toBe(900);
  });
  it('defers real layout following during a workspace transition and releases anchors for explicit following', () => {
    const rendered = render(<Harness />); const view = geometry(500);
    fireEvent.click(screen.getByRole('button', { name: '最新消息' }));
    rendered.rerender(<Harness transitioning />);
    view.resize(900); notifyLayout(); expect(view.node.scrollTop).toBe(300);
    rendered.rerender(<Harness />); expect(view.node.scrollTop).toBe(700);
    view.userScroll(100); fireEvent.click(screen.getByRole('button', { name: '准备加载更早问答' }));
    fireEvent.click(screen.getByRole('button', { name: '继续跟随' }));
    view.resize(1100); notifyLayout(); expect(view.node.scrollTop).toBe(900);
  });
});

it.each(['focusin','keydown'] as const)('releases result following on %s before a delayed native scroll event',event=>{
  render(<Harness />);const view=geometry(1200);
  fireEvent.click(screen.getByRole('button',{name:'最新消息'}));
  // Focus revelation writes the reading position before the browser emits scroll.
  // A lazy chart can resize in that interval; it must not reclaim the tail.
  const control=screen.getByRole('button',{name:'查看第一轮来源'});
  if(event==='focusin')fireEvent.focusIn(control);else fireEvent.keyDown(control,{key:'Tab'});
  view.node.scrollTop=100;
  view.resize(1700);notifyLayout();
  expect(view.node.scrollTop).toBe(100);
});
