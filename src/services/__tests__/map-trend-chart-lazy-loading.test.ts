import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Map trend chart lazy-loading boundary', () => {
  it('keeps runtime ECharts imports out of MapController', () => {
    const controllerSource = readSource('src/services/MapController.ts');

    expect(controllerSource).not.toMatch(/from\s+["']echarts(?:\/[^"']*)?["']/);
    expect(controllerSource).not.toMatch(/require\(["']echarts/);
    expect(controllerSource).toContain('import("./map/trendChartRuntime")');
  });

  it('contains the ECharts runtime imports only in the lazy trend module', () => {
    const runtimeSource = readSource('src/services/map/trendChartRuntime.ts');

    expect(runtimeSource).toContain('from "echarts/core"');
    expect(runtimeSource).toContain('from "echarts/charts"');
    expect(runtimeSource).toContain('from "echarts/components"');
    expect(runtimeSource).toContain('from "echarts/renderers"');
    expect(runtimeSource).toContain('LineChart');
    expect(runtimeSource).not.toContain('BarChart');
    expect(runtimeSource).not.toContain('LegendComponent');
  });
});
