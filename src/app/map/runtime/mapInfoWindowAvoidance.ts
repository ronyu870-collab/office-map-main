'use client';

type MapViewportLike = {
  panBy?: (x: number, y: number, duration?: number) => void;
  on?: (eventName: string, handler: () => void) => void;
  off?: (eventName: string, handler: () => void) => void;
};

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    Number(style.opacity || '1') > 0 &&
    rect.width > 0 && rect.height > 0;
}

function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function workbenchBlockers(container: HTMLElement): DOMRect[] {
  const main = container.parentElement;
  if (!main) return [];
  const mainRect = main.getBoundingClientRect();
  const result: DOMRect[] = [];

  const header = main.previousElementSibling;
  if (header instanceof HTMLElement && isVisible(header)) {
    result.push(header.getBoundingClientRect());
  }

  for (const child of Array.from(main.children)) {
    if (!(child instanceof HTMLElement) || child === container || !isVisible(child)) continue;
    const style = window.getComputedStyle(child);
    if (!['absolute', 'fixed', 'sticky'].includes(style.position)) continue;

    const zIndex = Number.parseInt(style.zIndex || '0', 10);
    if (!Number.isFinite(zIndex) || zIndex < 250) continue;

    const rect = child.getBoundingClientRect();
    const nearTop = rect.top <= mainRect.top + 140;
    const nearBottom = rect.bottom >= mainRect.bottom - 140;
    const nearLeft = rect.left <= mainRect.left + 400;
    const nearRight = rect.right >= mainRect.right - 400;
    if (nearTop || nearBottom || nearLeft || nearRight) result.push(rect);
  }

  return result;
}

function shiftedRect(rect: DOMRect, x: number, y: number): DOMRect {
  return {
    x: rect.x + x,
    y: rect.y + y,
    left: rect.left + x,
    right: rect.right + x,
    top: rect.top + y,
    bottom: rect.bottom + y,
    width: rect.width,
    height: rect.height,
    toJSON: rect.toJSON?.bind(rect) ?? (() => ({})),
  } as DOMRect;
}

export function computeInfoWindowPan(container: HTMLElement, infoRect: DOMRect): { x: number; y: number } {
  const viewport = container.parentElement?.getBoundingClientRect();
  if (!viewport) return { x: 0, y: 0 };

  const margin = 12;
  let x = 0;
  let y = 0;

  if (infoRect.left < viewport.left + margin) x += viewport.left + margin - infoRect.left;
  if (infoRect.right > viewport.right - margin) x -= infoRect.right - (viewport.right - margin);
  if (infoRect.top < viewport.top + margin) y += viewport.top + margin - infoRect.top;
  if (infoRect.bottom > viewport.bottom - margin) y -= infoRect.bottom - (viewport.bottom - margin);

  for (const blocker of workbenchBlockers(container)) {
    const current = shiftedRect(infoRect, x, y);
    if (!intersects(current, blocker)) continue;

    const pushDown = blocker.bottom + margin - current.top;
    const pushUp = blocker.top - margin - current.bottom;
    const pushRight = blocker.right + margin - current.left;
    const pushLeft = blocker.left - margin - current.right;

    const nearTop = blocker.top <= viewport.top + 160;
    const nearBottom = blocker.bottom >= viewport.bottom - 160;
    const narrowSide = blocker.width < viewport.width * 0.58;
    const nearLeft = narrowSide && blocker.left <= viewport.left + 400;
    const nearRight = narrowSide && blocker.right >= viewport.right - 400;

    if (nearTop) y += pushDown;
    else if (nearBottom) y += pushUp;
    else if (nearLeft) x += pushRight;
    else if (nearRight) x += pushLeft;
    else {
      const candidates = [
        { axis: 'y' as const, value: pushDown },
        { axis: 'y' as const, value: pushUp },
        { axis: 'x' as const, value: pushRight },
        { axis: 'x' as const, value: pushLeft },
      ].sort((a, b) => Math.abs(a.value) - Math.abs(b.value));
      const best = candidates[0];
      if (best?.axis === 'x') x += best.value;
      else if (best) y += best.value;
    }
  }

  return {
    x: Math.max(-320, Math.min(320, x)),
    y: Math.max(-320, Math.min(320, y)),
  };
}

function mutationTouchesInfoWindow(mutations: MutationRecord[]): boolean {
  for (const mutation of mutations) {
    if (mutation.target instanceof Element && mutation.target.closest('.amap-info')) return true;
    for (const node of [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)]) {
      if (!(node instanceof Element)) continue;
      if (node.matches('.amap-info') || node.querySelector('.amap-info')) return true;
    }
  }
  return false;
}

export function installInfoWindowAvoidance(map: MapViewportLike, container: HTMLElement): () => void {
  let timer: number | null = null;
  let firstFrame: number | null = null;
  let secondFrame: number | null = null;
  let adjusting = false;
  let observedInfo: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const clearSchedule = () => {
    if (timer !== null) window.clearTimeout(timer);
    if (firstFrame !== null) cancelAnimationFrame(firstFrame);
    if (secondFrame !== null) cancelAnimationFrame(secondFrame);
    timer = null;
    firstFrame = null;
    secondFrame = null;
  };

  const observeInfoSize = (info: HTMLElement | null) => {
    if (info === observedInfo) return;
    resizeObserver?.disconnect();
    resizeObserver = null;
    observedInfo = info;
    if (!info || typeof ResizeObserver === 'undefined') return;
    resizeObserver = new ResizeObserver(() => schedule());
    resizeObserver.observe(info);
  };

  const adjust = () => {
    if (adjusting) return;
    const info = container.querySelector<HTMLElement>('.amap-info');
    observeInfoSize(info);
    if (!info || !isVisible(info)) return;

    const pan = computeInfoWindowPan(container, info.getBoundingClientRect());
    if ((Math.abs(pan.x) < 2 && Math.abs(pan.y) < 2) || typeof map.panBy !== 'function') return;

    adjusting = true;
    container.classList.add('map-info-avoiding');
    map.panBy(pan.x, pan.y, 170);
    window.setTimeout(() => {
      adjusting = false;
      container.classList.remove('map-info-avoiding');
    }, 210);
  };

  const schedule = () => {
    clearSchedule();
    timer = window.setTimeout(() => {
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          firstFrame = null;
          secondFrame = null;
          adjust();
        });
      });
    }, 0);
  };

  const observer = new MutationObserver(mutations => {
    if (mutationTouchesInfoWindow(mutations)) schedule();
  });
  observer.observe(container, { childList: true, subtree: true });

  const onMoveEnd = () => {
    if (container.querySelector('.amap-info')) schedule();
  };
  map.on?.('moveend', onMoveEnd);
  window.addEventListener('resize', schedule);

  return () => {
    clearSchedule();
    observer.disconnect();
    resizeObserver?.disconnect();
    map.off?.('moveend', onMoveEnd);
    window.removeEventListener('resize', schedule);
    container.classList.remove('map-info-avoiding');
  };
}
