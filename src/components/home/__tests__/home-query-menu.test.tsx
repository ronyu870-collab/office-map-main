import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HomeQueryMenu } from '../HomeQueryMenu';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('attaches document dismissal only while open and releases it after unmount', () => {
  const add = vi.spyOn(document, 'addEventListener'), remove = vi.spyOn(document, 'removeEventListener');
  const view = render(<HomeQueryMenu label="操作"><button>命令</button></HomeQueryMenu>);
  expect(add.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '操作' }));
  expect(add.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(1);
  view.unmount();
  expect(remove.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(1);
});
it('keeps native form editing open, dismisses commands and leaves no focusable hidden controls', () => {
  render(<HomeQueryMenu label="筛选"><label>字段<input type="checkbox" /></label><label>关键词<input /></label><button>执行</button></HomeQueryMenu>);
  const trigger = screen.getByRole('button', { name: '筛选' });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('checkbox', { name: '字段' }));
  const input = screen.getByRole('textbox', { name: '关键词' }); input.focus();
  fireEvent.change(input, { target: { value: '连续编辑' } });
  fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
  expect(input).toHaveFocus(); expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: '执行' }));
  expect(trigger).toHaveFocus(); expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
it('keeps one active menu across separate result/tool roots and closes when focus leaves', () => {
  render(<><HomeQueryMenu label="回答"><button>复制</button></HomeQueryMenu><HomeQueryMenu label="图表"><button>下载</button></HomeQueryMenu><input aria-label="外部" /></>);
  fireEvent.click(screen.getByRole('button', { name: '回答' }));
  fireEvent.click(screen.getByRole('button', { name: '图表' }));
  expect(screen.getByRole('button', { name: '回答' })).toHaveAttribute('aria-expanded', 'false');
  const download = screen.getByRole('button', { name: '下载' }); download.focus();
  fireEvent.blur(download, { relatedTarget: screen.getByRole('textbox') });
  expect(screen.queryByRole('button', { name: '下载' })).not.toBeInTheDocument();
});
it('ignores a queued pre-open scroll event but dismisses a new ancestor scroll', () => {
  const view = render(<div data-testid="scroll"><HomeQueryMenu label="导出"><button>下载</button></HomeQueryMenu></div>);
  const scroller = view.getByTestId('scroll');
  scroller.scrollTop = 100;
  const trigger = screen.getByRole('button', { name: '导出' });
  let top = 100;
  vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => ({ top, left: 0 }) as DOMRect);
  fireEvent.click(trigger);
  fireEvent.scroll(scroller);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  scroller.scrollTop = 120; top = 80; fireEvent.scroll(scroller);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

it('keeps an open menu when layout compensation changes ancestor scroll offsets without moving its anchor', () => {
  const view = render(<div data-testid="outer"><div data-testid="inner"><HomeQueryMenu label="更多"><button>复制</button></HomeQueryMenu></div></div>);
  const outer = view.getByTestId('outer'), inner = view.getByTestId('inner');
  const trigger = screen.getByRole('button', { name: '更多' });
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ top: 100, left: 200 } as DOMRect);
  outer.scrollTop = 100; inner.scrollTop = 100;
  fireEvent.click(trigger);
  outer.scrollTop = 90; inner.scrollTop = 110;
  fireEvent.scroll(inner); fireEvent.scroll(outer);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: '复制' }));
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

it('uses the latest measured anchor after a resize before checking compensated scrolling', () => {
  const popover = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'showPopover');
  Object.defineProperty(HTMLElement.prototype, 'showPopover', { value: () => {}, configurable: true });
  let frame: FrameRequestCallback | undefined;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 1; });
  try {
    const view = render(<div data-testid="scroll"><HomeQueryMenu label="重新定位"><button>复制</button></HomeQueryMenu></div>);
    const trigger = screen.getByRole('button', { name: '重新定位' }), scroller = view.getByTestId('scroll');
    let top = 100;
    vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => ({ top, bottom: top + 40, left: 200, right: 300, width: 100, height: 40 }) as DOMRect);
    fireEvent.click(trigger);
    top = 120;
    fireEvent(window, new Event('resize'));
    act(() => frame!(0));
    expect(view.container.querySelector('[data-query-menu-panel]')).toHaveStyle({ top: '164px' });
    scroller.scrollTop = 10; fireEvent.scroll(scroller);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    top = 110; scroller.scrollTop = 20; fireEvent.scroll(scroller);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  } finally {
    if (popover) Object.defineProperty(HTMLElement.prototype, 'showPopover', popover);
    else Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
  }
});

it('repositions through content shrink scroll clamping, then dismisses an actual reader scroll', () => {
  const view = render(<div data-testid="scroll"><HomeQueryMenu label="内容更新"><button>复制</button></HomeQueryMenu></div>);
  const scroller = view.getByTestId('scroll'), trigger = screen.getByRole('button', { name: '内容更新' });
  let height = 900, top = 100;
  Object.defineProperties(scroller, { scrollHeight: { get: () => height }, clientHeight: { get: () => 300 } });
  vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => ({ top, left: 200 }) as DOMRect);
  scroller.scrollTop = 600;
  fireEvent.click(trigger);
  // Removing transient content clamps a scroller near its end. This is a
  // layout update, so keep the menu aligned instead of interpreting it as input.
  height = 852; top = 98; scroller.scrollTop = 552; fireEvent.scroll(scroller);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  // The next movement with unchanged layout still dismisses normally.
  top = 118; scroller.scrollTop = 532; fireEvent.scroll(scroller);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

it('opens a command menu from ArrowUp at the last command and navigates without leaving it', () => {
  render(<HomeQueryMenu label="历史操作" commandMenu><button>重命名</button><button disabled>不可用</button><button>归档</button></HomeQueryMenu>);
  const trigger = screen.getByRole('button', { name: '历史操作' }); trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });
  expect(screen.getByRole('button', { name: '归档' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(screen.getByRole('button', { name: '重命名' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(trigger).toHaveFocus(); expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

it('captures its scroll baseline after initial popover placement flushes nested restoration', () => {
  const view=render(<div id="colliers-ai" data-mode="compact" data-transitioning="false"><div data-testid="restore"><HomeQueryMenu label="定位"><button>复制</button></HomeQueryMenu></div></div>);
  const workspace=view.container.firstElementChild as HTMLElement,scroller=view.getByTestId('restore');
  const trigger=screen.getByRole('button',{name:'定位'}),panel=view.container.querySelector('[data-query-menu-panel]') as HTMLElement;
  const box=(top:number,left:number,width:number,height:number)=>({top,left,width,height,right:left+width,bottom:top+height}) as DOMRect;
  let top=100;
  vi.spyOn(workspace,'getBoundingClientRect').mockReturnValue(box(0,0,800,600));
  vi.spyOn(trigger,'getBoundingClientRect').mockImplementation(()=>box(top,200,100,40));
  Object.defineProperty(panel,'showPopover',{value:vi.fn(),configurable:true});
  vi.spyOn(panel,'getBoundingClientRect').mockImplementation(()=>{top=120;scroller.scrollTop=20;return box(144,90,210,200);});
  fireEvent.click(trigger);fireEvent.scroll(scroller);
  expect(trigger).toHaveAttribute('aria-expanded','true');
  scroller.scrollTop=40;top=100;fireEvent.scroll(scroller);
  expect(trigger).toHaveAttribute('aria-expanded','false');
});
