import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeMapCanvas, projectCamera } from './observeMapCanvas';

let frames: Map<number, FrameRequestCallback>, next: number, resize: () => void;
const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb(0)); };
beforeEach(() => {
  frames = new Map(); next = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++next, cb); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { resize = cb; } observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => vi.unstubAllGlobals());
describe('map camera/layout coordination', () => {
  it('keeps a useful saved camera but restores project focus from a city or distant view', () => {
    const camera = { center: [116.46, 39.91] as [number, number], zoom: 15 };
    expect(projectCamera([116.461, 39.911], camera, 800, 600)).toEqual(camera);
    expect(projectCamera([116.46, 39.91], { ...camera, zoom: 9 }, 800, 600)).toEqual({ center: [116.46, 39.91], zoom: 14 });
    expect(projectCamera([116.3, 40], camera, 800, 600).center).toEqual([116.3, 40]);
  });
  it('coalesces resize and rapid selection into one latest camera update', () => {
    const host = document.createElement('div');
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 600 } as DOMRect);
    const map = { resize: vi.fn(), setZoomAndCenter: vi.fn(), getZoom: () => 10, getCenter: () => [116, 40], setCenter: vi.fn() };
    const coordinator = observeMapCanvas(host, map);
    coordinator.focus({ center: [116.1, 39.9] }); coordinator.focus({ center: [116.2, 39.9] }); resize(); resize(); flush();
    expect(map.resize).toHaveBeenCalledTimes(1);
    expect(map.setZoomAndCenter).toHaveBeenCalledExactlyOnceWith(14, [116.2, 39.9], false, 240);
    resize(); flush(); expect(map.resize).toHaveBeenCalledTimes(1);
    coordinator.focus({ center: [116.3, 39.9] }); host.dispatchEvent(new Event('pointerdown')); flush();
    expect(map.setZoomAndCenter).toHaveBeenLastCalledWith(10, [116, 40], true, 0);
    expect(map.setZoomAndCenter).toHaveBeenCalledTimes(2);
    coordinator.focus({ center: [116.4, 39.9] }); coordinator(); flush();
    expect(map.setZoomAndCenter).toHaveBeenCalledTimes(2);
  });
  it('restores overview camera exactly and honors reduced motion without an animation callback', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const host = document.createElement('div');
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 600 } as DOMRect);
    const map = { setZoomAndCenter: vi.fn() };
    const coordinator = observeMapCanvas(host, map);
    coordinator.focus({ center: [116.4, 39.9], camera: { center: [116.4, 39.9], zoom: 10 }, exact: true }); flush();
    expect(map.setZoomAndCenter).toHaveBeenCalledExactlyOnceWith(10, [116.4, 39.9], true, 0); coordinator();
  });
});
