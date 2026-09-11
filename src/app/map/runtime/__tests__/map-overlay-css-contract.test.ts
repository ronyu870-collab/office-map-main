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
});
