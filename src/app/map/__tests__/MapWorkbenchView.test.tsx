import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const sidebarProps = vi.hoisted(() => ({ latest: null as Record<string, unknown> | null }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
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
  '2026': { total: 0, office: 0, park: 0 },
  '2027': { total: 0, office: 0, park: 0 },
  '2028': { total: 0, office: 0, park: 0 },
  '2029AndAfter': { total: 0, office: 0, park: 0 },
  noDate: { total: 0, office: 0, park: 0 },
};

function renderWorkbench(overrides: Record<string, unknown> = {}) {
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

  const props = {
    stats: {
      totalArea: '1,000,000',
      avgRent: '188.0',
      overallVacancyPct: '12.0',
      projectCount: '100',
      visibleProjectCount: '80',
    },
    futureSupplyCalendar: emptyCalendar,
    futureSuppliesCount: 0,
    activeFilterChips: [],
    keyword: '',
    renderMode: 'default' as const,
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

  render(<MapWorkbenchView {...props} />);
  return callbacks;
}

describe('MapWorkbenchView', () => {
  it('keeps the map canvas as the primary workbench surface', () => {
    renderWorkbench();

    expect(document.getElementById('map-container')).toBeInTheDocument();
    expect(screen.getByText('MAP 2.0')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-filter')).not.toBeInTheDocument();
  });

  it('routes visual commands through callbacks instead of owning map behavior', () => {
    const callbacks = renderWorkbench();

    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    expect(callbacks.onFilterPanelOpenChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: '租金' }));
    expect(callbacks.onRenderModeChange).toHaveBeenCalledWith('rent');
  });

  it('embeds the existing SidebarFilter when the overlay workspace is open', () => {
    sidebarProps.latest = null;
    renderWorkbench({ isFilterPanelOpen: true });

    expect(screen.getByTestId('sidebar-filter')).toBeInTheDocument();
    expect(sidebarProps.latest).toMatchObject({
      embedded: true,
      defaultExpanded: true,
      title: '全局筛选',
    });
  });

  it('keeps supply and project-list surfaces in the visual layer', () => {
    renderWorkbench({ isSupplyOpen: true, isListVisible: true, canOpenList: true });

    expect(screen.getByText(/按预计入市时间查看市场新增供给/)).toBeInTheDocument();
    expect(screen.getByTestId('floating-building-list')).toBeInTheDocument();
  });
});
