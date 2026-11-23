import type { ComponentProps, ReactNode } from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 }); });

const sidebarProps = vi.hoisted(() => ({ latest: null as Record<string, unknown> | null }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('next/dynamic', () => ({
  default: () => function MockFloatingBuildingList() {
    return <div data-testid="floating-building-list" />;
  },
}));

vi.mock('@/src/components/SearchBar', () => ({
  SearchBar: ({ value, onChange, onSearch }: { value: string; onChange: (value: string) => void; onSearch: (value: string) => void }) => (
    <div>
      <input
        aria-label="地图搜索"
        value={value}
        onChange={event => onChange(event.target.value)}
      />
      <button type="button" onClick={() => onSearch(value)}>搜索</button>
    </div>
  ),
}));

vi.mock('@/src/components/SidebarFilter', () => ({
  SidebarFilter: (props: Record<string, unknown>) => {
    sidebarProps.latest = props;
    return <div data-testid="sidebar-filter" />;
  },
}));

import { MapWorkbenchView } from '@/src/app/map/components/MapWorkbenchView';

const emptyCalendar = {
  '2026': { total: 0, office: 0, park: 0, commercial: 0 },
  '2027': { total: 0, office: 0, park: 0, commercial: 0 },
  '2028': { total: 0, office: 0, park: 0, commercial: 0 },
  '2029AndAfter': { total: 0, office: 0, park: 0, commercial: 0 },
  noDate: { total: 0, office: 0, park: 0, commercial: 0 },
};

type WorkbenchProps = ComponentProps<typeof MapWorkbenchView>;

function renderWorkbench(overrides: Partial<WorkbenchProps> = {}) {
  const callbacks = {
    onFilterPanelOpenChange: vi.fn(),
    onSupplyOpenChange: vi.fn(),
    onFilterChange: vi.fn(),
    onCompareGroupsChange: vi.fn(),
    onKeywordChange: vi.fn(),
    onSearch: vi.fn(),
    onRemoveFilterChip: vi.fn(),
    onResetFilters: vi.fn(),
    onRenderModeChange: vi.fn(),
    onOpenList: vi.fn(),
    onCloseList: vi.fn(),
    onRetryMap: vi.fn(),
    onExportMapData: vi.fn(),
    onBuildingClick: vi.fn(),
    onBuildingHover: vi.fn(),
  };

  const props: WorkbenchProps = {
    stats: {
      totalArea: '1,000,000',
      avgRent: '188.0',
      overallVacancyPct: '12.0',
      projectCount: '100',
      visibleProjectCount: '80',
    },
    futureSupplyCalendar: emptyCalendar,
    futureSuppliesCount: 0,
    futureSupplies: [],
    activeFilterChips: [],
    keyword: '',
    filterState: null,
    renderMode: 'default',
    compareGroups: [],
    isFilterPanelOpen: false,
    isSupplyOpen: false,
    isListVisible: false,
    canOpenList: false,
    currentSubwayStations: [],
    filterCommand: null,
    mapReady: true,
    mapError: null,
    mapDataLoading: false,
    hasBuildings: true,
    isExporting: false,
    combinedBuildingList: [],
    displayOverrides: new Map(),
    targetBuildingId: null,
    ...callbacks,
    ...overrides,
  };

  const view = render(<MapWorkbenchView {...props} />);
  return { ...callbacks, update: (next: Partial<WorkbenchProps>) => view.rerender(<MapWorkbenchView {...props} {...next} />), setSupplyOpen: (isSupplyOpen: boolean) => view.rerender(<MapWorkbenchView {...props} isSupplyOpen={isSupplyOpen} />) };
}

describe('MapWorkbenchView', () => {
  it('opens a pending project from its own group without labeling it commercial', () => {
    const pending = { id: 'p', name: '裕惠大厦', status: 'pending', location_lng: 116.298679, location_lat: 39.925216 };
    const c = renderWorkbench({ isSupplyOpen: true, futureSupplies: [pending], futureSuppliesCount: 0 });
    fireEvent.click(screen.getByText('待核实项目（1）'));
    expect(screen.queryByRole('heading', { name: '商业项目' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '裕惠大厦' }));
    expect(c.onSupplyOpenChange).not.toHaveBeenCalledWith(false);
    expect(c.onBuildingClick).toHaveBeenCalledWith({ ...pending, _dataType: 'future' });
  });


  it('groups future projects by year and type and lets users expand commercial projects to locate one', () => {
    const supply = { id: 'commercial-640', name: '玉渊潭640地块商业项目', type: '商业', location_lng: 116.29817, location_lat: 39.927218, launch_year: 2027, launch_quarter: 'Q1' };
    const office = { ...supply, id: 'office-1', name: '测试办公供应', type: '办公' };
    const callbacks = renderWorkbench({
      futureSupplies: [office, supply], futureSuppliesCount: 2,
      futureSupplyCalendar: { ...emptyCalendar, '2027': { total: 2, office: 1, park: 0, commercial: 1 } },
    });
    fireEvent.click(screen.getByRole('button', { name: '未来供应' }));
    expect(callbacks.onSupplyOpenChange).toHaveBeenCalledWith(true);
    callbacks.setSupplyOpen(true);
    expect(screen.getByText('2027年')).toBeInTheDocument();
    fireEvent.click(screen.getByText('商业项目 · 1'));
    expect(screen.getByRole('button', { name: '测试办公供应' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '玉渊潭640地块商业项目' }));
    expect(callbacks.onSupplyOpenChange).toHaveBeenLastCalledWith(true);
    expect(callbacks.onBuildingClick).toHaveBeenCalledWith({ ...supply, _dataType: 'future' });
  });


  it('keeps the map canvas as the primary workbench surface', () => {
    renderWorkbench();

    expect(document.getElementById('map-container')).toBeInTheDocument();
    expect(screen.getByText('北京办公楼市场地图')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '主页' })).toHaveAttribute('href', '/');
    const sidebar = screen.getByTestId('sidebar-filter');
    expect(sidebar).toBeInTheDocument();
    expect(sidebar.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('routes visual commands through callbacks instead of owning map behavior', () => {
    const callbacks = renderWorkbench();

    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    expect(callbacks.onFilterPanelOpenChange).toHaveBeenCalledWith(true);

    const desktopModes = screen.getByRole('group', { name: '地图显示模式' });
    fireEvent.click(within(desktopModes).getByRole('button', { name: '租金' }));
    expect(callbacks.onRenderModeChange).toHaveBeenCalledWith('rent');
  });

  it('opens filters independently while keeping the right workspace available', () => {
    const callbacks = renderWorkbench({ isSupplyOpen: true, isListVisible: true });

    fireEvent.click(screen.getByRole('button', { name: '筛选' }));

    expect(callbacks.onSupplyOpenChange).not.toHaveBeenCalled();
    expect(callbacks.onCloseList).not.toHaveBeenCalled();
    expect(callbacks.onFilterPanelOpenChange).toHaveBeenCalledWith(true);
  });

  it('embeds the existing SidebarFilter when the overlay workspace is open', () => {
    sidebarProps.latest = null;
    renderWorkbench({ isFilterPanelOpen: true });

    expect(screen.getByTestId('sidebar-filter')).toBeInTheDocument();
    expect(sidebarProps.latest).toMatchObject({
      embedded: true,
      defaultExpanded: true,
      title: '全局筛选',
      initialState: undefined,
    });
  });

  it('keeps supply and project-list surfaces in the visual layer', () => {
    renderWorkbench({ isSupplyOpen: true, isListVisible: true, rightKind: 'list', canOpenList: true });

    expect(screen.getByText('已纳入统计 0 个项目')).toBeInTheDocument();
    expect(screen.getByTestId('floating-building-list')).toBeInTheDocument();
  });

  it('dismisses only the current business workspace on Escape', () => {
    const callbacks = renderWorkbench({
      isFilterPanelOpen: true,
      isSupplyOpen: true,
      isListVisible: true,
      canOpenList: true,
    });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(callbacks.onFilterPanelOpenChange).not.toHaveBeenCalled();
    expect(callbacks.onSupplyOpenChange).not.toHaveBeenCalled();
    expect(callbacks.onCloseList).toHaveBeenCalledTimes(1);
  });

  it('preserves the business workspace while the user operates the map canvas', () => {
    const callbacks = renderWorkbench({
      isFilterPanelOpen: true,
      isSupplyOpen: true,
      isListVisible: true,
      canOpenList: true,
    });

    const mapCanvas = document.getElementById('map-container');
    expect(mapCanvas).not.toBeNull();
    fireEvent.pointerDown(mapCanvas!);

    expect(callbacks.onFilterPanelOpenChange).not.toHaveBeenCalled();
    expect(callbacks.onSupplyOpenChange).not.toHaveBeenCalled();
    expect(callbacks.onCloseList).not.toHaveBeenCalled();
  });

});

it('respects modal Escape without dismissing the map workspace behind it',async()=>{
 const callbacks=renderWorkbench({isListVisible:true,isFilterPanelOpen:true,isSupplyOpen:true});
 const {Dialog}=await import('@/src/components/ui/Dialog');const close=vi.fn();
 render(<Dialog open onOpenChange={close} title="资料" closeLabel="关闭资料"><p>历史资料内容</p></Dialog>);
 fireEvent.keyDown(screen.getByRole('button',{name:'关闭资料'}),{key:'Escape'});
 expect(close).toHaveBeenCalledWith(false);expect(callbacks.onCloseList).not.toHaveBeenCalled();expect(callbacks.onFilterPanelOpenChange).not.toHaveBeenCalled();expect(callbacks.onSupplyOpenChange).not.toHaveBeenCalled();
});
it('respects handled Escape while preserving ordinary workspace Escape behavior',()=>{
 const callbacks=renderWorkbench({isListVisible:true});const event=new KeyboardEvent('keydown',{key:'Escape',cancelable:true,bubbles:true});event.preventDefault();window.dispatchEvent(event);
 expect(callbacks.onCloseList).not.toHaveBeenCalled();fireEvent.keyDown(window,{key:'Escape'});expect(callbacks.onCloseList).toHaveBeenCalledOnce();
});

it('shows area navigation instead of stale results and preserves the filter open intent', () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  const callbacks = renderWorkbench({ keyword: 'CBD', isFilterPanelOpen: true,
    fullBuildingList: [{ id: 'a', name: 'CBD甲楼' }], submarketDetailPanel: <div>当前区域研究</div> });
  fireEvent.change(screen.getByRole('textbox', { name: '地图搜索' }), { target: { value: 'CBD甲' } });
  expect(callbacks.onFilterPanelOpenChange).not.toHaveBeenCalledWith(false);
  expect(screen.getByRole('region', { name: '项目搜索候选' })).toBeInTheDocument();
  callbacks.update({ rightView: { kind: 'submarket', name: 'CBD' }, rightKind: 'submarket', isFilterPanelOpen: false });
  expect(screen.queryByRole('region', { name: '项目搜索候选' })).not.toBeInTheDocument();
  expect(screen.getByText('当前区域研究')).toBeVisible();
});

it('restores reducer-owned search results after returning from building details', () => {
  const select = vi.fn();
  const close = vi.fn();
  const back = vi.fn();
  const view = renderWorkbench({ keyword: 'CBD', rightKind: 'search', rightView: { kind: 'search' },
    onSearchBuildingClick: select, onWorkspaceClose: close, onWorkspaceBack: back, backLabel: '项目列表',
    fullBuildingList: [{ id: 'a', name: 'CBD甲楼' }] });
  const results = screen.getByRole('region', { name: '项目搜索候选' });
  fireEvent.click(within(results).getByRole('button', { name: /CBD甲楼/ }));
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  expect(screen.getByRole('button', { name: '返回项目列表' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '返回项目列表' }));
  expect(back).toHaveBeenCalledOnce();
  view.update({ keyword: 'CBD', rightKind: 'search', rightView: { kind: 'search' } });
  expect(screen.getByRole('region', { name: '项目搜索候选' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '收起' }));
  expect(close).toHaveBeenCalledOnce();
});


it('keeps all four metrics visible and updates their values without opening a disclosure', () => {
  const view = renderWorkbench();
  const metrics = screen.getByRole('region', { name: '市场实时指标' });
  expect(within(metrics).getByText('188.0')).toBeVisible();
  expect(within(metrics).getByText('12.0')).toBeVisible();
  expect(within(metrics).getByText('80')).toBeVisible();
  expect(within(metrics).getByText('1,000,000')).toBeVisible();
  expect(screen.queryByText('统计口径')).not.toBeInTheDocument();
  expect(document.querySelector('.map-disclosure[open]')).toBeNull();
  view.update({ stats: { avgRent: '146.1', overallVacancyPct: '21.1', visibleProjectCount: '601', projectCount: '650', totalArea: '36,077,944' } });
  expect(within(metrics).getByText('146.1')).toBeVisible();
  expect(within(metrics).getByText('601')).toBeVisible();
  expect(within(metrics).queryByText('188.0')).not.toBeInTheDocument();
});

it('explains the visible LEED aggregate colors instead of showing project certification levels at city zoom', async () => {
  renderWorkbench({ renderMode: 'leed' });
  fireEvent.click(screen.getByText('图例'));
  expect(screen.getByText('LEED 认证')).toBeVisible();
  document.getElementById('map-container')!.dataset.markerTier = 'submarket';
  await waitFor(() => expect(screen.getByText('子市场 LEED 认证率')).toBeVisible());
  expect(screen.queryByText('铂金')).not.toBeInTheDocument();
  expect(screen.getByText('≥60%')).toBeVisible();
  document.getElementById('map-container')!.dataset.markerTier = 'building';
  await waitFor(() => expect(screen.getByText('铂金')).toBeVisible());
});

it('distinguishes a future supply read failure from an empty supply result', () => {
  renderWorkbench({ isSupplyOpen: true, rightKind: 'supply', fullListWarning: '未来供应暂时无法读取，当前仅显示存量楼宇。' });
  expect(screen.getByRole('alert')).toHaveTextContent('未来供应暂时无法读取');
  expect(screen.queryByText('当前筛选范围内暂无已确认供应，可调整筛选条件。')).not.toBeInTheDocument();
});


it('returns focus to the visible filter control when the final focused condition disappears', () => {
  const chip = { id: 'owner', label: '业主 含 北京资产管理集团有限公司及其子公司', patch: { numericFilters: [] } };
  const view = renderWorkbench({ activeFilterChips: [chip] });
  const remove = screen.getByTitle(`移除条件：${chip.label}`);
  remove.focus(); fireEvent.click(remove);
  expect(view.onRemoveFilterChip).toHaveBeenCalledWith(chip.patch);
  view.update({ activeFilterChips: [] });
  expect(screen.getByRole('button', { name: '筛选' })).toHaveFocus();
});
