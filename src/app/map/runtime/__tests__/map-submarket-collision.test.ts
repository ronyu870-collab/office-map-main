// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installSubmarketCollisionAvoidance } from '../mapSubmarketCollisionAvoidance';

const cleanups: Array<() => void> = [];

function createHarness(width = 720, height = 500) {
  const origin = { x: 24, y: 48 };
  const workspace = document.createElement('main');
  const container = document.createElement('div');
  container.dataset.markerTier = 'submarket';
  container.getBoundingClientRect = () => new DOMRect(origin.x, origin.y, width, height);
  workspace.append(container);
  document.body.append(workspace);

  const handlers = new Map<string, Set<() => void>>();
  const map = {
    on(event: string, handler: () => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off(event: string, handler: () => void) {
      handlers.get(event)?.delete(handler);
    },
  };

  return {
    container,
    addLabel(name: string, x: number, y: number, labelWidth = 128, labelHeight = 64, nameOnly = false) {
      const label = document.createElement('button');
      label.className = `map-submarket-bubble${nameOnly ? ' map-submarket-bubble--name-only' : ''}`;
      label.title = name;
      label.textContent = name;
      label.style.width = `${labelWidth}px`;
      label.style.height = `${labelHeight}px`;
      label.getBoundingClientRect = () => new DOMRect(
        origin.x + x + Number(label.dataset.collisionX ?? 0) - labelWidth / 2,
        origin.y + y + Number(label.dataset.collisionY ?? 0) - labelHeight / 2,
        labelWidth,
        labelHeight,
      );
      container.append(label);
      return label;
    },
    addUi(left: number, top: number, uiWidth: number, uiHeight: number) {
      const ui = document.createElement('nav');
      ui.style.position = 'absolute';
      ui.style.zIndex = '330';
      ui.getBoundingClientRect = () => new DOMRect(origin.x + left, origin.y + top, uiWidth, uiHeight);
      workspace.append(ui);
      return ui;
    },
    install() {
      const cleanup = installSubmarketCollisionAvoidance(map, container);
      cleanups.push(cleanup);
      return cleanup;
    },
    emit(event: string) {
      for (const handler of handlers.get(event) ?? []) handler();
    },
    listenerCount() {
      return [...handlers.values()].reduce((count, eventHandlers) => count + eventHandlers.size, 0);
    },
  };
}

function shift(label: HTMLElement) {
  return { x: Number(label.dataset.collisionX ?? 0), y: Number(label.dataset.collisionY ?? 0) };
}

function expectSeparated(a: HTMLElement, b: HTMLElement, gap = 8) {
  const aRect = a.getBoundingClientRect();
  const bRect = b.getBoundingClientRect();
  const horizontalGap = Math.max(bRect.left - aRect.right, aRect.left - bRect.right);
  const verticalGap = Math.max(bRect.top - aRect.bottom, aRect.top - bRect.bottom);
  expect(Math.max(horizontalGap, verticalGap)).toBeGreaterThanOrEqual(gap);
}

async function settle() {
  await vi.advanceTimersByTimeAsync(122);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
    window.setTimeout(() => callback(performance.now()), 1)
  ));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('submarket label collision layout', () => {
  it('separates diagonal card corners that a circular distance check misses', async () => {
    const harness = createHarness();
    const a = harness.addLabel('CBD', 150, 150);
    const b = harness.addLabel('燕莎', 275, 213);
    harness.install();

    await settle();

    expectSeparated(a, b);
    // The nearest separating axis is vertical: do not move both labels sideways.
    expect(shift(a).x).toBe(0);
    expect(shift(b).x).toBe(0);
    expect(Math.abs(shift(a).y)).toBeLessThanOrEqual(5);
    expect(Math.abs(shift(b).y)).toBeLessThanOrEqual(5);
  });

  it('leaves already separated cards at their geographic anchors', async () => {
    const harness = createHarness();
    const a = harness.addLabel('金融街', 220, 150);
    const b = harness.addLabel('丽泽', 220, 230);
    harness.install();

    await settle();

    expectSeparated(a, b, 16);
    expect(shift(a)).toEqual({ x: 0, y: 0 });
    expect(shift(b)).toEqual({ x: 0, y: 0 });
  });

  it('uses each rendered size for square legacy labels and shorter name-only cards', async () => {
    const harness = createHarness();
    const legacy = harness.addLabel('CBD', 180, 160, 96, 96);
    const nameOnly = harness.addLabel('未来区域', 288, 218, 128, 44, true);
    // Intrinsic sizing still uses the rendered box, without assuming a fixed card size.
    nameOnly.style.width = 'max-content';
    nameOnly.style.height = 'auto';
    harness.install();

    await settle();

    expectSeparated(legacy, nameOnly);
    expect(nameOnly.textContent).toBe('未来区域');
    expect(nameOnly.querySelector('.map-submarket-bubble__metrics')).toBeNull();
    expect(shift(legacy).y).toBe(0);
    expect(shift(nameOnly).y).toBe(0);
  });

  it('keeps a card inside a narrow viewport and clear of a top overlay', async () => {
    const harness = createHarness(320, 480);
    const label = harness.addLabel('中关村软件园', 40, 40, 152, 64);
    const edgeLabel = harness.addLabel('望京', 310, 470);
    const toolbar = harness.addUi(0, 0, 320, 60);
    harness.install();

    await settle();

    const bounds = harness.container.getBoundingClientRect();
    const rect = label.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(bounds.left + 8);
    expect(rect.right).toBeLessThanOrEqual(bounds.right - 8);
    expect(rect.top).toBeGreaterThanOrEqual(toolbar.getBoundingClientRect().bottom + 8);
    expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom - 8);
    expect(shift(label).y).toBe(60);
    const edgeRect = edgeLabel.getBoundingClientRect();
    expect(edgeRect.right).toBeLessThanOrEqual(bounds.right - 8);
    expect(edgeRect.bottom).toBeLessThanOrEqual(bounds.bottom - 8);
    expectSeparated(label, edgeLabel);
  });

  it('separates coincident anchors deterministically regardless of insertion order', async () => {
    const first = createHarness();
    const firstA = first.addLabel('A', 220, 200);
    const firstB = first.addLabel('B', 220, 200);
    const second = createHarness();
    const secondB = second.addLabel('B', 220, 200);
    const secondA = second.addLabel('A', 220, 200);
    first.install();
    second.install();

    await settle();

    expectSeparated(firstA, firstB);
    expectSeparated(secondA, secondB);
    expect(shift(firstA)).toEqual(shift(secondA));
    expect(shift(firstB)).toEqual(shift(secondB));
    expect(shift(firstA).x).toBe(0);
    expect(shift(firstB).x).toBe(0);
  });

  it('settles crowded cards below a toolbar without residual overlap or repeated-event drift', async () => {
    const harness = createHarness(320, 480);
    const a = harness.addLabel('A', 40, 40, 152, 64);
    const b = harness.addLabel('B', 40, 40, 152, 64);
    const toolbar = harness.addUi(0, 0, 320, 60);
    harness.install();
    await settle();

    expectSeparated(a, b);
    const initial = [shift(a), shift(b)];
    for (const label of [a, b]) {
      expect(label.getBoundingClientRect().top).toBeGreaterThanOrEqual(toolbar.getBoundingClientRect().bottom + 8);
    }
    for (let repeat = 0; repeat < 3; repeat += 1) {
      harness.emit('moveend');
      await settle();
      expect([shift(a), shift(b)]).toEqual(initial);
      expectSeparated(a, b);
    }
  });

  it('uses horizontal room when six coincident cards cannot fit in one narrow-screen column', async () => {
    const harness = createHarness(320, 480);
    const labels = Array.from({ length: 6 }, (_, index) => harness.addLabel(String(index), 160, 240));
    const toolbar = harness.addUi(0, 0, 320, 60);
    harness.install();
    await settle();

    const assertFits = () => {
      const bounds = harness.container.getBoundingClientRect();
      for (const [index, label] of labels.entries()) {
        const rect = label.getBoundingClientRect();
        expect(rect.left).toBeGreaterThanOrEqual(bounds.left + 8);
        expect(rect.right).toBeLessThanOrEqual(bounds.right - 8);
        expect(rect.top).toBeGreaterThanOrEqual(toolbar.getBoundingClientRect().bottom + 8);
        expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom - 8);
        for (const other of labels.slice(index + 1)) expectSeparated(label, other);
      }
    };
    assertFits();
    expect(labels.some(label => shift(label).x !== 0)).toBe(true);
    const initial = labels.map(shift);
    for (let repeat = 0; repeat < 3; repeat += 1) {
      harness.emit('moveend');
      await settle();
      assertFits();
      expect(labels.map(shift)).toEqual(initial);
    }
  });

  it('reuses real anchors on later map events and removes shifts on disposal', async () => {
    const harness = createHarness();
    const a = harness.addLabel('CBD', 150, 150);
    const b = harness.addLabel('燕莎', 275, 213);
    const cleanup = harness.install();
    await settle();
    const initial = [shift(a), shift(b)];

    for (let repeat = 0; repeat < 3; repeat += 1) {
      harness.emit('moveend');
      await settle();
      expect([shift(a), shift(b)]).toEqual(initial);
      expectSeparated(a, b);
    }

    // Dispose with both a queued animation frame and a settle timer in flight.
    harness.emit('zoomend');
    window.dispatchEvent(new Event('resize'));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    cleanup();
    expect(harness.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    for (const label of [a, b]) {
      expect(label.style.getPropertyValue('--sm-collision-x')).toBe('');
      expect(label.style.getPropertyValue('--sm-collision-y')).toBe('');
      expect(label.dataset.collisionX).toBeUndefined();
      expect(label.dataset.collisionY).toBeUndefined();
      expect(label.dataset.collisionShifted).toBeUndefined();
    }
    harness.emit('zoomend');
    window.dispatchEvent(new Event('resize'));
    await settle();
    expect(a.dataset.collisionX).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for map movement to settle and ignores hidden marker tiers', async () => {
    const harness = createHarness();
    const a = harness.addLabel('CBD', 150, 150);
    const b = harness.addLabel('燕莎', 275, 213);
    harness.container.classList.add('map-is-zooming');
    harness.install();
    await settle();
    expect(a.dataset.collisionX).toBeUndefined();

    harness.container.classList.remove('map-is-zooming');
    harness.container.dataset.markerTier = 'dot';
    harness.emit('zoomend');
    await settle();
    expect(a.dataset.collisionX).toBeUndefined();

    harness.container.dataset.markerTier = 'submarket';
    harness.emit('zoomend');
    await settle();
    expectSeparated(a, b);
  });
});
