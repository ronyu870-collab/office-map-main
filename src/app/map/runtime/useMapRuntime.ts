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
        const module = await import('@/src/services/MapController');
        if (cancelled) return;

        const controller = new module.MapController();
        ownedController = controller;
        controllerRef.current = controller;
        errorRef.current(null);
        setMapReady(false);

        await controller.initMap(containerId);
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
