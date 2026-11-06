import type { ComponentProps, ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
  return { ...callbacks, setSupplyOpen: (isSupplyOpen: boolean) => view.rerender(<MapWorkbenchView {...props} isSupplyOpen={isSupplyOpen} />) };
}

describe('MapWorkbenchView', () => {
  it('opens a pending project from its own group without labeling it commercial', () => {
    const pending = { id: 'p', name: '裕惠大厦', status: 'pending', location_lng: 116.298679, location_lat: 39.925216 };
    const c = renderWorkbench({ isSupplyOpen: true, futureSupplies: [pending], futureSuppliesCount: 0 });
    fireEvent.click(screen.getByText('待核实项目（1）'));
    expect(screen.queryByRole('heading', { name: '商业项目' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '裕惠大厦' }));
    expect(c.onSupplyOpenChange).toHaveBeenCalledWith(false);
    expect(c.onBuildingClick).toHaveBeenCalledWith({ ...pending, _dataType: 'future' });
  });


  it('lists commercial project names directly after opening future supply and lets users locate a project', () => {
    const supply = { id: 'commercial-640', name: '玉渊潭640地块商业项目', type: '商业', location_lng: 116.29817, location_lat: 39.927218, launch_year: 2027, launch_quarter: 'Q1' };
    const office = { ...supply, id: 'office-1', name: '测试办公供应', type: '办公' };
    const callbacks = renderWorkbench({
      futureSupplies: [office, supply], futureSuppliesCount: 2,
      futureSupplyCalendar: { ...emptyCalendar, '2027': { total: 2, office: 1, park: 0, commercial: 1 } },
    });
    fireEvent.click(screen.getByRole('button', { name: '未来供应' }));
    expect(callbacks.onSupplyOpenChange).toHaveBeenCalledWith(true);
    callbacks.setSupplyOpen(true);
    expect(screen.getByRole('heading', { name: '商业项目' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '测试办公供应' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '玉渊潭640地块商业项目' }));
    expect(callbacks.onSupplyOpenChange).toHaveBeenLastCalledWith(false);
    expect(callbacks.onBuildingClick).toHaveBeenCalledWith({ ...supply, _dataType: 'future' });
  });


  it('keeps the map canvas as the primary workbench surface', () => {
    renderWorkbench();

    expect(document.getElementById('map-container')).toBeInTheDocument();
    expect(screen.getByText('北京办公楼市场地图')).toBeInTheDocument();
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

  it('keeps filter, supply and list workspaces mutually exclusive through callbacks', () => {
    const callbacks = renderWorkbench({ isSupplyOpen: true, isListVisible: true });

    fireEvent.click(screen.getByRole('button', { name: '筛选' }));

    expect(callbacks.onSupplyOpenChange).toHaveBeenCalledWith(false);
    expect(callbacks.onCloseList).toHaveBeenCalledTimes(1);
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
    renderWorkbench({ isSupplyOpen: true, isListVisible: true, canOpenList: true });

    expect(screen.getByText('已纳入统计 0 个项目')).toBeInTheDocument();
    expect(screen.getByTestId('floating-building-list')).toBeInTheDocument();
  });

  it('dismisses any open map workspace on Escape', () => {
    const callbacks = renderWorkbench({
      isFilterPanelOpen: true,
      isSupplyOpen: true,
      isListVisible: true,
      canOpenList: true,
    });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(callbacks.onFilterPanelOpenChange).toHaveBeenCalledWith(false);
    expect(callbacks.onSupplyOpenChange).toHaveBeenCalledWith(false);
    expect(callbacks.onCloseList).toHaveBeenCalledTimes(1);
  });

  it('dismisses open workspaces when the user returns to the map canvas', () => {
    const callbacks = renderWorkbench({
      isFilterPanelOpen: true,
      isSupplyOpen: true,
      isListVisible: true,
      canOpenList: true,
    });

    const mapCanvas = document.getElementById('map-container');
    expect(mapCanvas).not.toBeNull();
    fireEvent.pointerDown(mapCanvas!);

    expect(callbacks.onFilterPanelOpenChange).toHaveBeenCalledWith(false);
    expect(callbacks.onSupplyOpenChange).toHaveBeenCalledWith(false);
    expect(callbacks.onCloseList).toHaveBeenCalledTimes(1);
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
