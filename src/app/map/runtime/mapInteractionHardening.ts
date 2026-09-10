'use client';

import type { MapController } from '@/src/services/MapController';

import { installInfoWindowAvoidance } from './mapInfoWindowAvoidance';
import {
  controllerInternals,
  installFallbackMarkerHardening,
  installNativeMarkerRenderer,
} from './mapNativeMarkerRenderer';
import { installMapVisualContinuityV2 } from './mapVisualContinuityV2';

export function installMapInteractionHardening(
  controller: MapController,
  containerId: string,
): () => void {
  const container = document.getElementById(containerId);
  const internals = controllerInternals(controller);
  const map = internals.map;
  if (!container || !map) return () => {};

  // Prefer the continuity runtime. Keep the previous native renderer and the
  // DOM-marker hardening as ordered fallbacks so map rendering remains fail-open
  // when an AMap browser/runtime does not expose all native layer primitives.
  const continuityCleanup = installMapVisualContinuityV2(controller, container);
  const nativeCleanup = continuityCleanup ? null : installNativeMarkerRenderer(internals, container);
  const fallbackCleanup = continuityCleanup || nativeCleanup
    ? null
    : installFallbackMarkerHardening(internals, container);
  const infoWindowCleanup = installInfoWindowAvoidance(map, container);

  return () => {
    infoWindowCleanup();
    continuityCleanup?.();
    nativeCleanup?.();
    fallbackCleanup?.();
  };
}
