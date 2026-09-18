import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/services/MapController.ts', 'utf8');

describe('map building sales control shell', () => {
  it('adds 楼宇销控 as the sixth disabled action shell after 联系方式', () => {
    const contactIndex = source.indexOf('联系方式');
    const salesControlIndex = source.indexOf('楼宇销控');

    expect(contactIndex).toBeGreaterThan(-1);
    expect(salesControlIndex).toBeGreaterThan(contactIndex);
    expect(source).toContain('data-map-action="building-sales-control"');
    expect(source).toContain('aria-disabled="true"');
    expect(source).toContain('title="楼宇销控功能建设中"');
  });

  it('does not register or invoke a building sales control handler yet', () => {
    expect(source).not.toContain('__colliers_buildingSalesControl');
    expect(source).not.toContain('onclick="window.__colliers_buildingSalesControl');
  });
});
