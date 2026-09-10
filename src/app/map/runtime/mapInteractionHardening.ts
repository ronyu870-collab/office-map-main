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

  // Capture the controller's DOM-marker clear path before a native runtime wraps it.
  // Competitor mode still renders legacy distance markers through MapController, so
  // those markers need one targeted cleanup when normal native rendering resumes.
  const clearLegacyMarkers = internals.clearMarkers.bind(internals);
  let clearLegacyOnNextRender = false;
  const onCompetitorsCleared = () => { clearLegacyOnNextRender = true; };
  window.addEventListener('competitors-cleared', onCompetitorsCleared);

  // Prefer the continuity runtime. Keep the previous native renderer and the
  // DOM-marker hardening as ordered fallbacks so map rendering remains fail-open
  // when an AMap browser/runtime does not expose all native layer primitives.
  const continuityCleanup = installMapVisualContinuityV2(controller, container);
  const nativeCleanup = continuityCleanup ? null : installNativeMarkerRenderer(internals, container);
  const fallbackCleanup = continuityCleanup || nativeCleanup
    ? null
    : installFallbackMarkerHardening(internals, container);

  if (continuityCleanup) {
    const continuityRender = internals.renderMarkers.bind(internals);
    internals.renderMarkers = ((...args: any[]) => {
      if (clearLegacyOnNextRender) {
        clearLegacyOnNextRender = false;
        clearLegacyMarkers();
      }
      continuityRender(...args);
    }) as typeof internals.renderMarkers;
  }

  const infoWindowCleanup = installInfoWindowAvoidance(map, container);

  return () => {
    window.removeEventListener('competitors-cleared', onCompetitorsCleared);
    infoWindowCleanup();
    continuityCleanup?.();
    nativeCleanup?.();
    fallbackCleanup?.();
  };
}
