import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { createDefaultFilterState } from '../model/mapDomain';
import { MapReadingContext, useMapReadingScroll, useMapReadingState, readMapReturn, saveMapReturn, restoreWorkspace, mapReturnToken, rememberMapEntry, type MapReturnSnapshot } from './continuity';

const token = 'continuity-test-token';
const saved = (): MapReturnSnapshot => ({ leedCatalogVersion: 2, savedAt: Date.now(), selected: 'a', camera: { center: [116.46, 39.91], zoom: 15 }, mode: 'rent', input: 'CBD', filters: null,
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
  it('retains station criteria and independent object reading state without SDK objects', () => {
    const value = { ...saved(), focus: true, filters: { ...createDefaultFilterState(), subwayLine: '1号线', subwayStation: { id: 'station-a', name: '国贸', center: [116.46, 39.91] } }, reading: {
      ...saved().reading, previousSheetModes: { building: 'reading' }, filterScroll: 120,
      submarkets: { CBD: { section: 'trend', grade: 'a', scrollTop: 180 } },
      supplyExpanded: { '2027': true }, supplyScroll: 90,
      buildings: { 'existing:a': { tab: 'market', scrollTop: 80, scrolls: { overview: 150, market: 80 }, trendOpen: true, trendHeight: 640, trend: { metric: 'vac', tableOpen: true }, photo: { open: true, index: 1 } } },
    } } as unknown as MapReturnSnapshot;
    saveMapReturn('scope', token, value);
    expect(readMapReturn('scope', token)).toEqual(value);
    expect(restoreWorkspace(value, [{ id: 'a' }], []).focus).toBe(true);
  });
  it('bounds old navigation history without dropping the rest of the return snapshot', () => {
    const value = { ...saved(), history: Array.from({ length: 25 }, () => ({ kind: 'list' as const })) };
    saveMapReturn('scope', token, value);
    expect(readMapReturn('scope', token)?.history).toHaveLength(20);
    expect(readMapReturn('scope', token)?.selected).toBe('a');
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

it('keeps reading state isolated when the same component changes its object key', () => {
  const store = { first: 'A', second: 'B' };
  function Reader({ id }: { id: string }) { const [value, setValue] = useMapReadingState(id, ''); return <input aria-label="对象阅读" value={value} onChange={event => setValue(event.target.value)} />; }
  const view = render(<MapReadingContext.Provider value={store}><Reader id="first" /></MapReadingContext.Provider>);
  fireEvent.change(screen.getByLabelText('对象阅读'), { target: { value: 'A2' } });
  view.rerender(<MapReadingContext.Provider value={store}><Reader id="second" /></MapReadingContext.Provider>);
  expect(screen.getByLabelText('对象阅读')).toHaveValue('B');
  fireEvent.change(screen.getByLabelText('对象阅读'), { target: { value: 'B2' } });
  view.rerender(<MapReadingContext.Provider value={store}><Reader id="first" /></MapReadingContext.Provider>);
  expect(screen.getByLabelText('对象阅读')).toHaveValue('A2');
});


it('replaces stale project URL parameters while retaining unrelated navigation context', () => {
  window.history.replaceState({ preserved: true }, '', '/map?building=old&section=deals&source=test');
  rememberMapEntry(token, { id: 'next', future: true });
  expect(new URL(location.href).searchParams.get('future')).toBe('next');
  expect(new URL(location.href).searchParams.has('building')).toBe(false);
  expect(new URL(location.href).searchParams.has('section')).toBe(false);
  expect(new URL(location.href).searchParams.get('source')).toBe('test');
  expect(window.history.state.preserved).toBe(true);
  rememberMapEntry(token, null);
  expect(new URL(location.href).searchParams.has('future')).toBe(false);
});

it('upgrades the legacy full LEED catalog in return filters and research, preserving current exclusions',()=>{
  const filters={...createDefaultFilterState(),leeds:['Platinum','Gold','Silver','NULL']};
  const value={...saved(),leedCatalogVersion:undefined,filters,research:{filters,input:'CBD',retained:true}};
  const key='map-workspace-return:v1:scope:'+token;
  sessionStorage.setItem(key,JSON.stringify(value));
  expect(readMapReturn('scope',token)?.filters?.leeds).toContain('N');
  expect(readMapReturn('scope',token)?.research?.filters.leeds).toContain('N');
  saveMapReturn('scope',token,value);
  expect(readMapReturn('scope',token)?.filters?.leeds).not.toContain('N');
});
