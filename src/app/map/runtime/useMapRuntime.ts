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

  return '请检查：① Key 是否为 Web 端（JS API）；② NEXT_PUBLIC_AMAP_KEY 与 NEXT_PUBLIC_AMAP_SECURITY_CODE 是否来自同一个 Key；③ 高德控制台域名白名单是否包含当前生产域名';
}

function assertMapInstanceCreated(controller: MapController) {
  if (getControllerMap(controller)) return;
  throw new Error(`高德地图初始化失败：未创建地图实例。${buildAmapConfigHint()}`);
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
      settle(() => reject(new Error(`高德地图图块加载超时。${buildAmapConfigHint()}`)));
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

        // AMap can create a Map object even when tile authentication later fails.
        // Require both an instance and the official `complete` event (initial map
        // resources loaded) before exposing the runtime as ready. This prevents
        // the UI/data layer from masking an invalid key/security-code/domain as
        // a seemingly successful but completely blank map.
        assertMapInstanceCreated(controller);
        await waitForInitialMapTiles(controller, () => cancelled);
        if (cancelled) return;

        applyAdminMode(controller);
        setMapReady(true);
        await readyRef.current(controller, () => cancelled);
      } catch (error) {
        if (!cancelled) {
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
