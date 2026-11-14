'use client';

/** Workbench-space rather than full-canvas-space centering for selected projects. */
type Bounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>;
type Reserved = { top?: Bounds | null; right?: Bounds | null; left?: Bounds | null; bottom?: Bounds | null };
type PannableMap = { getContainer?: () => HTMLElement | null; panBy?: (x: number, y: number, duration?: number) => void };

export function computeVisibleMapFocusOffset(viewport: Bounds, reserved: Reserved = {}) {
  if (viewport.width < 140 || viewport.height < 140) return { x: 0, y: 0 };
  const margin = 20;
  let left = viewport.left + margin;
  let right = viewport.right - margin;
  let top = viewport.top + margin;
  let bottom = viewport.bottom - margin;
  const horizontalMid = (viewport.left + viewport.right) / 2;

  if (reserved.top && reserved.top.left <= horizontalMid && reserved.top.right >= horizontalMid) {
    top = Math.max(top, Math.min(viewport.bottom, reserved.top.bottom + 16));
  }
  if (reserved.bottom && reserved.bottom.left <= horizontalMid && reserved.bottom.right >= horizontalMid) {
    bottom = Math.min(bottom, Math.max(viewport.top, reserved.bottom.top - 16));
  }
  if (bottom - top < 150) {
    top = viewport.top + margin;
    bottom = viewport.bottom - margin;
  }
  const verticalMid = (top + bottom) / 2;
  if (reserved.left && reserved.left.top < verticalMid && reserved.left.bottom > verticalMid) {
    left = Math.max(left, Math.min(viewport.right, reserved.left.right + 16));
  }
  if (reserved.right && reserved.right.top < verticalMid && reserved.right.bottom > verticalMid) {
    right = Math.min(right, Math.max(viewport.left, reserved.right.left - 16));
  }
  // On a narrow viewport an open drawer may take almost all the stage.
  // Do not send the focus point outside the remaining usable map.
  if (right - left < 150) {
    left = viewport.left + margin;
    right = viewport.right - margin;
  }
  return {
    x: Math.round((left + right) / 2 - (viewport.left + viewport.right) / 2),
    y: Math.round((top + bottom) / 2 - (viewport.top + viewport.bottom) / 2),
  };
}

/** Shift the map once, before opening a card. Popup layout must not pan it again. */
export function panMapFocusIntoAvailableArea(map: PannableMap | null | undefined, mapContainer?: HTMLElement | null) {
  if (!map?.panBy || typeof document === 'undefined') return { x: 0, y: 0 };
  const container = mapContainer ?? map.getContainer?.() ?? document.getElementById('map-container');
  if (!container) return { x: 0, y: 0 };
  const main = container.parentElement;
  if (!main) return { x: 0, y: 0 };
  const rect = container.getBoundingClientRect();
  const blocker = (side: keyof Reserved) => {
    const el = main.querySelector<HTMLElement>(`[data-map-focus-${side}]`);
    if (!el || el.closest('[inert]')) return null;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) return null;
    const bounds = el.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 ? bounds : null;
  };
  const offset = computeVisibleMapFocusOffset(rect, {
    top: blocker('top'), right: blocker('right'), left: blocker('left'), bottom: blocker('bottom'),
  });
  if (Math.abs(offset.x) >= 2 || Math.abs(offset.y) >= 2) map.panBy(offset.x, offset.y, 0);
  return offset;
}
