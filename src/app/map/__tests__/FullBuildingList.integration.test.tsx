import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ mounts: 0, cleanups: 0, role: 'viewer', fail: null as ((message: string) => void) | null }));
const controller = vi.hoisted(() => ({
  fetchMapData: vi.fn(), fetchFutureSupplies: vi.fn(), getDisplayOverridesCache: vi.fn(() => new Map()),
  clearCompetitorElements: vi.fn(), clearDistrictBoundaries: vi.fn(), clearSubwayElements: vi.fn(),
  clearFutureMarkers: vi.fn(), renderMarkers: vi.fn(), renderFutureMarkers: vi.fn(),
  calculateDistance: vi.fn(), fitToBuildings: vi.fn(), resetToDefaultView: vi.fn(),
  bounceMarker: vi.fn(), stopBounceMarker: vi.fn(),
  map: { remove: vi.fn(), setZoomAndCenter: vi.fn() },
  openBuildingInfoWindow: vi.fn(), openFutureSupplyInfoWindow: vi.fn(),
}));
const controllerRef = vi.hoisted(() => ({ current: controller }));
vi.mock('next/link', () => ({ default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('next/dynamic', () => ({ default: () => function DeferredUnrelatedComponent() { return null; } }));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => ({ status: 'authenticated', session: { role: runtime.role, user: { id: 'synthetic-user', email: 'test@example.com' } } }) }));
vi.mock('@/src/services/Auth', () => ({ getSession: vi.fn(), getSessionFast: vi.fn() }));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('@/src/app/map/runtime/useMapRuntime', () => ({ useMapRuntime: (options: { onReady: (ctrl: unknown, cancelled: () => boolean) => void; onError: (message: string) => void }) => {
  const [onReady] = React.useState(() => options.onReady);
  const { onError } = options;
  React.useEffect(() => {
    runtime.fail = onError;
    runtime.mounts += 1;
    let cancelled = false;
    void onReady(controller, () => cancelled);
    return () => { cancelled = true; runtime.cleanups += 1; };
  }, [onReady, onError]);
  return { controllerRef, mapReady: true };
} }));

import MapClient from '../MapClient';
import { logAction } from '@/src/utils/audit';

const BUILDINGS = Array.from({ length: 44 }, (_, index) => ({
  id: `b-${index + 1}`, name: `项目${String(index + 1).padStart(2, '0')}`,
  grade: index < 30 ? 'A' : 'B', owner: index % 2 ? '南城业主' : '北城业主',
  district: index < 30 ? '朝阳区' : '海淀区', submarket: index < 30 ? 'CBD' : '中关村',
  property_management: '测试物业', completion_year: '2010', leed_certification: 'Gold',
  location_lng: index === 3 ? null : 116.46 + index / 1000, location_lat: 39.91,
  metrics: [{ id: `m-${index}`, building_id: `b-${index + 1}`, record_year: 2026, record_quarter: 3,
    total_area: 10000 + index, vacant_area: index, vacancy_rate: index / 1000,
    net_effective_rent: index, asking_rent: index, management_fee: 20, face_rent: index, rent_free_period: 0 }],
}));

async function openList() {
  fireEvent.click(screen.getByRole('button', { name: '完整列表' }));
  const list = await screen.findByRole('region', { name: '完整楼宇列表' });
  await within(list).findByText('44 栋楼宇');
  return list;
}
function restoreTimers() { vi.clearAllTimers(); vi.useRealTimers(); }

beforeEach(() => {
  vi.clearAllMocks(); runtime.mounts = 0; runtime.cleanups = 0; runtime.role = 'viewer';
  controllerRef.current = controller;
  controller.fetchMapData.mockResolvedValue(BUILDINGS);
  controller.fetchFutureSupplies.mockResolvedValue([]);
  controller.getDisplayOverridesCache.mockReturnValue(new Map());
  window.history.replaceState({ __NA: true, tree: 'next-tree' }, '', '/map?source=existing#context');
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
});
afterEach(() => { cleanup(); restoreTimers(); vi.unstubAllGlobals(); });

describe('map search retains the active input', () => {
  it('keeps focus while typing and preserves the caret and draft after the search settles', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    await waitFor(() => expect(controller.renderMarkers).toHaveBeenCalled());
    vi.useFakeTimers();
    const input = screen.getByRole<HTMLInputElement>('searchbox');
    input.focus();
    fireEvent.change(input, { target: { value: 'd' } });
    expect(screen.getByRole('searchbox')).toBe(input);
    expect(input).toHaveFocus();
    expect(screen.getByTitle('清除搜索：d')).toBeVisible();
    fireEvent.change(input, { target: { value: 'CBD ' } });
    input.setSelectionRange(2, 2);
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('CBD ');
    expect(input.selectionStart).toBe(2);
    expect(controller.renderMarkers.mock.lastCall?.[0]).toHaveLength(30);
    expect(logAction).toHaveBeenCalledWith('test@example.com', 'SEARCH', { keyword: 'CBD', module: 'map' });
  });

  it('allows Chinese composition and submits only the completed text', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    await waitFor(() => expect(controller.renderMarkers).toHaveBeenCalled());
    vi.useFakeTimers();
    const input = screen.getByRole('searchbox');
    input.focus();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'bei' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(input).toHaveFocus();
    expect(logAction).not.toHaveBeenCalledWith(expect.anything(), 'SEARCH', expect.anything());
    fireEvent.change(input, { target: { value: '北城' } });
    fireEvent.compositionEnd(input, { data: '北城' });
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('北城');
    expect(controller.renderMarkers.mock.lastCall?.[0]).toHaveLength(22);
    const searches = vi.mocked(logAction).mock.calls.filter(([, action]) => action === 'SEARCH');
    expect(searches).toEqual([['test@example.com', 'SEARCH', { keyword: '北城', module: 'map' }]]);
  });

  it('shares the query with the full list and can clear it without removing existing filters', async () => {
    const { createDefaultFilterState } = await import('../model/mapDomain');
    const filterState = { ...createDefaultFilterState(), numericFilters: [{ id: 'rent-min', field: 'net_effective_rent' as const, operator: '>=' as const, value: 20 }] };
    render(<MapClient initialIntelligenceHandoff={{ source: 'intelligence', filterState, appliedCapabilities: ['rent'] }} />);
    await waitFor(() => expect(controller.renderMarkers.mock.lastCall?.[0]).toHaveLength(24));
    const input = screen.getByRole('searchbox');
    input.focus();
    fireEvent.change(input, { target: { value: '北城' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '完整列表' }));
    const list = await screen.findByRole('region', { name: '完整楼宇列表' });
    expect(within(list).getByRole('searchbox')).toHaveValue('北城');
    await within(list).findByText('12 栋楼宇');
    fireEvent.click(within(list).getByRole('button', { name: '返回地图' }));
    expect(screen.getByRole('searchbox')).toBe(input);
    expect(input).toHaveValue('北城');
    fireEvent.click(screen.getByTitle('清除搜索：北城'));
    expect(input).toHaveValue('');
    await waitFor(() => expect(controller.renderMarkers.mock.lastCall?.[0]).toHaveLength(24));
  });
});

describe('complete list with the existing map workbench', () => {
  it('keeps one map node/runtime, query, list paging, sorting and scroll through a pure round trip', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    const map = document.getElementById('map-container');
    const list = await openList();
    expect(window.location.search).toBe('?source=existing&view=list');
    expect(window.location.hash).toBe('#context');
    expect(window.history.state).toEqual({ __NA: true, tree: 'next-tree' });
    fireEvent.change(within(list).getByRole('combobox', { name: '楼宇排序' }), { target: { value: 'rent' } });
    const nextPage = within(list).getByRole('button', { name: '下一页' });
    nextPage.focus();
    fireEvent.click(nextPage);
    expect(within(list).getByRole('heading', { name: '楼宇列表' })).toHaveFocus();
    const scroll = within(list).getByTestId('full-list-scroll');
    scroll.scrollTop = 370; fireEvent.scroll(scroll);
    fireEvent.click(within(list).getByRole('button', { name: '返回地图' }));
    expect(document.getElementById('map-container')).toBe(map);
    expect(screen.queryByRole('region', { name: '完整楼宇列表' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '完整列表' }));
    const restored = screen.getByRole('region', { name: '完整楼宇列表' });
    expect(within(restored).getByText('第 2 / 3 页')).toBeInTheDocument();
    expect(within(restored).getByRole('combobox', { name: '楼宇排序' })).toHaveValue('rent');
    expect(within(restored).getByTestId('full-list-scroll').scrollTop).toBe(370);
    expect(runtime.mounts).toBe(1); expect(runtime.cleanups).toBe(0);
    expect(controller.fetchMapData).toHaveBeenCalledTimes(1);
    expect(controller.map.setZoomAndCenter).not.toHaveBeenCalled();
  });

  it('retains missing-location records without letting them trigger map details', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    const list = await openList();
    const row = list.querySelector('[data-building-id="b-4"]') as HTMLElement;
    expect(within(row).getByRole('button', { name: '项目04' })).toBeDisabled();
    expect(within(row).getByText(/位置待完善/)).toBeInTheDocument();
    expect(controller.openBuildingInfoWindow).not.toHaveBeenCalled();
  });

  it('uses a single real SidebarFilter instance across map and list and preserves its checked state', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    const list = await openList();
    fireEvent.click(within(list).getByRole('button', { name: '筛选' }));
    fireEvent.click(within(screen.getByRole('button', { name: '关闭筛选' }).closest('[aria-hidden]') as HTMLElement).getByText('项目类型', { exact: true }));
    const type = screen.getByRole('checkbox', { name: '甲级写字楼' });
    fireEvent.click(type);
    await within(list).findByText('14 栋楼宇');
    expect(within(list).getByRole('group', { name: '已生效筛选条件' })).toHaveTextContent('乙级写字楼');
    expect(controller.renderMarkers).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'b-44' })]), 'default', expect.anything(), undefined);
    fireEvent.click(within(list).getByRole('button', { name: '返回地图' }));
    expect(screen.getByRole('checkbox', { name: '甲级写字楼' })).toBe(type);
    expect(type).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '完整列表' }));
    expect(screen.queryByRole('checkbox', { name: '甲级写字楼' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('region', { name: '完整楼宇列表' }).querySelector('button[aria-expanded]') as HTMLElement);
    expect(screen.getByRole('checkbox', { name: '甲级写字楼' })).toBe(type);
    expect(type).not.toBeChecked();
  });

  it('opens only the last selected building through the unchanged map detail entry', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    let list = await openList(); vi.useFakeTimers();
    fireEvent.click(within(list).getByRole('button', { name: '项目01' }));
    await act(async () => { vi.advanceTimersByTime(20); });
    fireEvent.click(screen.getByRole('button', { name: '完整列表' }));
    list = screen.getByRole('region', { name: '完整楼宇列表' });
    fireEvent.click(within(list).getByRole('button', { name: '项目02' }));
    await act(async () => { vi.advanceTimersByTime(650); });
    expect(controller.openBuildingInfoWindow).toHaveBeenCalledTimes(1);
    expect(controller.openBuildingInfoWindow).toHaveBeenLastCalledWith('b-2');
    expect(controller.map.setZoomAndCenter).toHaveBeenLastCalledWith(16, [BUILDINGS[1].location_lng, 39.91], false, 500);
  });

  it('cancels a delayed detail when the user returns to the list, even after switching to map again', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    const list = await openList(); vi.useFakeTimers();
    fireEvent.click(within(list).getByRole('button', { name: '项目01' }));
    await act(async () => { vi.advanceTimersByTime(20); });
    fireEvent.click(screen.getByRole('button', { name: '完整列表' }));
    fireEvent.click(screen.getByRole('button', { name: '返回地图' }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(controller.openBuildingInfoWindow).not.toHaveBeenCalled();
  });

  it('supports browser back and forward without remounting the map', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    await openList();
    fireEvent.click(screen.getByRole('button', { name: '返回地图' }));
    await act(async () => { window.history.back(); });
    await screen.findByRole('region', { name: '完整楼宇列表' });
    await act(async () => { window.history.forward(); });
    await waitFor(() => expect(screen.queryByRole('region', { name: '完整楼宇列表' })).not.toBeInTheDocument());
    expect(runtime.mounts).toBe(1);
  });

  it('ignores a hidden list search debounce instead of overwriting the newer map query', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    const list = await openList(); vi.useFakeTimers();
    fireEvent.change(within(list).getByRole('searchbox'), { target: { value: '北城' } });
    await act(async () => { vi.advanceTimersByTime(20); });
    fireEvent.click(within(list).getByRole('button', { name: '返回地图' }));
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(controller.renderMarkers.mock.lastCall?.[0]).toHaveLength(44);
    expect(window.location.search).not.toContain('view=list');
  });

  it('ignores a queued click from a list that is no longer active', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    const list = await openList(); vi.useFakeTimers();
    const staleButton = within(list).getByRole('button', { name: '项目01' });
    fireEvent.click(within(list).getByRole('button', { name: '返回地图' }));
    fireEvent.click(staleButton);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(controller.map.setZoomAndCenter).not.toHaveBeenCalled();
    expect(controller.openBuildingInfoWindow).not.toHaveBeenCalled();
  });

  it('keeps cached rows unselectable until refreshed data has actually been filtered', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    const list = await openList();
    fireEvent.click(within(list).getByRole('button', { name: '下一页' }));
    fireEvent.click(within(list).getByRole('button', { name: '下一页' }));
    vi.useFakeTimers();
    act(() => runtime.fail?.('synthetic read failure'));
    let resolveReload!: (value: unknown[]) => void;
    controller.fetchMapData.mockImplementationOnce(() => new Promise(resolve => { resolveReload = resolve; }));
    fireEvent.click(within(list).getByRole('button', { name: '重新读取' }));
    await act(async () => { resolveReload([{ ...BUILDINGS[0], name: '刷新后项目' }]); });
    expect(within(list).getByRole('button', { name: '项目41' })).toBeDisabled();
    await act(async () => { vi.advanceTimersByTime(20); });
    expect(within(list).getByRole('button', { name: '刷新后项目' })).toBeEnabled();
    act(() => runtime.fail?.('synthetic retry again'));
    fireEvent.click(within(list).getByRole('button', { name: '重新读取' }));
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(20); });
    expect(within(list).getByText('第 1 / 3 页')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: '项目01' })).toBeEnabled();
  });

  it('shows inherited active conditions and removes them through the existing filter command', async () => {
    const { createDefaultFilterState } = await import('../model/mapDomain');
    const filterState = { ...createDefaultFilterState(), numericFilters: [{ id: 'rent-min', field: 'net_effective_rent' as const, operator: '>=' as const, value: 20 }] };
    render(<MapClient initialIntelligenceHandoff={{ source: 'intelligence', filterState, appliedCapabilities: ['rent'] }} />);
    fireEvent.click(screen.getByRole('button', { name: '完整列表' }));
    const list = await screen.findByRole('region', { name: '完整楼宇列表' });
    await within(list).findByText('24 栋楼宇');
    const conditions = within(list).getByRole('group', { name: '已生效筛选条件' });
    expect(conditions).toHaveTextContent('客户需求候选');
    fireEvent.click(within(conditions).getAllByRole('button')[0]);
    await within(list).findByText('44 栋楼宇');
    expect(within(conditions).queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not revive an old list search after leaving, clearing and returning before its debounce', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    const list = await openList(); vi.useFakeTimers();
    fireEvent.change(within(list).getByRole('searchbox'), { target: { value: '北城' } });
    await act(async () => { vi.advanceTimersByTime(20); });
    fireEvent.click(within(list).getByRole('button', { name: '返回地图' }));
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    fireEvent.click(screen.getByRole('button', { name: '完整列表' }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(within(list).getByRole('searchbox')).toHaveValue('');
    expect(within(list).getByText('44 栋楼宇')).toBeInTheDocument();
  });

  it('does not revive a map search after switching to the list, clearing and returning', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    await waitFor(() => expect(controller.renderMarkers).toHaveBeenCalled());
    vi.useFakeTimers();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '北城' } });
    fireEvent.click(screen.getByRole('button', { name: '完整列表' }));
    const list = screen.getByRole('region', { name: '完整楼宇列表' });
    fireEvent.click(within(list).getByRole('button', { name: '清空条件' }));
    fireEvent.click(within(list).getByRole('button', { name: '返回地图' }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(controller.renderMarkers.mock.lastCall?.[0]).toHaveLength(44);
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('cancels pending detail work on unmount', async () => {
    const mounted = render(<MapClient initialIntelligenceHandoff={null} />);
    const list = await openList(); vi.useFakeTimers();
    fireEvent.click(within(list).getByRole('button', { name: '项目01' }));
    await act(async () => { vi.advanceTimersByTime(20); });
    mounted.unmount();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(controller.openBuildingInfoWindow).not.toHaveBeenCalled();
    expect(runtime.cleanups).toBe(1);
  });

  it('keeps competitor and target context when opening the list', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    const list = await openList();
    act(() => window.dispatchEvent(new CustomEvent('competitors-found', { detail: { buildings: [BUILDINGS[4], BUILDINGS[5]], targetBuildingId: 'b-5' } })));
    await within(list).findByText('2 栋楼宇');
    expect(within(list).getByRole('group', { name: '已生效筛选条件' })).toHaveTextContent('竞品分析结果');
    expect(within(list).getByText('目标楼宇')).toBeInTheDocument();
    expect(list.querySelector('[data-building-id="b-5"]')).toHaveAttribute('aria-current', 'true');
    expect(within(list).queryByRole('button', { name: '项目01' })).not.toBeInTheDocument();
  });
});

describe('asynchronous scope and view boundaries', () => {
  it('invalidates a delayed detail when popstate restores the list', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    const list = await openList(); vi.useFakeTimers();
    fireEvent.click(within(list).getByRole('button', { name: '项目01' }));
    await act(async () => { vi.advanceTimersByTime(20); });
    act(() => {
      window.history.replaceState(window.history.state, '', '/map?source=existing&view=list#context');
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    });
    expect(screen.getByRole('region', { name: '完整楼宇列表' })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(controller.openBuildingInfoWindow).not.toHaveBeenCalled();
  });

  it('ignores an older future response and opens the selected future through its existing entry', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    const list = await openList();
    const responses: Array<(value: unknown[]) => void> = [];
    controller.fetchFutureSupplies.mockImplementation(() => new Promise(resolve => responses.push(resolve)));
    fireEvent.click(within(list).getByRole('button', { name: '筛选' }));
    fireEvent.click(within(screen.getByRole('button', { name: '关闭筛选' }).closest('[aria-hidden]') as HTMLElement).getByText('项目类型', { exact: true }));
    fireEvent.click(screen.getByRole('checkbox', { name: '显示未来新增供应' }));
    await waitFor(() => expect(responses).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '关闭筛选' }));
    fireEvent.change(within(list).getByRole('searchbox'), { target: { value: '远期' } });
    await waitFor(() => expect(responses).toHaveLength(2));
    const supply = {id:'future-new',name:'远期新项目',grade:'A',district:'朝阳区',submarket:'CBD',launch_year:2028,launch_quarter:'Q1',total_area:50000,location_lng:116.48,location_lat:39.93};
    await act(async () => { responses[1]([supply]); });
    await within(list).findByText('1 栋楼宇');
    await act(async () => { responses[0]([{...supply,id:'future-old',name:'远期旧项目'}]); });
    expect(within(list).queryByRole('button', { name: '远期旧项目' })).not.toBeInTheDocument();
    const futureButton = within(list).getByRole('button', { name: '远期新项目' });
    await waitFor(() => expect(futureButton).toBeEnabled());
    fireEvent.click(futureButton);
    await waitFor(() => expect(controller.openFutureSupplyInfoWindow).toHaveBeenCalledWith(expect.objectContaining({id:'future-new',_dataType:'future'})));
  });

  it('labels a partial future failure instead of pretending the result is complete', async () => {
    render(<MapClient initialIntelligenceHandoff={null} />);
    const list = await openList();
    controller.fetchFutureSupplies.mockRejectedValue(new Error('synthetic fixture failure'));
    fireEvent.click(within(list).getByRole('button', { name: '筛选' }));
    fireEvent.click(within(screen.getByRole('button', { name: '关闭筛选' }).closest('[aria-hidden]') as HTMLElement).getByText('项目类型', { exact: true }));
    fireEvent.click(screen.getByRole('checkbox', { name: '显示未来新增供应' }));
    await within(list).findByText('未来供应暂时无法读取，当前仅显示存量楼宇。');
    await within(list).findByText('44 栋楼宇');
  });

  it.each(['viewer','editor','admin'])('keeps the existing %s read scope', async role => {
    runtime.role = role;
    render(<MapClient initialIntelligenceHandoff={null} />);
    const list = await openList();
    expect(within(list).getByRole('button', { name: '项目01' })).toBeEnabled();
    expect(controller.fetchMapData).toHaveBeenCalledTimes(1);
  });
});
