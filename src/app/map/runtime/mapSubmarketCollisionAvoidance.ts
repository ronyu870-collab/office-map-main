'use client';

type LayoutNode = {
  element: HTMLElement;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  radius: number;
  name: string;
};

type AvoidRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const SETTINGS = {
  collisionGap: 8,
  uiGap: 8,
  edgeGap: 8,
  iterations: 36,
  spring: 0.06,
  strongSpring: 0.13,
  strongSpringDistance: 64,
  overlayMinZIndex: 240,
  settleDelayMs: 120,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function collectAvoidRects(container: HTMLElement): AvoidRect[] {
  const workspace = container.parentElement;
  if (!workspace) return [];

  const containerRect = container.getBoundingClientRect();
  const result: AvoidRect[] = [];
  const candidates = workspace.querySelectorAll<HTMLElement>('*');

  for (const element of candidates) {
    if (element === container || container.contains(element)) continue;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (style.position !== 'absolute' && style.position !== 'fixed' && style.position !== 'sticky') continue;

    const zIndex = Number.parseInt(style.zIndex, 10);
    if (!Number.isFinite(zIndex) || zIndex < SETTINGS.overlayMinZIndex) continue;

    const rect = element.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 24) continue;

    // Full-map loading/error scrims are not useful avoidance targets. They are
    // transient and would make every bubble unsatisfiable while they are shown.
    const nearlyFullMap = rect.width >= containerRect.width * 0.97 && rect.height >= containerRect.height * 0.9;
    if (nearlyFullMap) continue;

    const left = rect.left - containerRect.left;
    const top = rect.top - containerRect.top;
    const right = rect.right - containerRect.left;
    const bottom = rect.bottom - containerRect.top;
    if (right <= 0 || bottom <= 0 || left >= containerRect.width || top >= containerRect.height) continue;

    result.push({
      left: clamp(left, 0, containerRect.width),
      top: clamp(top, 0, containerRect.height),
      right: clamp(right, 0, containerRect.width),
      bottom: clamp(bottom, 0, containerRect.height),
    });
  }

  return result;
}

function keepInsideMap(node: LayoutNode, width: number, height: number): void {
  const minX = node.radius + SETTINGS.edgeGap;
  const maxX = width - node.radius - SETTINGS.edgeGap;
  const minY = node.radius + SETTINGS.edgeGap;
  const maxY = height - node.radius - SETTINGS.edgeGap;

  if (maxX >= minX) node.x = clamp(node.x, minX, maxX);
  if (maxY >= minY) node.y = clamp(node.y, minY, maxY);
}

function pushOutsideUi(node: LayoutNode, rect: AvoidRect, width: number, height: number): void {
  const padding = node.radius + SETTINGS.uiGap;
  const expanded = {
    left: rect.left - padding,
    top: rect.top - padding,
    right: rect.right + padding,
    bottom: rect.bottom + padding,
  };

  if (
    node.x <= expanded.left ||
    node.x >= expanded.right ||
    node.y <= expanded.top ||
    node.y >= expanded.bottom
  ) {
    return;
  }

  const minX = node.radius + SETTINGS.edgeGap;
  const maxX = width - node.radius - SETTINGS.edgeGap;
  const minY = node.radius + SETTINGS.edgeGap;
  const maxY = height - node.radius - SETTINGS.edgeGap;

  const candidates = [
    { x: expanded.left, y: node.y },
    { x: expanded.right, y: node.y },
    { x: node.x, y: expanded.top },
    { x: node.x, y: expanded.bottom },
  ].filter(candidate => (
    candidate.x >= minX &&
    candidate.x <= maxX &&
    candidate.y >= minY &&
    candidate.y <= maxY
  ));

  if (!candidates.length) return;

  candidates.sort((a, b) => {
    const aDistance = (a.x - node.x) ** 2 + (a.y - node.y) ** 2;
    const bDistance = (b.x - node.x) ** 2 + (b.y - node.y) ** 2;
    return aDistance - bDistance;
  });

  node.x = candidates[0].x;
  node.y = candidates[0].y;
}

function separatePair(a: LayoutNode, b: LayoutNode, aIndex: number, bIndex: number): void {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let distance = Math.hypot(dx, dy);
  const minimumDistance = a.radius + b.radius + SETTINGS.collisionGap;
  if (distance >= minimumDistance) return;

  if (distance < 0.001) {
    const angle = (((aIndex + 1) * 53 + (bIndex + 1) * 97) % 360) * (Math.PI / 180);
    dx = Math.cos(angle);
    dy = Math.sin(angle);
    distance = 1;
  }

  const ux = dx / distance;
  const uy = dy / distance;
  const push = (minimumDistance - distance) / 2 + 0.05;
  a.x -= ux * push;
  a.y -= uy * push;
  b.x += ux * push;
  b.y += uy * push;
}

function solve(nodes: LayoutNode[], avoidRects: AvoidRect[], width: number, height: number): void {
  nodes.sort((a, b) => (
    a.anchorY - b.anchorY ||
    a.anchorX - b.anchorX ||
    a.name.localeCompare(b.name, 'zh-CN')
  ));

  for (let iteration = 0; iteration < SETTINGS.iterations; iteration += 1) {
    if (iteration > 0) {
      for (const node of nodes) {
        const displacement = Math.hypot(node.x - node.anchorX, node.y - node.anchorY);
        const spring = displacement > SETTINGS.strongSpringDistance
          ? SETTINGS.strongSpring
          : SETTINGS.spring;
        node.x += (node.anchorX - node.x) * spring;
        node.y += (node.anchorY - node.y) * spring;
      }
    }

    for (let aIndex = 0; aIndex < nodes.length; aIndex += 1) {
      for (let bIndex = aIndex + 1; bIndex < nodes.length; bIndex += 1) {
        separatePair(nodes[aIndex], nodes[bIndex], aIndex, bIndex);
      }
    }

    for (const node of nodes) {
      for (const rect of avoidRects) pushOutsideUi(node, rect, width, height);
      keepInsideMap(node, width, height);
    }
  }
}

function resetBubbleShift(element: HTMLElement): void {
  element.style.removeProperty('--sm-collision-x');
  element.style.removeProperty('--sm-collision-y');
  delete element.dataset.collisionX;
  delete element.dataset.collisionY;
  delete element.dataset.collisionShifted;
}

export function installSubmarketCollisionAvoidance(
  map: any,
  container: HTMLElement,
): () => void {
  let frame: number | null = null;
  let settleTimer: number | null = null;
  let disposed = false;

  const schedule = () => {
    if (disposed || frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      layout();
    });
  };

  const scheduleSettled = () => {
    if (disposed) return;
    if (settleTimer !== null) window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      settleTimer = null;
      schedule();
    }, SETTINGS.settleDelayMs);
  };

  const layout = () => {
    if (disposed || container.dataset.markerTier !== 'submarket') return;
    if (
      container.classList.contains('map-is-zooming') ||
      container.classList.contains('map-is-moving') ||
      container.classList.contains('map-marker-swapping')
    ) {
      scheduleSettled();
      return;
    }

    const containerRect = container.getBoundingClientRect();
    if (containerRect.width <= 0 || containerRect.height <= 0) return;

    const bubbles = Array.from(container.querySelectorAll<HTMLElement>('.map-submarket-bubble'))
      .filter(element => {
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
    if (!bubbles.length) return;

    const nodes: LayoutNode[] = [];
    for (const element of bubbles) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      const previousX = finiteNumber(element.dataset.collisionX);
      const previousY = finiteNumber(element.dataset.collisionY);
      const computed = window.getComputedStyle(element);
      const renderedWidth = finiteNumber(computed.width, rect.width);
      const renderedHeight = finiteNumber(computed.height, rect.height);
      const radius = Math.max(42, Math.max(renderedWidth, renderedHeight) / 2);
      const currentCenterX = rect.left - containerRect.left + rect.width / 2;
      const currentCenterY = rect.top - containerRect.top + rect.height / 2;
      const anchorX = currentCenterX - previousX;
      const anchorY = currentCenterY - previousY;

      nodes.push({
        element,
        anchorX,
        anchorY,
        x: anchorX + previousX,
        y: anchorY + previousY,
        radius,
        name: element.title || element.textContent || '',
      });
    }
    if (!nodes.length) return;

    solve(nodes, collectAvoidRects(container), containerRect.width, containerRect.height);

    for (const node of nodes) {
      const shiftX = Math.round((node.x - node.anchorX) * 2) / 2;
      const shiftY = Math.round((node.y - node.anchorY) * 2) / 2;
      node.element.style.setProperty('--sm-collision-x', `${shiftX}px`);
      node.element.style.setProperty('--sm-collision-y', `${shiftY}px`);
      node.element.dataset.collisionX = String(shiftX);
      node.element.dataset.collisionY = String(shiftY);
      if (Math.hypot(shiftX, shiftY) >= 6) node.element.dataset.collisionShifted = 'true';
      else delete node.element.dataset.collisionShifted;
    }
  };

  const observer = new MutationObserver(() => scheduleSettled());
  observer.observe(container, { childList: true, subtree: true });

  const onViewportSettled = () => schedule();
  map.on?.('zoomend', onViewportSettled);
  map.on?.('moveend', onViewportSettled);
  window.addEventListener('resize', scheduleSettled, { passive: true });

  scheduleSettled();

  return () => {
    disposed = true;
    observer.disconnect();
    if (frame !== null) window.cancelAnimationFrame(frame);
    if (settleTimer !== null) window.clearTimeout(settleTimer);
    map.off?.('zoomend', onViewportSettled);
    map.off?.('moveend', onViewportSettled);
    window.removeEventListener('resize', scheduleSettled);
    for (const element of container.querySelectorAll<HTMLElement>('.map-submarket-bubble')) {
      resetBubbleShift(element);
    }
  };
}
