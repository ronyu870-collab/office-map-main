import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NavigationProgress } from '../NavigationProgress';

const state = vi.hoisted(() => ({
  pathname: '/', start: vi.fn(), done: vi.fn(), configure: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));
vi.mock('nprogress', () => ({ default: state }));

function Fixture() {
  return <>
    <NavigationProgress />
    <div onClick={event => event.preventDefault()}>
      <a href="/compare">楼宇对比</a>
      <a href="/oss">资料库</a>
      <a href="?tab=latest">同页筛选</a>
      <a href="#team">同页锚点</a>
      <a href="/update" download>下载</a>
      <a href="/admin" target="_blank" rel="noreferrer">新标签页</a>
      <a href={window.location.origin + '.example.test/admin'}>外站</a>
    </div>
  </>;
}

beforeEach(() => {
  state.pathname = '/';
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const link = (name: string) => screen.getByRole('link', { name });

it('acknowledges a pending route in 100 ms and clears when the next workspace commits', () => {
  const view = render(<Fixture />);
  fireEvent.click(link('楼宇对比'));
  expect(state.start).not.toHaveBeenCalled();
  vi.advanceTimersByTime(100);
  expect(state.start).toHaveBeenCalledTimes(1);
  state.pathname = '/compare';
  view.rerender(<Fixture />);
  expect(state.done).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(12_000);
  expect(state.start).toHaveBeenCalledTimes(1);
  expect(state.done).toHaveBeenCalledTimes(1);
});

it('ignores browser and same-page actions and does not flash for a fast route', () => {
  const view = render(<Fixture />);
  for (const name of ['同页筛选', '同页锚点', '下载', '新标签页', '外站']) fireEvent.click(link(name));
  fireEvent.click(link('资料库'), { metaKey: true });
  vi.advanceTimersByTime(350);
  expect(state.start).not.toHaveBeenCalled();
  fireEvent.click(link('资料库'));
  vi.advanceTimersByTime(30);
  state.pathname = '/oss';
  view.rerender(<Fixture />);
  vi.advanceTimersByTime(350);
  expect(state.start).not.toHaveBeenCalled();
});

it('drops superseded timers and stops if a navigation never commits', () => {
  render(<Fixture />);
  fireEvent.click(link('楼宇对比'));
  vi.advanceTimersByTime(70);
  fireEvent.click(link('资料库'));
  vi.advanceTimersByTime(25);
  expect(state.start).not.toHaveBeenCalled();
  vi.advanceTimersByTime(75);
  expect(state.start).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(10_000);
  expect(state.done).toHaveBeenCalledTimes(1);
});
