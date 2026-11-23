import { WORKSPACE_MOTION } from './workspaceMotion';
import type { Camera } from '../workspace/continuity';
type MapCanvas = {
  on?: (event: string, handler: () => void) => void; off?: (event: string, handler: () => void) => void;
  resize?: () => void; getCenter?: () => any; getZoom?: () => number;
  setCenter?: (center: any, immediately?: boolean, duration?: number) => void;
  setZoomAndCenter?: (zoom: number, center: [number, number], immediately?: boolean, duration?: number) => void;
};
export type CameraIntent = { center: [number, number]; camera?: Camera | null; exact?: boolean } | { fit: (immediately?: boolean) => void; extentKey?: string };
export function projectCamera(center: [number, number], saved: Camera | null | undefined, width: number, height: number, currentZoom = 14): Camera {
  if (saved && saved.zoom >= 13.5) {
    const pixels = 256 * 2 ** saved.zoom;
    const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / (2 * Math.PI);
    const x = Math.abs(center[0] - saved.center[0]) / 360 * pixels;
    const y = Math.abs(mercator(center[1]) - mercator(saved.center[1])) * pixels;
    if (x < width * .4 && y < height * .4) return saved;
  }
  return { center, zoom: Math.max(14, Math.min(18, saved?.zoom ?? currentZoom)) };
}
/** One frame owns canvas sizing and camera movement. No timed layout/camera chain. */
export function observeMapCanvas(container: HTMLElement, map: MapCanvas) {
  let frame: number | null = null;
  let size = '';
  let pending: CameraIntent | null = null;
  let owner: string | null = null;
  let retained: CameraIntent | null = null;
  let userOwned = false;
  let disposed = false;
  let moving = false;
  const finish = () => { moving = false; };
  map.on?.('moveend', finish);
  const schedule = () => {
    if (frame !== null || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const rect = container.getBoundingClientRect();
      const next = `${Math.round(rect.width)}:${Math.round(rect.height)}`;
      if (!rect.width || !rect.height) return;
      const resized = size !== next;
      if (resized) {
        size = next;
        const center = map.getCenter?.();
        map.resize?.();
        if (center && !pending && (!retained || userOwned)) map.setCenter?.(center, true);
      }
      const fromResize = !pending && resized;
      const intent = pending ?? (resized && !userOwned ? retained : null); pending = null;
      if (!intent) return;
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      moving = !reduced && !fromResize;
      if ('fit' in intent) { intent.fit(fromResize || reduced); return; }
      const camera = intent.exact && intent.camera ? intent.camera : projectCamera(intent.center, intent.camera, rect.width, rect.height, map.getZoom?.());
      if (map.setZoomAndCenter) map.setZoomAndCenter(camera.zoom, camera.center, reduced, reduced ? 0 : WORKSPACE_MOTION.spatial);
      else map.setCenter?.(camera.center, reduced, reduced ? 0 : WORKSPACE_MOTION.spatial);
    });
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  observer?.observe(container);
  const stop = () => {
    if (!moving) return;
    moving = false;
    const point = map.getCenter?.(); const zoom = map.getZoom?.();
    const center = point && [point.getLng?.() ?? point.lng ?? point[0], point.getLat?.() ?? point.lat ?? point[1]];
    if (center?.every(Number.isFinite) && Number.isFinite(zoom)) map.setZoomAndCenter?.(zoom!, center as [number, number], true, 0);
  };
  const cancel = () => { pending = null; retained = null; owner = null; stop(); };
  const takeOver = () => { userOwned = true; pending = null; stop(); };
  container.addEventListener('pointerdown', takeOver, true);
  container.addEventListener('wheel', takeOver, { passive: true });
  window.addEventListener('resize', schedule);
  const cleanup = () => { disposed = true; map.off?.('moveend', finish); observer?.disconnect(); if (frame !== null) cancelAnimationFrame(frame);
    container.removeEventListener('pointerdown', takeOver, true); container.removeEventListener('wheel', takeOver); window.removeEventListener('resize', schedule); };
  return Object.assign(cleanup, {
    focus: (intent: CameraIntent, key: string | null = null) => {
      stop(); owner = key; userOwned = false; retained = 'fit' in intent ? intent : null; pending = intent; schedule();
    },
    // Delayed data can complete the current intent, but cannot reclaim a gesture
    // or an intent belonging to a different project/search/region.
    update: (key: string, intent: CameraIntent) => {
      if (owner !== key || userOwned || disposed) return;
      // Data/render refreshes can recreate the same coordinate set on a later
      // frame. Keep its running camera instead of starting the same fit again.
      // Resize still reprojects retained geometry; explicit focus resets it.
      if ('fit' in intent && intent.extentKey !== undefined && retained && 'fit' in retained && retained.extentKey === intent.extentKey) return;
      retained = 'fit' in intent ? intent : null; pending = intent; schedule();
    }, cancel,
  });
}
