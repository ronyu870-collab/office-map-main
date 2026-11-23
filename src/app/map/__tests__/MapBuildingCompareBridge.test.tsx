import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MapBuildingCompareBridge } from '../MapBuildingCompareBridge';

const router = vi.hoisted(() => ({ push: vi.fn(), prefetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../workspace/continuity', () => ({ currentMapReturnHref: (id: string) => `/map?building=${id}&resume=owned-reading` }));
beforeEach(() => { vi.useFakeTimers(); router.push.mockClear(); router.prefetch.mockClear(); });
afterEach(() => { vi.useRealTimers(); });
function ui(id = 'stock-a', name = '甲楼') {
  return <><section className="building-popup" data-building-id={id} data-building-name={name}><button type="button" data-map-action="building-compare">楼宇对比</button></section><MapBuildingCompareBridge /></>;
}
it('reads the current project identity on click and carries its saved reading return', () => {
  const view = render(ui());
  view.rerender(ui('stock-b', '乙楼'));
  fireEvent.click(screen.getByRole('button', { name: '楼宇对比' }));
  const href = new URL(router.push.mock.calls[0][0], 'https://isolated.invalid');
  expect(href.pathname).toBe('/compare');
  expect(Object.fromEntries(href.searchParams)).toEqual({ buildingId: 'stock-b', name: '乙楼', back: '/map?building=stock-b&resume=owned-reading' });
  fireEvent.click(screen.getByRole('button', { name: '楼宇对比' }));
  expect(router.push).toHaveBeenCalledOnce();
  vi.runOnlyPendingTimers();
});
it('removes the in-flight navigation timer and delegated events when leaving the map', () => {
  const view = render(ui());
  fireEvent.click(screen.getByRole('button', { name: '楼宇对比' }));
  expect(vi.getTimerCount()).toBe(1);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  window.dispatchEvent(new CustomEvent('map-building-compare-request', { detail: { buildingId: 'late' } }));
  expect(router.push).toHaveBeenCalledOnce();
});
it('rejects a compare action without a current project context', () => {
  render(<><button data-map-action="building-compare">无项目比较</button><MapBuildingCompareBridge /></>);
  fireEvent.click(screen.getByRole('button', { name: '无项目比较' }));
  expect(router.push).not.toHaveBeenCalled();
});
