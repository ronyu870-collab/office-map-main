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
    areInitialTilesReady() { return false; }
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

function installHealthyMapDom(width=1280,height=720) {
  document.body.innerHTML = `
    <div id="map-container">
      <div class="amap-maps"><div class="amap-layer"></div></div>
    </div>
  `;

  const container = document.getElementById('map-container') as HTMLElement;
  const amapRoot = container.querySelector('.amap-maps') as HTMLElement;
  container.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: width, bottom: height,
    width, height, toJSON() {},
  } as DOMRect);
  amapRoot.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: width, bottom: height,
    width, height, toJSON() {},
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

  it('applies and revokes admin actions independently of a pending SDK initialization',async()=>{
    controllerMocks.initMap.mockImplementationOnce(()=>new Promise<void>(()=>{}));
    const onReady=vi.fn(),onEdit=vi.fn();
    const options={enabled:true,containerId:'map-container',currentUserId:'user-1',onEditBuildingMetrics:onEdit,onReady,onError:vi.fn()};
    const {result,rerender,unmount}=renderHook(({role})=>useMapRuntime({...options,userRole:role}),{initialProps:{role:'admin'}});
    await waitFor(()=>expect(onReady).toHaveBeenCalledTimes(1));
    expect(result.current.mapReady).toBe(false);
    expect(controllerMocks.setAdminMode).toHaveBeenLastCalledWith(true,'user-1',expect.any(Function));
    rerender({role:'viewer'});
    expect(controllerMocks.setAdminMode).toHaveBeenLastCalledWith(false,'user-1',undefined);
    expect(controllerMocks.initMap).toHaveBeenCalledTimes(1);unmount();
  });

  it('waits while full reading intentionally hides the map, then validates the revealed surface',async()=>{
    const container=document.getElementById('map-container')!;
    const root=container.querySelector<HTMLElement>('.amap-maps')!;
    container.setAttribute('aria-hidden','true');root.style.visibility='hidden';
    const onReady=vi.fn(),onError=vi.fn();
    const {result}=renderHook(()=>useMapRuntime({enabled:true,containerId:'map-container',userRole:'viewer',currentUserId:'user-1',onEditBuildingMetrics:vi.fn(),onReady,onError}));
    await waitFor(()=>expect(controllerMocks.initMap).toHaveBeenCalled());
    await new Promise(resolve=>setTimeout(resolve,2000));
    expect(result.current.mapStage).toBe('tiles');expect(onReady).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenLastCalledWith(null);
    root.style.visibility='';container.removeAttribute('aria-hidden');
    await waitFor(()=>expect(result.current.mapReady).toBe(true),{timeout:1000});
  });

  it('disconnects the visibility observer when the hidden map is unmounted',async()=>{
    document.getElementById('map-container')!.setAttribute('aria-hidden','true');
    const observe=vi.spyOn(MutationObserver.prototype,'observe');
    const disconnect=vi.spyOn(MutationObserver.prototype,'disconnect');
    const {unmount}=renderHook(()=>useMapRuntime({enabled:true,containerId:'map-container',userRole:'viewer',currentUserId:'user-1',onEditBuildingMetrics:vi.fn(),onReady:vi.fn(),onError:vi.fn()}));
    await waitFor(()=>expect(observe.mock.calls.some(([,options])=>options?.attributeFilter?.includes('inert'))).toBe(true));
    const before=disconnect.mock.calls.length;unmount();
    expect(disconnect.mock.calls.length).toBeGreaterThan(before);
    expect(controllerMocks.destroy).toHaveBeenCalledTimes(1);
    observe.mockRestore();disconnect.mockRestore();
  });

  it.each([80,92])('accepts a rendered short-stage map %spx high without a false recovery or error',async height=>{
    installHealthyMapDom(320,height);
    const onError=vi.fn();
    const {result}=renderHook(()=>useMapRuntime({enabled:true,containerId:'map-container',userRole:'viewer',currentUserId:'user-1',onEditBuildingMetrics:vi.fn(),onReady:vi.fn(),onError}));
    await waitFor(()=>expect(result.current.mapReady).toBe(true),{timeout:2200});
    expect(onError).toHaveBeenLastCalledWith(null);
    expect(controllerMocks.getMapInstance().setMapStyle).not.toHaveBeenCalled();
  });

  it.each(['zero','no-layer'])('still rejects an unusable %s map surface',async failure=>{
    installHealthyMapDom(320,failure==='zero'?0:80);
    if(failure==='no-layer') document.querySelector('.amap-layer')?.remove();
    const onError=vi.fn();
    const {result}=renderHook(()=>useMapRuntime({enabled:true,containerId:'map-container',userRole:'viewer',currentUserId:'user-1',onEditBuildingMetrics:vi.fn(),onReady:vi.fn(),onError}));
    await waitFor(()=>expect(result.current.mapStage).toBe('error'),{timeout:3000});
    expect(result.current.mapReady).toBe(false);
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('渲染层初始化异常'));
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

  it('starts delegated startup work before AMap initialization finishes', async () => {
    let resolveInit!: () => void;
    controllerMocks.initMap.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveInit = resolve;
    }));
    const onReady = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useMapRuntime({
      enabled: true,
      containerId: 'map-container',
      userRole: 'viewer',
      currentUserId: 'user-1',
      onEditBuildingMetrics: vi.fn(),
      onReady,
      onError: vi.fn(),
    }));

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(controllerMocks.initMap).toHaveBeenCalledTimes(1);
    expect(result.current.mapReady).toBe(false);
    expect(result.current.mapStage).toBe('sdk');

    resolveInit();
    await waitFor(() => expect(result.current.mapReady).toBe(true), { timeout: 2000 });
    expect(result.current.mapStage).toBe('ready');
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

  it('constructs the return map at the saved camera and does not rebuild on camera prop updates', async () => {
    const options = {
      enabled: true,
      containerId: 'map-container',
      userRole: 'viewer',
      currentUserId: 'user-1',
      onEditBuildingMetrics: vi.fn(),
      onReady: vi.fn().mockResolvedValue(undefined),
      onError: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ camera }) => useMapRuntime({ ...options, initialCamera: camera }),
      { initialProps: { camera: { center: [116.47, 39.92] as [number, number], zoom: 15.5 } } },
    );
    await waitFor(() => expect(result.current.mapReady).toBe(true), { timeout: 2000 });
    expect(controllerMocks.initMap).toHaveBeenCalledWith('map-container', { lng: 116.47, lat: 39.92 }, { zoom: 15.5 });
    rerender({ camera: { center: [116.2, 40.1], zoom: 12 } });
    expect(controllerMocks.initMap).toHaveBeenCalledTimes(1);
    expect(controllerMocks.destroy).not.toHaveBeenCalled();
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
