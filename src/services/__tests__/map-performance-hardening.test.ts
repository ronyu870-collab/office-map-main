import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Map performance hardening contracts', () => {
  it('keeps MapClient behind the route shell and admin editing behind a secondary dynamic chunk', () => {
    const routeGate = read('src/app/map/MapRouteGate.tsx');
    const mapClient = read('src/app/map/MapClient.tsx');

    expect(routeGate).toContain("dynamic(() => import('./MapClient')");
    expect(mapClient).not.toContain("import { BuildingMetricsEditModal } from '@/src/components/map/BuildingMetricsEditModal'");
    expect(mapClient).toContain("import('@/src/components/map/BuildingMetricsEditModal')");
  });

  it('has exactly one owner for the first building marker render', () => {
    const controller = read('src/services/MapController.ts');
    const initStart = controller.indexOf('async initMap(');
    const analyzeStart = controller.indexOf('public analyzeCompetitors(', initStart);
    const initMapSource = controller.slice(initStart, analyzeStart);

    expect(initStart).toBeGreaterThanOrEqual(0);
    expect(initMapSource).not.toContain('this.fetchAndRenderMarkers()');
    expect(controller).toContain('async fetchAndRenderMarkers(): Promise<void>');
  });

  it('starts the lazy Trend runtime before waiting for history data while preserving lazy loading', () => {
    const controller = read('src/services/MapController.ts');
    const trendStart = controller.indexOf('(window as any).__colliers_toggleTrend');
    const initStart = controller.indexOf('async initMap(', trendStart);
    const trendSource = controller.slice(trendStart, initStart);

    const runtimeImport = trendSource.indexOf('const trendRuntimePromise = import("./map/trendChartRuntime")');
    const historyRequest = trendSource.indexOf('.from("building_metrics")');

    expect(runtimeImport).toBeGreaterThanOrEqual(0);
    expect(historyRequest).toBeGreaterThan(runtimeImport);
    expect(trendSource).toContain('void trendRuntimePromise');
    expect(trendSource).toContain('trend.buildingId !== buildingId');
    expect(trendSource).toContain('panel.style.display === "none"');
  });
});
