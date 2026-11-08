import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('map overlay hierarchy css', () => {
  it('keeps submarket bubbles hard-hidden in dot/building tiers even while zooming', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app/map/map-native-overlays.css'), 'utf8');

    expect(css).toContain('body:has(#map-container[data-marker-tier="dot"]) .map-submarket-bubble');
    expect(css).toContain('body:has(#map-container[data-marker-tier="building"]) .map-submarket-bubble');
    expect(css).toContain('display: none !important;');
    expect(css).not.toContain('#map-container:not(.map-is-zooming)[data-marker-tier="dot"]');
    expect(css).not.toContain('#map-container:not(.map-is-zooming)[data-marker-tier="building"]');
  });
  it('does not force legacy 82px submarket circles into rectangular cards', () => {
    const workbench = readFileSync(resolve(process.cwd(), 'src/app/map/map-workbench.css'), 'utf8');
    const legacy = readFileSync(resolve(process.cwd(), 'src/services/MapController.ts'), 'utf8');
    expect(workbench).not.toContain('.amap-marker > div[style*="width: 82px; height: 82px"]');
    expect(legacy).toContain('width: 82px; height: 82px; border-radius: 50%');
    expect(workbench).toContain('.map-future-supply-marker');
  });

});
