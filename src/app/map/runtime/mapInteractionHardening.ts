'use client';

import type { MapController } from '@/src/services/MapController';

import { installInfoWindowAvoidance } from './mapInfoWindowAvoidance';
import {
  controllerInternals,
  installFallbackMarkerHardening,
  installNativeMarkerRenderer,
} from './mapNativeMarkerRenderer';

export function installMapInteractionHardening(
  controller: MapController,
  containerId: string,
): () => void {
  const container = document.getElementById(containerId);
  const internals = controllerInternals(controller);
  const map = internals.map;
  if (!container || !map) return () => {};

  const nativeCleanup = installNativeMarkerRenderer(internals, container);
  const fallbackCleanup = nativeCleanup ? null : installFallbackMarkerHardening(internals, container);
  const infoWindowCleanup = installInfoWindowAvoidance(map, container);

  return () => {
    infoWindowCleanup();
    nativeCleanup?.();
    fallbackCleanup?.();
  };
}
