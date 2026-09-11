'use client';

import type { MapController } from '@/src/services/MapController';

import { installInfoWindowAvoidance } from './mapInfoWindowAvoidance';
import {
  controllerInternals,
  installFallbackMarkerHardening,
  installNativeMarkerRenderer,
} from './mapNativeMarkerRenderer';
import { installMapVisualHierarchyV3 } from './mapVisualHierarchyV3';

export function installMapInteractionHardening(
  controller: MapController,
  containerId: string,
): () => void {
  const container = document.getElementById(containerId);
  const internals = controllerInternals(controller);
  const map = internals.map;
  if (!container || !map) return () => {};

  // MapClient can finish a legacy DOM-marker render before the runtime hardening
  // attaches. Clear that stale layer exactly once so the native hierarchy starts
  // from a clean slate instead of stacking over old dots.
  const clearLegacyMarkers = internals.clearMarkers.bind(internals);
  clearLegacyMarkers();

  // Competitor mode still uses legacy distance markers. After it exits, clear
  // those markers once before normal native rendering resumes.
  let clearLegacyOnNextRender = false;
  const onCompetitorsCleared = () => { clearLegacyOnNextRender = true; };
  window.addEventListener('competitors-cleared', onCompetitorsCleared);

  // V3 enforces a strict visual hierarchy at rest: one primary tier only.
  // Adjacent tiers are allowed to overlap only while a zoom gesture is active.
  const hierarchyCleanup = installMapVisualHierarchyV3(controller, container);
  const nativeCleanup = hierarchyCleanup ? null : installNativeMarkerRenderer(internals, container);
  const fallbackCleanup = hierarchyCleanup || nativeCleanup
    ? null
    : installFallbackMarkerHardening(internals, container);

  if (hierarchyCleanup) {
    const hierarchyRender = internals.renderMarkers.bind(internals);
    internals.renderMarkers = ((...args: any[]) => {
      if (clearLegacyOnNextRender) {
        clearLegacyOnNextRender = false;
        clearLegacyMarkers();
      }
      hierarchyRender(...args);
    }) as typeof internals.renderMarkers;
  }

  const infoWindowCleanup = installInfoWindowAvoidance(map, container);

  return () => {
    window.removeEventListener('competitors-cleared', onCompetitorsCleared);
    infoWindowCleanup();
    hierarchyCleanup?.();
    nativeCleanup?.();
    fallbackCleanup?.();
  };
}
