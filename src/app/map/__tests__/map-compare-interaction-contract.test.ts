import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('map comparison interaction contracts', () => {
  it('keeps an always-available competitor exit path', () => {
    const page = read('src/app/map/page.tsx');
    const guard = read('src/app/map/MapCompetitorModeGuard.tsx');

    expect(page).toContain('<MapCompetitorModeGuard />');
    expect(guard).toContain("window.addEventListener('competitors-found'");
    expect(guard).toContain("window.addEventListener('competitors-cleared'");
    expect(guard).toContain("event.key !== 'Escape'");
    expect(guard).toContain(".comp-exit-btn");
    expect(guard).toContain('退出周边对比');
  });

  it('keeps building comparison navigation targeted and guarded', () => {
    const bridge = read('src/app/map/MapBuildingCompareBridge.tsx');

    expect(bridge).toContain("router.prefetch('/compare')");
    expect(bridge).toContain("new URLSearchParams({ buildingId })");
    expect(bridge).toContain("params.set('name', buildingName)");
    expect(bridge).toContain('navigatingRef.current');
    expect(bridge).toContain('router.push(`/compare?${params.toString()}`)');
  });
});
