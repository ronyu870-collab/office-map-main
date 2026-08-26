import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const controllerMocks = vi.hoisted(() => ({
  initMap: vi.fn(),
  getMapInstance: vi.fn(),
  setAdminMode: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('@/src/services/MapController', () => ({
  MapController: class {
    initMap = controllerMocks.initMap;
    getMapInstance = controllerMocks.getMapInstance;
    setAdminMode = controllerMocks.setAdminMode;
    destroy = controllerMocks.destroy;
  },
}));

import { useMapRuntime } from '@/src/app/map/runtime/useMapRuntime';

function createReadyMapInstance() {
  return {
    on: vi.fn((eventName: string, handler: () => void) => {
      if (eventName === 'complete') queueMicrotask(handler);
    }),
    off: vi.fn(),
    resize: vi.fn(),
    getLayers: vi.fn(() => [{}]),
    setLayers: vi.fn(),
    setMapStyle: vi.fn(),
  };
}

function installHealthyMapDom() {
  document.body.innerHTML = `
    <div id="map-container">
      <div class="amap-maps"><div class="amap-layer"></div></div>
    </div>
  `;

  const container = document.getElementById('map-container') as HTMLElement;
  const amapRoot = container.querySelector('.amap-maps') as HTMLElement;
  container.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720,
    width: 1280, height: 720, toJSON() {},
  } as DOMRect);
  amapRoot.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720,
    width: 1280, height: 720, toJSON() {},
  } as DOMRect);
}

describe('useMapRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installHealthyMapDom();
    controllerMocks.initMap.mockResolvedValue(undefined);
    controllerMocks.getMapInstance.mockReturnValue(createReadyMapInstance());
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not initialize the imperative map runtime while disabled', () => {
    renderHook(() => useMapRuntime({
      enabled: false,
      containerId: 'map-container',
      userRole: 'viewer',
      currentUserId: 'user-1',
      onEditBuildingMetrics: vi.fn(),
      onReady: vi.fn(),
      onError: vi.fn(),
    }));

    expect(controllerMocks.initMap).not.toHaveBeenCalled();
  });

  it('initializes once, applies role mode and delegates ready work', async () => {
    const onReady = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    const { result } = renderHook(() => useMapRuntime({
      enabled: true,
      containerId: 'map-container',
      userRole: 'editor',
      currentUserId: 'user-1',
      onEditBuildingMetrics: vi.fn(),
      onReady,
      onError,
    }));

    await waitFor(() => expect(result.current.mapReady).toBe(true), { timeout: 2000 });

    expect(controllerMocks.initMap).toHaveBeenCalledTimes(1);
    expect(controllerMocks.initMap).toHaveBeenCalledWith('map-container');
    expect(controllerMocks.setAdminMode).toHaveBeenCalledWith(false, 'user-1', undefined);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(null);
  });

  it('updates admin mode without recreating the map', async () => {
    const onEdit = vi.fn();
    const options = {
      enabled: true,
      containerId: 'map-container',
      currentUserId: 'admin-1',
      onEditBuildingMetrics: onEdit,
      onReady: vi.fn().mockResolvedValue(undefined),
      onError: vi.fn(),
    };

    const { rerender } = renderHook(
      ({ role }) => useMapRuntime({ ...options, userRole: role }),
      { initialProps: { role: 'editor' } },
    );

    await waitFor(() => expect(controllerMocks.setAdminMode).toHaveBeenCalledWith(false, 'admin-1', undefined), { timeout: 2000 });
    rerender({ role: 'admin' });

    await waitFor(() => {
      expect(controllerMocks.setAdminMode).toHaveBeenLastCalledWith(
        true,
        'admin-1',
        expect.any(Function),
      );
    });
    expect(controllerMocks.initMap).toHaveBeenCalledTimes(1);
  });

  it('destroys the owned controller on unmount', async () => {
    const { unmount } = renderHook(() => useMapRuntime({
      enabled: true,
      containerId: 'map-container',
      userRole: 'viewer',
      currentUserId: null,
      onEditBuildingMetrics: vi.fn(),
      onReady: vi.fn().mockResolvedValue(undefined),
      onError: vi.fn(),
    }));

    await waitFor(() => expect(controllerMocks.initMap).toHaveBeenCalled());
    unmount();
    expect(controllerMocks.destroy).toHaveBeenCalledTimes(1);
  });
});
