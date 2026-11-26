import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultFilterState } from '@/src/app/map/model/mapDomain';
import type { SidebarFilterState } from '@/src/components/SidebarFilter';
import type { BuildingContext } from '@/src/lib/intelligence/query/buildingCards';

const queryBridge = vi.hoisted(() => ({ selection: null as BuildingContext | null, publish: undefined as ((value: BuildingContext | null) => void) | undefined }));
vi.mock('@/src/app/map/MapQuerySelection', () => ({
  MapQuerySelection: ({ context, onChange }: { context: unknown; onChange: (value: BuildingContext | null) => void }) => {
    React.useEffect(() => { queryBridge.publish = onChange; onChange(context ? queryBridge.selection : null); }, [context, onChange]);
    return null;
  },
}));

const controller = vi.hoisted(() => ({
  setWorkspaceDetailHandler: vi.fn(),
  setBaseMapPointsVisible: vi.fn(),
  fetchMapData: vi.fn(),
  fetchFutureSupplies: vi.fn(),
  getDisplayOverridesCache: vi.fn(() => new Map()),
  clearCompetitorElements: vi.fn(),
  clearDistrictBoundaries: vi.fn(),
  clearSubwayElements: vi.fn(),
  clearFutureMarkers: vi.fn(),
  renderMarkers: vi.fn(),
  renderFutureMarkers: vi.fn(),
  calculateDistance: vi.fn(),
  fitToBuildings: vi.fn(),
  resetToDefaultView: vi.fn(),
  bounceMarker: vi.fn(),
  map: {
    remove: vi.fn(),
    setZoomAndCenter: vi.fn(),
  },
  openBuildingInfoWindow: vi.fn(),
  closeInfoWindow: vi.fn(),
}));

const controllerRef = vi.hoisted(() => ({ current: controller }));

vi.mock('next/dynamic', () => ({
  default: () => function MockDynamicComponent({
    name, suspended, onOpenBuilding, onClose, futureState, futureCount,
  }: { name?: string; suspended?: boolean; onOpenBuilding?: (id: string) => void; onClose?: () => void; futureState?: string; futureCount?: number }) {
    if (!name || !onOpenBuilding) return null;
    return <><output aria-label="submarket-future-state">{futureState === 'ready' ? `ready:${futureCount}` : futureState}</output>
      <button type="button" onClick={onClose}>close-submarket</button><button type="button" disabled={suspended} onClick={() => onOpenBuilding('building-1')}>
      open-submarket-test-building
    </button></>;
  },
}));

vi.mock('@/src/components/SessionProvider', () => ({
  useAppSession: () => ({
    session: {
      role: 'admin',
      user: { id: 'test-user', email: 'test@example.com' },
    },
    status: 'authenticated',
  }),
}));

vi.mock('@/src/services/Auth', () => ({
  getSession: vi.fn(async () => ({
    role: 'admin',
    user: { id: 'test-user', email: 'test@example.com' },
  })),
}));

vi.mock('@/src/utils/audit', () => ({
  logAction: vi.fn(),
}));

vi.mock('@/src/app/map/runtime/useMapRuntime', () => ({
  useMapRuntime: (options: {
    onReady: (controller: typeof import('@/src/services/MapController').MapController, isCancelled: () => boolean) => Promise<void> | void;
  }) => {
    React.useEffect(() => {
      void options.onReady(controller as never, () => false);
    }, []);
    return { controllerRef, mapReady: true };
  },
}));

vi.mock('@/src/app/map/components/MapLoadingShell', () => ({
  MapLoadingShell: () => <div>loading</div>,
}));

vi.mock('@/src/app/map/components/MapWorkbenchView', () => ({
  MapWorkbenchView: ({
    queryPanel,
    submarketDetailPanel,
    buildingDetailPanel, rightKind, backLabel, onWorkspaceBack,
    onRenderModeChange,
    onSearch, onOpenList,
    onFilterChange, stats, futureSupplies,
  }: {
    stats: {visibleProjectCount:string; totalArea:string};
    futureSupplies: {id:string}[];
    queryPanel?: React.ReactNode;
    submarketDetailPanel?: React.ReactNode;
    buildingDetailPanel?: React.ReactNode; rightKind?: string; backLabel?: string; onWorkspaceBack?: () => void;
    onRenderModeChange: (mode: 'rent') => void;
    onSearch: (value: string) => void; onOpenList: () => void;
    onFilterChange: (state: SidebarFilterState) => void;
  }) => (
    <>
      {queryPanel}
      <output aria-label="current-map-projects">{stats.visibleProjectCount}</output>
      <output aria-label="supply-calendar-projects">{futureSupplies.map(row=>row.id).join(',')}</output>
      <output aria-label="current-market-area">{stats.totalArea}</output>
      {submarketDetailPanel}
      {rightKind === 'building' ? buildingDetailPanel : null}
      {backLabel ? <button type="button" onClick={onWorkspaceBack}>返回{backLabel}</button> : null}
      <button type="button" onClick={onOpenList}>open-list</button>
      <button type="button" onClick={() => onRenderModeChange('rent')}>
        switch-to-rent
      </button>
      <button type="button" onClick={() => onFilterChange({
        ...createDefaultFilterState(), districts: ['海淀区'], showFutureSupply: false, futureSupplyGrades: [], futureSupplyYears: [],
      })}>close-layer-with-district-filter</button>
      <button type="button" onClick={() => onFilterChange({
        ...createDefaultFilterState(), numericFilters:[{id:'owner',field:'owner',operator:'=',value:'华润'},{id:'area',field:'total_area',operator:'>=',value:50000}],
      })}>apply-owner-and-area</button>
      <button type="button" onClick={() => onFilterChange({
        ...createDefaultFilterState(), numericFilters:[{id:'rent',field:'net_effective_rent',operator:'>=',value:0}],
      })}>apply-rent-condition</button>
      <button type="button" onClick={() => onSearch('玉渊潭 640')}>search-commercial</button>
      <button type="button" onClick={() => onSearch('华润')}>
        search-owner
      </button>
    </>
  ),
}));

import MapWorkbenchPage from '@/src/app/map/MapClient';

const BUILDINGS = [
  {
    id: 'building-1',
    name: '测试项目',
    grade: 'A',
    owner: '华润置地',
    district: '朝阳区',
    submarket: 'CBD',
    leed_certification: 'Gold',
    location_lng: 116.46,
    location_lat: 39.91,
    metrics: [
      {
        is_locked: true, is_draft: false, record_year: 2026,
        record_quarter: 3,
        total_area: 100000,
        vacant_area: 12000,
        vacancy_rate: 0.12,
        net_effective_rent: 220,
      },
    ],
  },
];

describe('MapClient render mode synchronization', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
    controller.fetchMapData.mockResolvedValue(BUILDINGS);
    controller.fetchFutureSupplies.mockResolvedValue([]);
    controller.getDisplayOverridesCache.mockReturnValue(new Map());
    let publish: ((detail: unknown) => void) | null = null;
    controller.setWorkspaceDetailHandler.mockImplementation(handler => { publish = handler; });
    controller.openBuildingInfoWindow.mockImplementation(id => {
      const building = BUILDINGS.find(item => item.id === id);
      if (building) publish?.({ building, metric: null, photos: [], isDemo: false, canEdit: false, overrides: {} });
    });
    queryBridge.selection = null; queryBridge.publish = undefined;
  });

  it('passes the actual future supply status for the current research filters', async () => {
    let resolveSupplies!: (supplies: unknown[]) => void;
    const pending = new Promise<unknown[]>(resolve => { resolveSupplies = resolve; });
    controller.fetchFutureSupplies.mockReturnValue(pending);
    render(<MapWorkbenchPage initialIntelligenceHandoff={null} />);
    await waitFor(() => expect(controller.renderMarkers).toHaveBeenCalled());
    act(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } })));
    const status = () => screen.getByLabelText('submarket-future-state');
    expect(status()).toHaveTextContent(/^loading$/);
    await act(async () => resolveSupplies([]));
    await waitFor(() => expect(status()).toHaveTextContent(/^ready:0$/));

    controller.fetchFutureSupplies.mockRejectedValue(new Error('future supply unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'apply-owner-and-area' }));
    expect(status()).toHaveTextContent(/^loading$/);
    await waitFor(() => expect(status()).toHaveTextContent(/^error$/));

    fireEvent.click(screen.getByRole('button', { name: 'close-layer-with-district-filter' }));
    expect(status()).toHaveTextContent(/^disabled$/);
  });

  it('keeps the latest region and displayed projects when closing research', async () => {
    render(<MapWorkbenchPage initialIntelligenceHandoff={null} />);
    await waitFor(() => expect(controller.renderMarkers).toHaveBeenCalled());
    act(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } })));
    await waitFor(() => expect(controller.renderMarkers.mock.lastCall?.[0]).toHaveLength(1));
    act(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: '中关村' } })));
    await waitFor(() => expect(controller.renderMarkers.mock.lastCall?.[0]).toHaveLength(0));
    fireEvent.click(screen.getByRole('button', { name: 'close-submarket' }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
    expect(controller.renderMarkers.mock.lastCall?.[0]).toHaveLength(0);
    expect(controller.resetToDefaultView).not.toHaveBeenCalled();
  });

  it('cancels queued project focus when switching to a list and can refocus the same project later', async () => {
    const host = document.createElement('div'); host.id = 'map-container'; document.body.append(host);
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 600 } as DOMRect);
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); };
    try {
      const { unmount } = render(<MapWorkbenchPage initialIntelligenceHandoff={null} />);
      await waitFor(() => expect(controller.renderMarkers).toHaveBeenCalled());
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
      vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
      act(() => controller.openBuildingInfoWindow('building-1'));
      fireEvent.click(screen.getByRole('button', { name: 'open-list' }));
      act(flush);
      expect(controller.map.setZoomAndCenter).not.toHaveBeenCalled();
      act(() => controller.openBuildingInfoWindow('building-1')); act(flush);
      expect(controller.map.setZoomAndCenter).toHaveBeenCalledExactlyOnceWith(14, [116.46, 39.91], false, 240);
      unmount();
    } finally { host.remove(); vi.unstubAllGlobals(); }
  });


  it('opens details immediately and does not reopen an old selection after returning to research', async () => {
    render(<MapWorkbenchPage initialIntelligenceHandoff={null} />);
    await waitFor(() => expect(controller.renderMarkers).toHaveBeenCalled());
    act(() => {
      window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } }));
    });
    const open = screen.getByRole('button', { name: 'open-submarket-test-building' });
    vi.useFakeTimers();
    try {
      fireEvent.click(open);
      expect(controller.openBuildingInfoWindow).toHaveBeenCalledWith('building-1','submarket');
      expect(controller.map.setZoomAndCenter).not.toHaveBeenCalled();
      const back = screen.getByRole('button', { name: '返回子市场研究' });
      fireEvent.click(back);
      act(() => { vi.advanceTimersByTime(650); });
      expect(controller.openBuildingInfoWindow).toHaveBeenCalledOnce();
      expect(screen.getByRole('button', { name: 'open-submarket-test-building' })).toBeInTheDocument();
      expect(controller.map.setZoomAndCenter).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows an authorized building detail even when its location is unavailable', async () => {
    controller.fetchMapData.mockResolvedValueOnce([
      { ...BUILDINGS[0], location_lng: Number.NaN },
    ]);
    render(<MapWorkbenchPage initialIntelligenceHandoff={null} />);
    await waitFor(() => expect(controller.fetchMapData).toHaveBeenCalled());
    await waitFor(() => expect(controller.renderMarkers).toHaveBeenCalled());
    act(() => {
      window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'open-submarket-test-building' }));
    expect(screen.getByRole('button', { name: '返回子市场研究' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'open-submarket-test-building' })).toBeInTheDocument();
  });

  it('re-renders map markers when the display mode changes before any filter state exists', async () => {
    render(<MapWorkbenchPage initialIntelligenceHandoff={null} />);

    await waitFor(() => {
      expect(controller.renderMarkers).toHaveBeenCalledWith(
        BUILDINGS,
        'default',
        expect.anything(),
        undefined,
        true,
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'switch-to-rent' }));

    await waitFor(() => {
      expect(controller.renderMarkers).toHaveBeenLastCalledWith(
        BUILDINGS,
        'rent',
        expect.anything(),
        undefined,
        true,
      );
    });
  });


  it('counts valid displayed stock and future projects and follows hidden layers and competitor scope', async () => {
    const bad = {...BUILDINGS[0],id:'bad',location_lat:116};
    controller.fetchMapData.mockResolvedValue([...BUILDINGS,bad]);
    controller.fetchFutureSupplies.mockResolvedValue([{id:'future',name:'未来楼',grade:'A',type:'办公',district:'朝阳区',submarket:'CBD',launch_year:2027,location_lng:116.47,location_lat:39.92}]);
    render(<MapWorkbenchPage initialIntelligenceHandoff={null} />);
    await waitFor(()=>expect(controller.renderFutureMarkers).toHaveBeenCalled());
    await waitFor(()=>expect(screen.getByLabelText('current-map-projects')).toHaveTextContent(/^2$/));
    expect(screen.getByLabelText('current-market-area')).toHaveTextContent('200,000');
    fireEvent(window,new CustomEvent('competitors-found',{detail:{buildings:BUILDINGS,targetBuildingId:BUILDINGS[0].id}}));
    await waitFor(()=>expect(screen.getByLabelText('current-map-projects')).toHaveTextContent(/^1$/));
    fireEvent(window,new Event('competitors-cleared'));
    await waitFor(()=>expect(screen.getByLabelText('current-map-projects')).toHaveTextContent(/^2$/));
    fireEvent.click(screen.getByRole('button',{name:'close-layer-with-district-filter'}));
    await waitFor(()=>expect(screen.getByLabelText('current-map-projects')).toHaveTextContent(/^0$/));
  });

  it('applies the same active conditions to stock and supplies, rendering and counting only matches', async () => {
    const supply={id:'future',name:'未来楼',grade:'A',type:'办公',district:'朝阳区',submarket:'CBD',launch_year:2027,location_lng:116.47,location_lat:39.92,owner:'华润置地',total_area:80000};
    controller.fetchFutureSupplies.mockResolvedValue([supply,{...supply,id:'missing-owner',owner:null},{...supply,id:'small',total_area:1000}]);
    render(<MapWorkbenchPage initialIntelligenceHandoff={null} />);
    await waitFor(()=>expect(screen.getByLabelText('current-map-projects')).toHaveTextContent(/^4$/));
    fireEvent.click(screen.getByRole('button',{name:'apply-owner-and-area'}));
    await waitFor(()=>expect(controller.renderFutureMarkers).toHaveBeenLastCalledWith([supply],'default'));
    await waitFor(()=>expect(screen.getByLabelText('current-map-projects')).toHaveTextContent(/^2$/));
    expect(screen.getByLabelText('current-market-area')).toHaveTextContent('100,000');
    expect(screen.getByLabelText('supply-calendar-projects')).toHaveTextContent(/^future$/);
    fireEvent.click(screen.getByRole('button',{name:'apply-rent-condition'}));
    await waitFor(()=>expect(controller.renderFutureMarkers).toHaveBeenLastCalledWith([],'default'));
    await waitFor(()=>expect(screen.getByLabelText('current-map-projects')).toHaveTextContent(/^1$/));
    expect(screen.getByLabelText('current-market-area')).toHaveTextContent('100,000');
    expect(screen.getByLabelText('supply-calendar-projects')).toBeEmptyDOMElement();
  });

  it('excludes hidden commercial projects from search when future supply is off', async () => {
    const supply = { id: 'supply-640', name: '玉渊潭640地块商业项目', type: '商业', grade: null, submarket: null,
      district: '海淀区', launch_year: '2027', location_lng: 116.29817, location_lat: 39.927218 };
    controller.fetchFutureSupplies.mockResolvedValue([supply]);
    render(<MapWorkbenchPage initialIntelligenceHandoff={null} />);
    await waitFor(() => expect(controller.renderMarkers).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'close-layer-with-district-filter' }));
    await waitFor(() => expect(controller.clearFutureMarkers).toHaveBeenCalled());
    controller.renderFutureMarkers.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'search-commercial' }));
    await waitFor(() => expect(controller.renderMarkers).toHaveBeenLastCalledWith(
      [], 'default', expect.anything(), undefined, false,
    ));
    expect(controller.fitToBuildings).not.toHaveBeenCalled();
    expect(controller.renderFutureMarkers).not.toHaveBeenCalled();
  });


  it('restores the current future-supply filter after exiting competitor mode', async () => {
    const supply = {
      id: 'supply-640', name: '玉渊潭640地块商业项目', type: '商业', grade: null,
      submarket: null, district: '海淀区', launch_year: '2027',
      location_lng: 116.29817, location_lat: 39.927218,
    };
    controller.fetchFutureSupplies.mockResolvedValue([supply]);
    render(<MapWorkbenchPage initialIntelligenceHandoff={null} />);
    await waitFor(() => expect(controller.renderFutureMarkers).toHaveBeenCalledWith([supply], 'default'));

    controller.renderFutureMarkers.mockClear();
    fireEvent(window, new CustomEvent('competitors-found', {
      detail: { buildings: BUILDINGS, targetBuildingId: BUILDINGS[0].id },
    }));
    expect(controller.renderFutureMarkers).not.toHaveBeenCalled();

    fireEvent(window, new Event('competitors-cleared'));
    await waitFor(() => expect(controller.renderFutureMarkers).toHaveBeenCalledWith([supply], 'default'));

    // After the user has disabled F, leaving another competitor session must not re-enable it.
    fireEvent.click(screen.getByRole('button', { name: 'close-layer-with-district-filter' }));
    await waitFor(() => expect(controller.clearFutureMarkers).toHaveBeenCalled());
    controller.renderFutureMarkers.mockClear();
    fireEvent(window, new CustomEvent('competitors-found', { detail: { buildings: BUILDINGS, targetBuildingId: BUILDINGS[0].id } }));
    fireEvent(window, new Event('competitors-cleared'));
    expect(controller.renderFutureMarkers).not.toHaveBeenCalled();
  });

  it('does not render a delayed future-supply response while competitor mode is active', async () => {
    let resolveSupplies!: (supplies: any[]) => void;
    const pending = new Promise<any[]>(resolve => { resolveSupplies = resolve; });
    controller.fetchFutureSupplies.mockReturnValue(pending);
    render(<MapWorkbenchPage initialIntelligenceHandoff={null} />);
    await waitFor(() => expect(controller.fetchFutureSupplies).toHaveBeenCalled());

    fireEvent(window, new CustomEvent('competitors-found', {
      detail: { buildings: BUILDINGS, targetBuildingId: BUILDINGS[0].id },
    }));
    resolveSupplies([{
      id: 'future-a', name: '新增供应A', grade: 'A', type: '办公',
      submarket: 'CBD', district: '朝阳区', launch_year: '2027',
      location_lng: 116.46, location_lat: 39.91,
    }]);
    await waitFor(() => expect(controller.fetchFutureSupplies).toHaveBeenCalled());
    expect(controller.renderFutureMarkers).not.toHaveBeenCalled();
  });

  it('applies search before any filter state has been created', async () => {
    const otherBuilding = {
      ...BUILDINGS[0],
      id: 'building-2',
      name: '其他项目',
      owner: '其他业主',
      location_lng: 116.48,
    };
    controller.fetchMapData.mockResolvedValueOnce([...BUILDINGS, otherBuilding]);

    render(<MapWorkbenchPage initialIntelligenceHandoff={null} />);

    await waitFor(() => {
      expect(controller.renderMarkers).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'search-owner' }));

    await waitFor(() => {
      expect(controller.renderMarkers).toHaveBeenLastCalledWith(
        BUILDINGS,
        'default',
        expect.anything(),
        undefined,
        false,
      );
    });
  });

  it('T04 focuses one verified AI building through the existing controller and opens its existing detail', async () => {
    const requestId = '10000000-0000-4000-8000-000000000001';
    queryBridge.selection = { status: 'ready', requestId, resultId: requestId, metadataReadAt: '2026-11-16T00:00:00Z', total: 1, offset: 0, hasMore: false,
      buildings: [{ id: BUILDINGS[0].id, name: BUILDINGS[0].name, located: true, unavailableReason: null, submarket: 'CBD', grade: 'A', photo: null }] };
    render(<MapWorkbenchPage initialIntelligenceHandoff={null} queryContext={{ requestId, details: true }} />);
    await waitFor(() => expect(controller.fitToBuildings).toHaveBeenCalledWith(BUILDINGS));
    expect(controller.openBuildingInfoWindow).toHaveBeenCalledWith(BUILDINGS[0].id,'ai_query');
    expect(controller.renderMarkers).toHaveBeenLastCalledWith(BUILDINGS, 'default', expect.anything(), undefined, false);
    expect(controller.fetchFutureSupplies).not.toHaveBeenCalled();
  });

  it('T05/T06/T12 renders and fits only the verified located ID set, never duplicates or unavailable coordinates, and clears on revocation', async () => {
    const requestId = '10000000-0000-4000-8000-000000000001';
    const second = { ...BUILDINGS[0], id: 'building-2', name: '同名项目', grade: null, district: null, location_lng: 116.5 };
    const missing = { ...BUILDINGS[0], id: 'building-3', location_lng: 999 };
    const unrelated = { ...BUILDINGS[0], id: 'building-4', name: '同名项目' };
    controller.fetchMapData.mockResolvedValueOnce([...BUILDINGS, second, missing, unrelated]);
    queryBridge.selection = { status: 'ready', requestId, resultId: requestId, metadataReadAt: '2026-11-16T00:00:00Z', total: 3, offset: 0, hasMore: false,
      buildings: [...BUILDINGS, second, missing].map(value => ({ id: value.id, name: value.name, located: value !== missing,
        unavailableReason: value === missing ? 'missing_coordinates' : null, submarket: 'CBD', grade: 'A', photo: null })) };
    render(<MapWorkbenchPage initialIntelligenceHandoff={null} queryContext={{ requestId, details: false }} />);
    await waitFor(() => expect(controller.fitToBuildings).toHaveBeenCalledWith([...BUILDINGS, second]));
    expect(controller.renderMarkers).toHaveBeenLastCalledWith([...BUILDINGS, second], 'default', expect.anything(), undefined, false);
    expect(controller.openBuildingInfoWindow).not.toHaveBeenCalled();
    act(() => { queryBridge.publish?.(null); });
    await waitFor(() => expect(controller.renderMarkers).toHaveBeenLastCalledWith([], 'default', expect.anything(), undefined, false));
  });
});
