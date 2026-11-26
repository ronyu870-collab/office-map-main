import { WORKSPACE_MOTION } from './workspaceMotion';
import type { Camera } from '../workspace/continuity';
import { mercatorPoint } from './mapExtent';
import { readMapVisibleArea, visibleMapRect, visibleProjectCenter, type MapBounds } from './mapFocusViewport';
type MapCanvas = {
  on?: (event: string, handler: () => void) => void; off?: (event: string, handler: () => void) => void;
  resize?: () => void; getCenter?: () => any; getZoom?: () => number;
  setCenter?: (center: any, immediately?: boolean, duration?: number) => void;
  setZoomAndCenter?: (zoom: number, center: [number, number], immediately?: boolean, duration?: number) => void;
};
export type CameraIntent = { center: [number, number]; camera?: Camera | null; exact?: boolean } | { fit: (immediately?: boolean) => void | boolean; extentKey?: string };
export function projectCamera(center: [number, number], saved: Camera | null | undefined, width: number, height: number, currentZoom = 14, area?: { canvas: MapBounds; visible: MapBounds }): Camera {
  if (saved && saved.zoom >= 13.5) {
    const pixels = 256 * 2 ** saved.zoom;
    if (area) {
      const [tx, ty] = mercatorPoint(...center), [cx, cy] = mercatorPoint(...saved.center);
      const x = (area.canvas.left + area.canvas.right) / 2 + (tx - cx) * pixels;
      const y = (area.canvas.top + area.canvas.bottom) / 2 + (ty - cy) * pixels;
      const padX = Math.min(44, area.visible.width * .15), padY = Math.min(44, area.visible.height * .15);
      if (x >= area.visible.left + padX && x <= area.visible.right - padX && y >= area.visible.top + padY && y <= area.visible.bottom - padY) return saved;
    } else {
    const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / (2 * Math.PI);
    const x = Math.abs(center[0] - saved.center[0]) / 360 * pixels;
    const y = Math.abs(mercator(center[1]) - mercator(saved.center[1])) * pixels;
    if (x < width * .4 && y < height * .4) return saved;
    }
  }
  const zoom = Math.max(14, Math.min(18, saved?.zoom ?? currentZoom));
  return { center: area ? visibleProjectCenter(center, zoom, area.canvas, area.visible) : center, zoom };
}
/** One frame owns canvas sizing and camera movement. No timed layout/camera chain. */
export function observeMapCanvas(container: HTMLElement, map: MapCanvas) {
  let frame: number | null = null;
  let size = '';
  let geometry = '';
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
      if (container.closest('[inert]') || container.closest('[data-map-layout-ready="false"]') || window.getComputedStyle(container).visibility === 'hidden') return;
      const { rect, reserved } = readMapVisibleArea(container);
      const visible = visibleMapRect(rect, reserved);
      const next = `${Math.round(rect.width)}:${Math.round(rect.height)}`;
      if (!rect.width || !rect.height || visible.width < 16 || visible.height < 16) return;
      const nextGeometry = [next, ...[visible.left, visible.top, visible.right, visible.bottom].map(value => Math.round(value * 10) / 10)].join(':');
      const changed = geometry !== nextGeometry; geometry = nextGeometry;
      const resized = size !== next;
      if (resized) {
        size = next;
        const center = map.getCenter?.();
        map.resize?.();
        if (center && !pending && (!retained || userOwned)) map.setCenter?.(center, true);
      }
      const fromGeometry = !pending && changed;
      const intent = pending ?? (changed && !userOwned ? retained : null); pending = null;
      if (!intent) return;
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      const immediate = reduced || fromGeometry;
      moving = !immediate;
      if ('fit' in intent) { if (intent.fit(immediate) === false) moving = false; return; }
      const camera = intent.exact && intent.camera ? intent.camera : projectCamera(intent.center, intent.camera, rect.width, rect.height, map.getZoom?.(), {canvas:rect,visible});
      if (map.setZoomAndCenter) map.setZoomAndCenter(camera.zoom, camera.center, immediate, immediate ? 0 : WORKSPACE_MOTION.spatial);
      else map.setCenter?.(camera.center, immediate, immediate ? 0 : WORKSPACE_MOTION.spatial);
    });
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  observer?.observe(container);
  const layout = container.closest('.map-workspace-layout');
  const panes = layout?.querySelectorAll(':scope > aside') ?? [];
  if (layout) observer?.observe(layout);
  panes.forEach(pane => observer?.observe(pane));
  const mutations = layout && typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null;
  if (layout) mutations?.observe(layout, {attributes:true,attributeFilter:['style','data-expanded','data-compact','data-map-layout-ready']});
  panes.forEach(pane => mutations?.observe(pane,{attributes:true,attributeFilter:['inert','data-open','data-exiting']}));
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
  const cleanup = () => { disposed = true; map.off?.('moveend', finish); observer?.disconnect(); mutations?.disconnect(); if (frame !== null) cancelAnimationFrame(frame);
    container.removeEventListener('pointerdown', takeOver, true); container.removeEventListener('wheel', takeOver); window.removeEventListener('resize', schedule); };
  return Object.assign(cleanup, {
    // Establish ownership while its filtered data/layout is pending, without
    // creating a fake running animation that cancel() would try to stop.
    claim: (key: string) => { stop(); owner = key; userOwned = false; retained = null; pending = null; },
    focus: (intent: CameraIntent, key: string | null = null) => {
      stop(); owner = key; userOwned = false; retained = intent; pending = intent; schedule();
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
