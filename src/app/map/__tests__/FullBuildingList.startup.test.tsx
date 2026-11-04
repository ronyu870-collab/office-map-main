import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ init: vi.fn(), destroy: vi.fn(), release: null as (() => void) | null, deferred: false }));
const building = vi.hoisted(() => ({ id: 'startup-building', name: '启动验证楼宇', grade: 'A', district: '朝阳区', submarket: 'CBD', location_lng: 116.46, location_lat: 39.91, metrics: [] }));
vi.mock('next/link', () => ({ default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('next/dynamic', () => ({ default: () => function UnrelatedDeferredModule() { return null; } }));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => ({ status: 'authenticated', session: { role: 'viewer', user: { id: 'startup-user', email: 'startup@example.test' } } }) }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: vi.fn() }));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('@/src/app/map/runtime/mapStartupOptimization', () => ({ installMapStartupOptimization: () => () => {} }));
vi.mock('@/src/app/map/runtime/mapInteractionHardening', () => ({ installMapInteractionHardening: () => () => {} }));
vi.mock('@/src/services/MapController', () => ({ MapController: class {
  map = { on: (name: string, handler: () => void) => { if (name === 'complete') queueMicrotask(handler); }, off: vi.fn(), resize: vi.fn(), getLayers: () => [{}], setLayers: vi.fn(), setMapStyle: vi.fn(), remove: vi.fn() };
  async initMap(id: string) {
    sdk.init();
    if (sdk.deferred) await new Promise<void>(resolve => { sdk.release = resolve; });
    const host = document.getElementById(id)!;
    host.innerHTML = '<div class="amap-maps"><canvas></canvas><div class="amap-overlays"></div></div>';
    const rect = () => ({ x: 0, y: 54, left: 0, top: 54, right: 1280, bottom: 720, width: 1280, height: 666, toJSON() {} } as DOMRect);
    host.getBoundingClientRect = rect;
    (host.firstElementChild as HTMLElement).getBoundingClientRect = rect;
  }
  getMapInstance() { return this.map; }
  fetchMapData = async () => [building];
  fetchFutureSupplies = async () => [];
  getDisplayOverridesCache = () => new Map();
  setAdminMode = vi.fn(); clearCompetitorElements = vi.fn(); clearDistrictBoundaries = vi.fn(); clearSubwayElements = vi.fn(); clearFutureMarkers = vi.fn(); renderMarkers = vi.fn(); renderFutureMarkers = vi.fn();
  destroy = sdk.destroy;
} }));

// Keep the real runtime's complete event and visual-health readiness checks.
import MapClient from '../MapClient';

let visibilityRules: HTMLStyleElement;
beforeEach(() => {
  vi.clearAllMocks(); sdk.release = null; sdk.deferred = false;
  // JSDOM needs the relevant existing Tailwind utilities; it has no layout engine.
  visibilityRules = document.createElement('style');
  visibilityRules.textContent = '.invisible{visibility:hidden}.opacity-0{opacity:0}';
  document.head.append(visibilityRules);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
});
afterEach(() => { cleanup(); visibilityRules.remove(); vi.unstubAllGlobals(); });

describe('full list with actual map-runtime readiness', () => {
  it('initializes a usable list when loading or refreshing its URL directly', async () => {
    window.history.replaceState(null, '', '/map?view=list');
    render(<MapClient initialIntelligenceHandoff={null} />);
    await screen.findByRole('region', { name: '完整楼宇列表' });
    await waitFor(() => expect(screen.getByRole('button', { name: '启动验证楼宇' })).toBeEnabled(), { timeout: 4000 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(sdk.init).toHaveBeenCalledTimes(1);
    const map = document.getElementById('map-container');
    const inactive = map?.closest('[aria-hidden="true"]');
    expect(inactive).toHaveAttribute('inert');
    expect(window.getComputedStyle(inactive as Element).opacity).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: '返回地图' }));
    expect(document.getElementById('map-container')).toBe(map);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.destroy).not.toHaveBeenCalled();
  });

  it('can enter the list while the original SDK is still starting', async () => {
    window.history.replaceState(null, '', '/map'); sdk.deferred = true;
    render(<MapClient initialIntelligenceHandoff={null} />);
    await waitFor(() => expect(sdk.release).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: '完整列表' }));
    sdk.release?.();
    await waitFor(() => expect(screen.getByRole('button', { name: '启动验证楼宇' })).toBeEnabled(), { timeout: 4000 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(sdk.init).toHaveBeenCalledTimes(1);
  });
});
