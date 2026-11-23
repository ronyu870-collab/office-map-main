'use client';

/** Workbench-space rather than full-canvas-space centering for selected projects. */
type Bounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>;
type Reserved = { top?: Bounds | null; right?: Bounds | null; left?: Bounds | null; bottom?: Bounds | null };
type PannableMap = { getContainer?: () => HTMLElement | null; panBy?: (x: number, y: number, duration?: number) => void };

export function visibleMapRect(viewport: Bounds, reserved: Reserved = {}) {
  const margin = 20;
  let left = viewport.left + margin;
  let right = viewport.right - margin;
  let top = viewport.top + margin;
  let bottom = viewport.bottom - margin;
  const horizontalMid = (viewport.left + viewport.right) / 2;

  if (reserved.top && reserved.top.bottom > viewport.top && reserved.top.top < viewport.bottom && reserved.top.left <= horizontalMid && reserved.top.right >= horizontalMid) {
    top = Math.max(top, Math.min(viewport.bottom, reserved.top.bottom + 16));
  }
  if (reserved.bottom && reserved.bottom.bottom > viewport.top && reserved.bottom.top < viewport.bottom && reserved.bottom.left <= horizontalMid && reserved.bottom.right >= horizontalMid) {
    bottom = Math.min(bottom, Math.max(viewport.top, reserved.bottom.top - 16));
  }
  if (bottom - top < 150) {
    top = viewport.top + margin;
    bottom = viewport.bottom - margin;
  }
  const verticalMid = (top + bottom) / 2;
  if (reserved.left && reserved.left.right > viewport.left && reserved.left.left < viewport.right && reserved.left.top < verticalMid && reserved.left.bottom > verticalMid) {
    left = Math.max(left, Math.min(viewport.right, reserved.left.right + 16));
  }
  if (reserved.right && reserved.right.left < viewport.right && reserved.right.right > viewport.left && reserved.right.top < verticalMid && reserved.right.bottom > verticalMid) {
    right = Math.min(right, Math.max(viewport.left, reserved.right.left - 16));
  }
  // On a narrow viewport an open drawer may take almost all the stage.
  // Do not send the focus point outside the remaining usable map.
  if (right - left < 150) {
    left = viewport.left + margin;
    right = viewport.right - margin;
  }
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

export function computeVisibleMapFocusOffset(viewport: Bounds, reserved: Reserved = {}) {
  if (viewport.width < 140 || viewport.height < 140) return { x: 0, y: 0 };
  const { left, right, top, bottom } = visibleMapRect(viewport, reserved);
  return {
    x: Math.round((left + right) / 2 - (viewport.left + viewport.right) / 2),
    y: Math.round((top + bottom) / 2 - (viewport.top + viewport.bottom) / 2),
  };
}

/** Read actual overlap; desktop grid columns already removed from the canvas
 * must not be deducted a second time. */
export function readMapVisibleArea(container: HTMLElement) {
  const main = container.parentElement;
  const workbench = main?.closest('[data-map-focus-root]') ?? main;
  const rect = container.getBoundingClientRect();
  const blocker = (side: keyof Reserved) => {
    const el = workbench?.querySelector<HTMLElement>(`[data-map-focus-${side}]`);
    if (!el || el.closest('[inert]')) return null;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) return null;
    const bounds = el.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 ? bounds : null;
  };
  return { rect, reserved: { top: blocker('top'), right: blocker('right'), left: blocker('left'), bottom: blocker('bottom') } };
}

/** Shift the map once, before opening a card. Popup layout must not pan it again. */
export function panMapFocusIntoAvailableArea(map: PannableMap | null | undefined, mapContainer?: HTMLElement | null) {
  if (!map?.panBy || typeof document === 'undefined') return { x: 0, y: 0 };
  const container = mapContainer ?? map.getContainer?.() ?? document.getElementById('map-container');
  if (!container) return { x: 0, y: 0 };
  const { rect, reserved } = readMapVisibleArea(container);
  const offset = computeVisibleMapFocusOffset(rect, reserved);
  if (Math.abs(offset.x) >= 2 || Math.abs(offset.y) >= 2) map.panBy(offset.x, offset.y, 0);
  return offset;
}
