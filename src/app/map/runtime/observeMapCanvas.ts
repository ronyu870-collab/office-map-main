import type { Camera } from '../workspace/continuity';
type MapCanvas = {
  resize?: () => void; getCenter?: () => any; getZoom?: () => number;
  setCenter?: (center: any, immediately?: boolean, duration?: number) => void;
  setZoomAndCenter?: (zoom: number, center: [number, number], immediately?: boolean, duration?: number) => void;
};
export type CameraIntent = { center: [number, number]; camera?: Camera | null; exact?: boolean } | { fit: () => void };
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
  let disposed = false;
  const schedule = () => {
    if (frame !== null || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const rect = container.getBoundingClientRect();
      const next = `${Math.round(rect.width)}:${Math.round(rect.height)}`;
      if (!rect.width || !rect.height) return;
      if (size !== next) {
        size = next;
        const center = map.getCenter?.();
        map.resize?.();
        if (center && !pending) map.setCenter?.(center, true);
      }
      const intent = pending; pending = null;
      if (!intent) return;
      if ('fit' in intent) { intent.fit(); return; }
      const camera = intent.exact && intent.camera ? intent.camera : projectCamera(intent.center, intent.camera, rect.width, rect.height, map.getZoom?.());
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      if (map.setZoomAndCenter) map.setZoomAndCenter(camera.zoom, camera.center, reduced, reduced ? 0 : 240);
      else map.setCenter?.(camera.center, reduced, reduced ? 0 : 240);
    });
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  observer?.observe(container);
  const cancel = () => { pending = null; };
  container.addEventListener('pointerdown', cancel, true);
  container.addEventListener('wheel', cancel, { passive: true });
  window.addEventListener('resize', schedule);
  const cleanup = () => { disposed = true; observer?.disconnect(); if (frame !== null) cancelAnimationFrame(frame);
    container.removeEventListener('pointerdown', cancel, true); container.removeEventListener('wheel', cancel); window.removeEventListener('resize', schedule); };
  return Object.assign(cleanup, { focus: (intent: CameraIntent) => { pending = intent; schedule(); }, cancel });
}
