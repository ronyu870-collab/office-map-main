import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { MapReadingContext, useMapReadingScroll, useMapReadingState, readMapReturn, saveMapReturn, restoreWorkspace, mapReturnToken, type MapReturnSnapshot } from './continuity';

const token = 'continuity-test-token';
const saved = (): MapReturnSnapshot => ({ savedAt: Date.now(), selected: 'a', camera: { center: [116.46, 39.91], zoom: 15 }, mode: 'rent', input: 'CBD', filters: null,
  right: { kind: 'building', id: 'a' }, history: [{ kind: 'list' }, { kind: 'building', id: 'removed' }], leftOpen: false, widths: { building: 400, list: 320 },
  reading: { listQuery: 'CBD', listSort: 'rent', listScroll: 550, fullPaging: { queryKey: 'q', page: 3 }, sheetModes: { building: 'reading' }, buildings: { a: { tab: 'materials', scrollTop: 140 } } },
  comparison: [], competitors: ['a'], target: 'a', groups: [], research: null });
beforeEach(() => sessionStorage.clear());
describe('map return context', () => {
  it('restores reading and camera only within the same identity, login and return token', () => {
    expect(mapReturnToken('server-route-token')).toBe('server-route-token');
    const value = saved(); saveMapReturn('user:login1', token, value);
    expect(readMapReturn('user:login1', token)).toEqual(value);
    expect(readMapReturn('user:login2', token)).toBeNull();
    expect(readMapReturn('other:login1', token)).toBeNull();
    expect(readMapReturn('user:login1', 'another-token')).toBeNull();
    expect(readMapReturn('user:login1', token, value.savedAt + 9 * 3600000)).toBeNull();
    saveMapReturn('other:login2', token, value);
    expect(readMapReturn('user:login1', token)).toBeNull();
  });
  it('hydrates fresh authorized records and discards inaccessible project history', () => {
    const state = restoreWorkspace(saved(), [{ id: 'a', name: 'fresh' }], []);
    expect(state.right).toEqual({ kind: 'building', building: { id: 'a', name: 'fresh', _dataType: 'existing' } });
    expect(state.history).toEqual([{ kind: 'list' }]); expect(state.width).toBe(400);
    expect(restoreWorkspace(saved(), [], []).right).toBeNull();
    const future = { ...saved(), right: { kind: 'building' as const, id: 'a', future: true } };
    expect(restoreWorkspace(future, [{ id: 'a' }], []).right).toBeNull();
    expect(restoreWorkspace(future, [], [{ id: 'a' }]).right).toMatchObject({ building: { _dataType: 'future' } });
  });
  it('rejects malformed UI state and excludes cached business records', () => {
    saveMapReturn('scope', token, { ...saved(), reading: { listCount: -1 } });
    expect(readMapReturn('scope', token)).toBeNull();
    saveMapReturn('scope', token, { ...saved(), reading: { listSort: 'invalid' as never } });
    expect(readMapReturn('scope', token)).toBeNull();
    const raw = saved() as unknown as { reading: Record<string, unknown> };
    raw.reading.businessRecords = [{ tenant: 'private' }];
    saveMapReturn('scope', token, raw as MapReturnSnapshot);
    expect(readMapReturn('scope', token)?.reading).not.toHaveProperty('businessRecords');
  });
});

it('restores list query and scroll after remount and late content, then yields to user scrolling', () => {
  const reading: Record<string, unknown> = { listQuery: '原查询', listScroll: 550 };
  let resize!: () => void;
  vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { resize = cb; } observe() {} disconnect() {} });
  function List() {
    const ref = React.useRef<HTMLDivElement>(null);
    const [query, setQuery] = useMapReadingState('listQuery', '');
    useMapReadingScroll(ref, 'listScroll');
    return <div ref={ref} data-testid="reading"><input aria-label="查询" value={query} onChange={event => setQuery(event.target.value)} /><div>异步列表</div></div>;
  }
  const first = render(<MapReadingContext.Provider value={reading}><List /></MapReadingContext.Provider>);
  expect(screen.getByTestId('reading').scrollTop).toBe(550);
  fireEvent.change(screen.getByLabelText('查询'), { target: { value: '继续查询' } }); first.unmount();
  const second = render(<MapReadingContext.Provider value={reading}><List /></MapReadingContext.Provider>);
  expect(screen.getByLabelText('查询')).toHaveValue('继续查询');
  const scroller = screen.getByTestId('reading'); scroller.scrollTop = 0;
  act(() => resize()); expect(scroller.scrollTop).toBe(550);
  fireEvent.wheel(scroller); scroller.scrollTop = 180; fireEvent.scroll(scroller);
  act(() => resize()); expect(scroller.scrollTop).toBe(180); expect(reading.listScroll).toBe(180);
  second.unmount(); vi.unstubAllGlobals();
});
