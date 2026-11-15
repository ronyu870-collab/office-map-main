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
}));

const controllerRef = vi.hoisted(() => ({ current: controller }));

vi.mock('next/dynamic', () => ({
  default: () => function MockDynamicComponent() {
    return null;
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
    onRenderModeChange,
    onSearch,
    onFilterChange,
  }: {
    queryPanel?: React.ReactNode;
    onRenderModeChange: (mode: 'rent') => void;
    onSearch: (value: string) => void;
    onFilterChange: (state: SidebarFilterState) => void;
  }) => (
    <>
      {queryPanel}
      <button type="button" onClick={() => onRenderModeChange('rent')}>
        switch-to-rent
      </button>
      <button type="button" onClick={() => onFilterChange({
        ...createDefaultFilterState(), districts: ['海淀区'], showFutureSupply: false, futureSupplyGrades: [], futureSupplyYears: [],
      })}>close-layer-with-district-filter</button>
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
        record_year: 2026,
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
    queryBridge.selection = null; queryBridge.publish = undefined;
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
    expect(controller.openBuildingInfoWindow).toHaveBeenCalledWith(BUILDINGS[0].id);
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
