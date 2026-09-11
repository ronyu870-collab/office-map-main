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
    expect(page).toContain('<MapRouteGate initialIntelligenceHandoff={initialIntelligenceHandoff} />');
    expect(page).not.toContain('MapController');
    expect(page).not.toContain('MapDataStore');
  });

  it('styles AMap detail, marker, and embedded-filter surfaces through stable selectors', () => {
    const css = read('src/app/map/map-workbench.css');
    expect(css).toContain('.amap-info-content');
    expect(css).toContain('[data-building-id]');
    expect(css).toContain('body:has(#map-container) aside');
  });
});