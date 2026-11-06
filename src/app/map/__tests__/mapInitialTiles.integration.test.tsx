import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@amap/amap-jsapi-loader', () => ({ default: sdk }));

import { useMapRuntime } from '@/src/app/map/runtime/useMapRuntime';

type TileTiming = 'early' | 'late' | 'missing';

function installAmapFixture(timing: TileTiming) {
  const container = document.createElement('div');
  container.id = 'initial-tiles-map';
  document.body.append(container);
  const visibleRect = { width: 1280, height: 720 } as DOMRect;
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(visibleRect);

  const listeners: Array<() => void> = [];
  const complete = vi.fn(() => {
    listeners.forEach(listener => listener());
  });
  const instance = vi.fn(() => {
    container.innerHTML = '<div class="amap-maps"><div class="amap-layer"></div></div>';
    vi.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockReturnValue(visibleRect);
    if (timing === 'early') queueMicrotask(complete);
  });
  activeFixture = { instance, listeners };
  return { complete, instance };
}

// The real controller reuses the SDK across navigations. Each map instance
// still has its own event source and emits complete at most once in these tests.
let activeFixture: { instance: () => void; listeners: Array<() => void> };
sdk.load.mockResolvedValue({
  Map: class {
    private readonly fixture = activeFixture;

    constructor() { this.fixture.instance(); }
    on(event: string, callback: () => void) {
      if (event === 'complete') this.fixture.listeners.push(callback);
    }
    off(event: string, callback: () => void) {
      if (event !== 'complete') return;
      const index = this.fixture.listeners.indexOf(callback);
      if (index !== -1) this.fixture.listeners.splice(index, 1);
    }
    resize() {}
    getLayers() { return [{}]; }
    destroy() { this.fixture.listeners.length = 0; }
  },
  InfoWindow: class { close() {} },
  Pixel: class {},
});

function startMap() {
  const onError = vi.fn();
  const hook = renderHook(() => useMapRuntime({
    enabled: true,
    containerId: 'initial-tiles-map',
    userRole: 'viewer',
    currentUserId: 'test-viewer',
    onEditBuildingMetrics: vi.fn(),
    onReady: vi.fn(),
    onError,
  }));
  return { ...hook, onError };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.getElementById('initial-tiles-map')?.remove();
});

describe('initial AMap tiles through the map runtime', () => {
  it('becomes ready when the SDK completes once before controller initialization returns', async () => {
    const { complete } = installAmapFixture('early');
    const { result, onError } = startMap();

    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.mapReady).toBe(true));
    expect(onError.mock.calls).toEqual([[null]]);
  });

  it('waits for the SDK if it has not yet completed', async () => {
    const { complete, instance } = installAmapFixture('late');
    const { result, onError } = startMap();

    await act(async () => { await vi.dynamicImportSettled(); });
    expect(instance).toHaveBeenCalledTimes(1);
    expect(result.current.mapReady).toBe(false);
    act(() => complete());
    await waitFor(() => expect(result.current.mapReady).toBe(true));
    expect(onError.mock.calls).toEqual([[null]]);
  });

  it('still reports a timeout if the SDK never completes, even with a visible map container', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { instance } = installAmapFixture('missing');
    const { result, onError } = startMap();

    await act(async () => { await vi.dynamicImportSettled(); });
    expect(instance).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(14999); });
    expect(onError.mock.calls).toEqual([[null]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.mapReady).toBe(false);
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('高德地图初始化超时'));
  });
});
