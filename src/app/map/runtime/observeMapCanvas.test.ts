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
  it('stops an active extent animation when the user takes over', () => {
    const host = document.createElement('div');
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
    const map = { getCenter: () => [116, 40], getZoom: () => 12, setZoomAndCenter: vi.fn() };
    const coordinator = observeMapCanvas(host, map);
    const fit = vi.fn(); coordinator.focus({ fit }); flush();
    expect(fit).toHaveBeenCalledOnce();
    host.dispatchEvent(new Event('wheel'));
    expect(map.setZoomAndCenter).toHaveBeenCalledExactlyOnceWith(12, [116, 40], true, 0);
    coordinator();
  });
  it('ignores stale data and preserves gesture ownership until an explicit new intent', () => {
    const host = document.createElement('div');
    const rect = new DOMRect(0, 0, 800, 600);
    vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => rect);
    const coordinator = observeMapCanvas(host, { resize: vi.fn() });
    const fitA = vi.fn(), fitB = vi.fn();
    coordinator.focus({ fit: fitA }, 'A'); coordinator.focus({ fit: fitB }, 'B');
    coordinator.update('A', { fit: fitA }); flush();
    expect(fitA).not.toHaveBeenCalled(); expect(fitB).toHaveBeenCalledOnce();
    host.dispatchEvent(new Event('pointerdown'));
    coordinator.update('B', { fit: fitB }); resize(); flush();
    expect(fitB).toHaveBeenCalledOnce();
    coordinator.focus({ fit: fitB }, 'B'); flush(); expect(fitB).toHaveBeenCalledTimes(2);
    coordinator();
  });
  it('keeps a useful saved camera but restores project focus from a city or distant view', () => {
    const camera = { center: [116.46, 39.91] as [number, number], zoom: 15 };
    expect(projectCamera([116.461, 39.911], camera, 800, 600)).toEqual(camera);
    expect(projectCamera([116.46, 39.91], { ...camera, zoom: 9 }, 800, 600)).toEqual({ center: [116.46, 39.91], zoom: 14 });
    expect(projectCamera([116.3, 40], camera, 800, 600).center).toEqual([116.3, 40]);
  });
  it('coalesces resize and rapid selection into one latest camera update', () => {
    const host = document.createElement('div');
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
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
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
    const map = { setZoomAndCenter: vi.fn() };
    const coordinator = observeMapCanvas(host, map);
    coordinator.focus({ center: [116.4, 39.9], camera: { center: [116.4, 39.9], zoom: 10 }, exact: true }); flush();
    expect(map.setZoomAndCenter).toHaveBeenCalledExactlyOnceWith(10, [116.4, 39.9], true, 0); coordinator();
  });
});

it('does not restart the same region extent when refreshed records have identical coordinates', () => {
  const host = document.createElement('div');
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
  const coordinator = observeMapCanvas(host, { resize: vi.fn() });
  const initial = vi.fn(), duplicate = vi.fn();
  coordinator.focus({ fit: () => {} }, 'CBD');
  coordinator.update('CBD', { fit: initial, extentKey: 'same coordinates' }); flush();
  coordinator.update('CBD', { fit: duplicate, extentKey: 'same coordinates' }); flush();
  expect(initial).toHaveBeenCalledOnce();
  expect(duplicate).not.toHaveBeenCalled();
  coordinator();
});

it('still fits changed data, changed canvas size and explicit region reselection', () => {
  const host = document.createElement('div');
  let width = 800;
  vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width, 600));
  const coordinator = observeMapCanvas(host, { resize: vi.fn() });
  const initial = vi.fn(), changed = vi.fn(), repeated = vi.fn();
  coordinator.focus({ fit: () => {} }, 'CBD');
  coordinator.update('CBD', { fit: initial, extentKey: 'stock' }); flush();
  coordinator.update('CBD', { fit: changed, extentKey: 'stock and delayed future' }); flush();
  expect(changed).toHaveBeenCalledOnce();
  width = 640; resize(); flush();
  expect(changed).toHaveBeenLastCalledWith(true);
  expect(changed).toHaveBeenCalledTimes(2);
  host.dispatchEvent(new Event('pointerdown'));
  coordinator.update('CBD', { fit: repeated, extentKey: 'stock and delayed future' }); flush();
  expect(repeated).not.toHaveBeenCalled();
  coordinator.focus({ fit: () => {} }, 'CBD');
  coordinator.update('CBD', { fit: repeated, extentKey: 'stock and delayed future' }); flush();
  expect(repeated).toHaveBeenCalledOnce();
  coordinator();
});
