'use client';

import * as React from 'react';

import type { MapController } from '@/src/services/MapController';

type MapRuntimeOptions = {
  enabled: boolean;
  containerId: string;
  userRole: string;
  currentUserId: string | null;
  onEditBuildingMetrics: (buildingId: string, buildingName: string) => void;
  onReady: (controller: MapController, isCancelled: () => boolean) => Promise<void> | void;
  onError: (message: string | null) => void;
};

export type MapRuntimeHandle = {
  controllerRef: React.MutableRefObject<any>;
  mapReady: boolean;
};

type AMapInstanceLike = {
  on?: (eventName: string, handler: () => void) => void;
  off?: (eventName: string, handler: () => void) => void;
  resize?: () => void;
  getLayers?: () => unknown[];
  setLayers?: (layers: unknown[]) => void;
  setMapStyle?: (style: string) => void;
};

type MapVisualSnapshot = {
  width: number;
  height: number;
  amapRootPresent: boolean;
  amapRootVisible: boolean;
  renderNodeCount: number;
  canvasCount: number;
  overlayRootPresent: boolean;
  layerCount: number | null;
};

function getControllerMap(controller: MapController): AMapInstanceLike | null {
  const getMapInstance = (controller as MapController & { getMapInstance?: () => unknown }).getMapInstance;
  if (typeof getMapInstance !== 'function') return null;
  return (getMapInstance.call(controller) as AMapInstanceLike | null) ?? null;
}

function buildAmapConfigHint(): string {
  const missingConfig: string[] = [];
  if (!process.env.NEXT_PUBLIC_AMAP_KEY?.trim()) missingConfig.push('NEXT_PUBLIC_AMAP_KEY');
  if (!process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE?.trim()) missingConfig.push('NEXT_PUBLIC_AMAP_SECURITY_CODE');

  if (missingConfig.length > 0) {
    return `Vercel Production 环境缺少 ${missingConfig.join('、')}`;
  }

  return '请检查高德 Web JS API 配置、浏览器 WebGL/硬件加速以及当前网络是否能访问高德地图资源';
}

function assertMapInstanceCreated(controller: MapController) {
  if (getControllerMap(controller)) return;
  throw new Error(`高德地图初始化失败：未创建地图实例。${buildAmapConfigHint()}`);
}

function nextPaint(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readVisualSnapshot(controller: MapController, containerId: string): MapVisualSnapshot {
  const map = getControllerMap(controller);
  const container = document.getElementById(containerId);
  const rect = container?.getBoundingClientRect();
  const amapRoot = container?.querySelector<HTMLElement>('.amap-maps, .amap-map') ?? null;
  const rootStyle = amapRoot ? window.getComputedStyle(amapRoot) : null;
  const rootRect = amapRoot?.getBoundingClientRect();
  const amapRootVisible = Boolean(
    amapRoot &&
    rootStyle &&
    rootStyle.display !== 'none' &&
    rootStyle.visibility !== 'hidden' &&
    Number(rootStyle.opacity || '1') > 0 &&
    (rootRect?.width ?? 0) > 0 &&
    (rootRect?.height ?? 0) > 0
  );

  let layerCount: number | null = null;
  try {
    const layers = map?.getLayers?.();
    if (Array.isArray(layers)) layerCount = layers.length;
  } catch {
    layerCount = null;
  }

  return {
    width: Math.round(rect?.width ?? 0),
    height: Math.round(rect?.height ?? 0),
    amapRootPresent: Boolean(amapRoot),
    amapRootVisible,
    renderNodeCount: container?.querySelectorAll('.amap-layer, .amap-layers, canvas, .amap-tile, .amap-tile-container').length ?? 0,
    canvasCount: container?.querySelectorAll('canvas').length ?? 0,
    overlayRootPresent: Boolean(container?.querySelector('.amap-overlays')),
    layerCount,
  };
}

function snapshotLooksHealthy(snapshot: MapVisualSnapshot): boolean {
  return snapshot.width >= 100 &&
    snapshot.height >= 100 &&
    snapshot.amapRootPresent &&
    snapshot.amapRootVisible &&
    snapshot.renderNodeCount > 0 &&
    snapshot.layerCount !== 0;
}

function formatVisualSnapshot(snapshot: MapVisualSnapshot): string {
  return [
    `容器 ${snapshot.width}×${snapshot.height}`,
    `AMap根节点 ${snapshot.amapRootPresent ? '存在' : '缺失'}`,
    `根节点 ${snapshot.amapRootVisible ? '可见' : '不可见'}`,
    `渲染节点 ${snapshot.renderNodeCount}`,
    `Canvas ${snapshot.canvasCount}`,
    `Overlay ${snapshot.overlayRootPresent ? '存在' : '缺失'}`,
    `底图层 ${snapshot.layerCount ?? '未知'}`,
  ].join('；');
}

async function repairAndVerifyMapVisuals(
  controller: MapController,
  containerId: string,
  isCancelled: () => boolean,
): Promise<void> {
  const map = getControllerMap(controller);
  if (!map) return;

  await nextPaint();
  if (isCancelled()) return;

  // AMap's default resize monitoring is disabled. React route/layout transitions
  // can therefore leave the renderer with stale dimensions even though the host
  // div is now full size. Always synchronize once after the workbench is painted.
  try {
    map.resize?.();
  } catch (error) {
    console.warn('[MapRuntime] AMap resize failed', error);
  }

  await wait(250);
  if (isCancelled()) return;

  let snapshot = readVisualSnapshot(controller, containerId);
  if (snapshotLooksHealthy(snapshot)) return;

  console.warn('[MapRuntime] AMap visual layer unhealthy; attempting recovery', snapshot);

  // Do not rely solely on AMap's implicit default layer. If the renderer exists
  // but no usable layer DOM was produced, rebuild the official standard layer
  // explicitly and fall back from the custom visual style to the standard style.
  const amapGlobal = (window as typeof window & {
    AMap?: { createDefaultLayer?: (options?: Record<string, unknown>) => unknown };
  }).AMap;

  try {
    if (typeof amapGlobal?.createDefaultLayer === 'function' && typeof map.setLayers === 'function') {
      const defaultLayer = amapGlobal.createDefaultLayer({
        zooms: [3, 20],
        visible: true,
        opacity: 1,
        zIndex: 0,
      });
      map.setLayers([defaultLayer]);
    }
    map.setMapStyle?.('amap://styles/normal');
    map.resize?.();
  } catch (error) {
    console.warn('[MapRuntime] AMap standard-layer recovery failed', error);
  }

  await wait(1200);
  await nextPaint();
  if (isCancelled()) return;

  snapshot = readVisualSnapshot(controller, containerId);
  if (snapshotLooksHealthy(snapshot)) {
    console.info('[MapRuntime] AMap visual layer recovered', snapshot);
    return;
  }

  throw new Error(
    `高德地图渲染层初始化异常（${formatVisualSnapshot(snapshot)}）。` +
    '页面业务数据已加载，但地图可视层未正常建立。请确认浏览器已开启硬件加速/WebGL，并检查当前网络是否拦截 webapi.amap.com 等高德资源。',
  );
}

async function waitForInitialMapTiles(
  controller: MapController,
  isCancelled: () => boolean,
  timeoutMs = 15000,
): Promise<void> {
  const map = getControllerMap(controller);
  if (!map?.on) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      map.off?.('complete', handleComplete);
    };

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const handleComplete = () => {
      settle(() => resolve());
    };

    map.on('complete', handleComplete);
    timer = setTimeout(() => {
      if (isCancelled()) {
        settle(() => resolve());
        return;
      }
      settle(() => reject(new Error(`高德地图初始化超时。${buildAmapConfigHint()}`)));
    }, timeoutMs);
  });
}

export function useMapRuntime({
  enabled,
  containerId,
  userRole,
  currentUserId,
  onEditBuildingMetrics,
  onReady,
  onError,
}: MapRuntimeOptions): MapRuntimeHandle {
  const controllerRef = React.useRef<any>(null);
  const [mapReady, setMapReady] = React.useState(false);

  const roleRef = React.useRef(userRole);
  const userIdRef = React.useRef(currentUserId);
  const editRef = React.useRef(onEditBuildingMetrics);
  const readyRef = React.useRef(onReady);
  const errorRef = React.useRef(onError);

  roleRef.current = userRole;
  userIdRef.current = currentUserId;
  editRef.current = onEditBuildingMetrics;
  readyRef.current = onReady;
  errorRef.current = onError;

  const applyAdminMode = React.useCallback((controller: MapController) => {
    const isAdmin = roleRef.current === 'admin';
    controller.setAdminMode(
      isAdmin,
      userIdRef.current || undefined,
      isAdmin
        ? (buildingId: string, buildingName: string) => editRef.current(buildingId, buildingName)
        : undefined,
    );
  }, []);

  React.useEffect(() => {
    if (!enabled) {
      setMapReady(false);
      return;
    }

    let cancelled = false;
    let ownedController: MapController | null = null;

    void (async () => {
      try {
        const mapControllerModule = await import('@/src/services/MapController');
        if (cancelled) return;

        const controller = new mapControllerModule.MapController();
        ownedController = controller;
        controllerRef.current = controller;
        errorRef.current(null);
        setMapReady(false);

        await controller.initMap(containerId);
        if (cancelled) return;

        assertMapInstanceCreated(controller);
        await waitForInitialMapTiles(controller, () => cancelled);
        if (cancelled) return;

        await repairAndVerifyMapVisuals(controller, containerId, () => cancelled);
        if (cancelled) return;

        applyAdminMode(controller);
        setMapReady(true);
        await readyRef.current(controller, () => cancelled);
      } catch (error) {
        if (!cancelled) {
          console.error('[MapRuntime] map initialization failed', error);
          errorRef.current(error instanceof Error ? error.message : '地图初始化失败');
          setMapReady(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      setMapReady(false);
      if (controllerRef.current === ownedController) controllerRef.current = null;
      ownedController?.destroy();
    };
  }, [applyAdminMode, containerId, enabled]);

  React.useEffect(() => {
    if (!mapReady || !controllerRef.current) return;
    applyAdminMode(controllerRef.current as MapController);
  }, [applyAdminMode, currentUserId, mapReady, userRole]);

  return { controllerRef, mapReady };
}
