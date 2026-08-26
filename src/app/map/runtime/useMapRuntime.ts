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

function assertMapInstanceCreated(controller: MapController) {
  const getMapInstance = (controller as MapController & { getMapInstance?: () => unknown }).getMapInstance;
  if (typeof getMapInstance !== 'function') return;
  if (getMapInstance.call(controller)) return;

  const missingConfig: string[] = [];
  if (!process.env.NEXT_PUBLIC_AMAP_KEY?.trim()) missingConfig.push('NEXT_PUBLIC_AMAP_KEY');
  if (!process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE?.trim()) missingConfig.push('NEXT_PUBLIC_AMAP_SECURITY_CODE');

  const hint = missingConfig.length > 0
    ? `Vercel Production 环境缺少 ${missingConfig.join('、')}`
    : '请检查高德 Key、Security Code 以及 Web 端域名白名单';

  throw new Error(`高德地图初始化失败：未创建地图实例。${hint}`);
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

        // MapController historically swallowed AMap loader errors. Verify that a
        // real map instance exists before exposing the runtime as ready so a bad
        // key/security-code/domain configuration becomes an actionable UI error
        // instead of a silent blank map.
        assertMapInstanceCreated(controller);

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
