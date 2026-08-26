import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

describe('map marker visual continuity', () => {
  it('keeps all three marker tiers circular and readable', () => {
    const renderer = read('src/app/map/runtime/mapNativeMarkerRenderer.ts');
    const css = read('src/app/map/map-native-overlays.css');

    expect(css).toContain('.map-submarket-bubble');
    expect(css).toContain('border-radius: 50%');
    expect(css).toContain('--sm-size: 82px');

    expect(renderer).toContain('width="12" height="12"');
    expect(renderer).toContain('size: new Size(12, 12)');
    expect(renderer).toContain('function detailBubbleImage');
    expect(renderer).toContain('width="34" height="34"');
    expect(renderer).toContain("type: 'image'");
    expect(renderer).toContain('size: [34, 34]');

    // High-zoom markers must not regress to tiny rectangular text backgrounds.
    expect(renderer).not.toContain('backgroundColor: visual.background');
  });

  it('uses a restrained but distinguishable default palette', () => {
    const renderer = read('src/app/map/runtime/mapNativeMarkerRenderer.ts');

    expect(renderer).toContain("gradeA: '#245b78'");
    expect(renderer).toContain("gradeB: '#4f7968'");
    expect(renderer).toContain("gradeBP: '#9b6948'");
    expect(renderer).toContain("neutral: '#8794a4'");
  });

  it('overlaps zoom tiers and uses hysteresis instead of hard boundary swapping', () => {
    const renderer = read('src/app/map/runtime/mapNativeMarkerRenderer.ts');

    expect(renderer).toContain('submarketMax: 11.58');
    expect(renderer).toContain('dotMin: 11.05');
    expect(renderer).toContain('dotMax: 13.35');
    expect(renderer).toContain('detailMin: 12.72');
    expect(renderer).toContain('nameMin: 14.05');
    expect(renderer).toContain('function stableMode');
    expect(renderer).toContain("active === 'dot' && zoom >= 11.14 && zoom < 13.18");
    expect(renderer).toContain('smoothStep(11.08, 11.5, zoom)');
    expect(renderer).toContain("map.on?.('zoomchange', onZoomChange)");
  });

  it('opens building detail after zoom settles rather than relying on one brittle timeout', () => {
    const renderer = read('src/app/map/runtime/mapNativeMarkerRenderer.ts');

    expect(renderer).toContain('const openAfterZoom = (building: any) =>');
    expect(renderer).toContain("map.on?.('zoomend', finish)");
    expect(renderer).toContain("map.off?.('zoomend', finish)");
    expect(renderer).toContain('fallbackTimer = window.setTimeout(finish, 700)');
  });
});
