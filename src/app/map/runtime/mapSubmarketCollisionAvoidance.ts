'use client';

type LayoutNode = {
  element: HTMLElement;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
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
  settleIterations: 12,
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
  const minX = node.halfWidth + SETTINGS.edgeGap;
  const maxX = width - node.halfWidth - SETTINGS.edgeGap;
  const minY = node.halfHeight + SETTINGS.edgeGap;
  const maxY = height - node.halfHeight - SETTINGS.edgeGap;

  if (maxX >= minX) node.x = clamp(node.x, minX, maxX);
  if (maxY >= minY) node.y = clamp(node.y, minY, maxY);
}

function pushOutsideUi(node: LayoutNode, rect: AvoidRect, width: number, height: number): void {
  const paddingX = node.halfWidth + SETTINGS.uiGap;
  const paddingY = node.halfHeight + SETTINGS.uiGap;
  const expanded = {
    left: rect.left - paddingX,
    top: rect.top - paddingY,
    right: rect.right + paddingX,
    bottom: rect.bottom + paddingY,
  };

  if (
    node.x <= expanded.left ||
    node.x >= expanded.right ||
    node.y <= expanded.top ||
    node.y >= expanded.bottom
  ) {
    return;
  }

  const minX = node.halfWidth + SETTINGS.edgeGap;
  const maxX = width - node.halfWidth - SETTINGS.edgeGap;
  const minY = node.halfHeight + SETTINGS.edgeGap;
  const maxY = height - node.halfHeight - SETTINGS.edgeGap;

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

function separatePair(a: LayoutNode, b: LayoutNode, useHorizontalRoom = false): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const overlapX = a.halfWidth + b.halfWidth + SETTINGS.collisionGap - Math.abs(dx);
  const overlapY = a.halfHeight + b.halfHeight + SETTINGS.collisionGap - Math.abs(dy);
  if (overlapX <= 0 || overlapY <= 0) return;

  // Cards can touch at their corners even when a width-based circular distance
  // looks clear. Separate along the nearer rectangle edge, keeping
  // already clear rows in place. Stable node ordering resolves coincident anchors.
  // A half-pixel total margin survives the final half-pixel shift rounding.
  if (useHorizontalRoom || overlapX < overlapY) {
    const push = (overlapX / 2 + 0.25) * (dx < 0 ? -1 : 1);
    a.x -= push;
    b.x += push;
  } else {
    const push = (overlapY / 2 + 0.25) * (dy < 0 ? -1 : 1);
    a.y -= push;
    b.y += push;
  }
}

function separateAndConstrain(nodes: LayoutNode[], avoidRects: AvoidRect[], width: number, height: number): void {
  for (let aIndex = 0; aIndex < nodes.length; aIndex += 1) {
    for (let bIndex = aIndex + 1; bIndex < nodes.length; bIndex += 1) {
      separatePair(nodes[aIndex], nodes[bIndex]);
    }
  }
  for (const node of nodes) {
    // Clamp first so an offscreen anchor cannot invalidate every UI candidate.
    keepInsideMap(node, width, height);
    for (const rect of avoidRects) pushOutsideUi(node, rect, width, height);
  }
}

function remainingOverlap(nodes: LayoutNode[]): number {
  let area = 0;
  for (let aIndex = 0; aIndex < nodes.length; aIndex += 1) {
    for (let bIndex = aIndex + 1; bIndex < nodes.length; bIndex += 1) {
      const a = nodes[aIndex];
      const b = nodes[bIndex];
      const x = a.halfWidth + b.halfWidth + SETTINGS.collisionGap - Math.abs(b.x - a.x);
      const y = a.halfHeight + b.halfHeight + SETTINGS.collisionGap - Math.abs(b.y - a.y);
      if (x > 0 && y > 0) area += x * y;
    }
  }
  return area;
}

function solve(nodes: LayoutNode[], avoidRects: AvoidRect[], width: number, height: number): void {
  nodes.sort((a, b) => (
    a.anchorY - b.anchorY ||
    a.anchorX - b.anchorX ||
    a.name.localeCompare(b.name, 'zh-CN')
  ));

  for (let iteration = 0; iteration < SETTINGS.iterations + SETTINGS.settleIterations; iteration += 1) {
    // The anchor spring is a soft preference. Stop it for the final passes so
    // labels pinned against a toolbar or map edge can fully separate.
    if (iteration > 0 && iteration < SETTINGS.iterations) {
      for (const node of nodes) {
        const displacement = Math.hypot(node.x - node.anchorX, node.y - node.anchorY);
        const spring = displacement > SETTINGS.strongSpringDistance
          ? SETTINGS.strongSpring
          : SETTINGS.spring;
        node.x += (node.anchorX - node.x) * spring;
        node.y += (node.anchorY - node.y) * spring;
      }
    }

    separateAndConstrain(nodes, avoidRects, width, height);
  }

  // Minimum-axis separation can pack wide cards into a column that is taller
  // than the viewport. Only if that relaxation still leaves collisions, let
  // one blocked pair use the available horizontal room, then settle normally.
  let bestOverlap = remainingOverlap(nodes);
  let bestPositions = nodes.map(node => ({ x: node.x, y: node.y }));
  for (let attempt = 0; bestOverlap > 0 && attempt < nodes.length; attempt += 1) {
    let blockedPair: [LayoutNode, LayoutNode] | null = null;
    for (let aIndex = 0; aIndex < nodes.length && !blockedPair; aIndex += 1) {
      for (let bIndex = aIndex + 1; bIndex < nodes.length; bIndex += 1) {
        const a = nodes[aIndex];
        const b = nodes[bIndex];
        const overlapX = a.halfWidth + b.halfWidth + SETTINGS.collisionGap - Math.abs(b.x - a.x);
        const overlapY = a.halfHeight + b.halfHeight + SETTINGS.collisionGap - Math.abs(b.y - a.y);
        const pairWidth = (a.halfWidth + b.halfWidth) * 2 + SETTINGS.collisionGap + 0.5;
        if (overlapY > 0 && overlapX >= overlapY && pairWidth <= width - SETTINGS.edgeGap * 2) {
          blockedPair = [a, b];
          break;
        }
      }
    }
    if (!blockedPair) break;
    separatePair(...blockedPair, true);
    for (let iteration = 0; iteration < SETTINGS.settleIterations; iteration += 1) {
      separateAndConstrain(nodes, avoidRects, width, height);
    }
    const overlap = remainingOverlap(nodes);
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      bestPositions = nodes.map(node => ({ x: node.x, y: node.y }));
    }
  }
  nodes.forEach((node, index) => Object.assign(node, bestPositions[index]));
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
      const currentCenterX = rect.left - containerRect.left + rect.width / 2;
      const currentCenterY = rect.top - containerRect.top + rect.height / 2;
      const anchorX = currentCenterX - previousX;
      const anchorY = currentCenterY - previousY;

      nodes.push({
        element,
        anchorX,
        anchorY,
        // Start from geographic anchors so the bounded crowded-card fallback
        // reaches the same layout on repeated moveend events, without drift.
        x: anchorX,
        y: anchorY,
        halfWidth: rect.width / 2,
        halfHeight: rect.height / 2,
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
