import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(path: string) {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('Map 2.0 presentation seam', () => {
  it('loads map-route presentation styles without moving behavior into the page shell', () => {
    const page = read('src/app/map/page.tsx');
    expect(page).toContain("import './map-workbench.css';");
    expect(page).toContain('<MapRouteGate initialIntelligenceHandoff={initialIntelligenceHandoff} buildingFocus={buildingFocus} />');
    expect(page).not.toContain('MapController');
    expect(page).not.toContain('MapDataStore');
  });

  it('styles AMap detail, marker, and embedded-filter surfaces through stable selectors', () => {
    const css = read('src/app/map/map-workbench.css');
    expect(css).toContain('.amap-info-content');
    expect(css).toContain('[data-building-id]');
    expect(css).toContain('body:has(#map-container) aside');
  });
  it('keeps future F markers scoped and circular without changing stock marker styles', () => {
    const css = read('src/app/map/map-workbench.css');
    const controller = read('src/services/MapController.ts');
    expect(controller).toContain('<div class="map-future-supply-marker" style="');
    expect(css).toContain('.amap-marker .map-future-supply-marker {');
    expect(css).toMatch(/\.map-future-supply-marker\s*\{\s*border-radius:\s*50%\s*!important;/);
    expect(css).not.toContain('.amap-marker > div[style*="width:26px;height:26px"]:not([data-building-id])');
    expect(css).toContain('[data-building-id][style*="width:26px"]');
  });
  it('preserves round competitor markers without overriding stock or future-supply styles', () => {
    const css = read('src/app/map/map-workbench.css');
    const controller = read('src/services/MapController.ts');
    expect(controller).toContain('class="map-competitor-marker" data-building-id=');
    expect(controller).toContain('class="map-competitor-marker__core" style="');
    expect(css).toMatch(/\.map-competitor-marker__core\s*\{\s*border-radius:\s*50%\s*!important;/);
    expect(css).not.toContain('[data-building-id][style*="flex-direction:column"] > div[style*="width:26px"]');
    expect(css).toContain('.map-future-supply-marker');
    expect(css).toContain('[data-building-id][style*="width:26px"]');
  });
});