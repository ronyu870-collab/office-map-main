import { afterEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ init: vi.fn(), getInstanceByDom: vi.fn() }));
vi.mock('echarts/core', () => ({ ...runtime, use: vi.fn() }));
vi.mock('echarts/charts', () => ({ LineChart: {} }));
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {} }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));
import { initTrendChart } from '../map/trendChartRuntime';
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.innerHTML = ''; });
it('resizes with its physical container and releases resize/button bindings on disposal', () => {
  document.body.innerHTML = '<button id="chart-btn-rent"></button><button id="chart-btn-vac"></button><div id="chart"></div>';
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  const disposed = chart.dispose;
  runtime.init.mockReturnValue(chart);
  let resize!: ResizeObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe() {} disconnect = disconnect; });
  const instance = initTrendChart(document.getElementById('chart')!, [{ year: 2026, net_effective_rent: 200, vacancy_rate: .1 }]);
  const notify = (width: number) => resize([{ contentRect: { width, height: 280 } } as ResizeObserverEntry], {} as ResizeObserver);
  notify(500);
  expect(chart.resize).toHaveBeenCalledOnce();
  notify(0);
  expect(chart.resize).toHaveBeenCalledOnce();
  document.getElementById('chart-btn-vac')!.click();
  expect(chart.setOption).toHaveBeenCalledTimes(2);
  instance!.dispose();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(disposed).toHaveBeenCalledOnce();
  notify(500);
  expect(chart.resize).toHaveBeenCalledOnce();
  instance!.dispose();
  expect(disposed).toHaveBeenCalledOnce();
  document.getElementById('chart-btn-rent')!.click();
  expect(chart.setOption).toHaveBeenCalledTimes(2);
});

it('preserves missing trend observations instead of drawing false zeroes', () => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  runtime.init.mockReturnValue(chart);
  document.body.innerHTML = '<button id="chart-btn-vac"></button><div id="chart"></div>';
  const values = [null, undefined, '', 'invalid', 0, '200'];
  const instance = initTrendChart(document.getElementById('chart')!, values.map((value, index) => ({ year: 2021 + index, net_effective_rent: value, vacancy_rate: value })));
  expect(chart.setOption.mock.calls[0][0].series[0].data).toEqual([null, null, null, null, 0, 200]);
  expect(chart.setOption.mock.calls[0][0].tooltip.valueFormatter(null)).toBe('未提供');
  document.getElementById('chart-btn-vac')!.click();
  expect(chart.setOption.mock.lastCall?.[0].series[0].data).toEqual([null, null, null, null, 0, 20000]);
  instance!.dispose();
});

it('observes the displayed metric once per actual switch and stops after disposal', () => {
  document.body.innerHTML = '<button id="chart-btn-rent"></button><button id="chart-btn-vac"></button><div id="chart"></div>';
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  runtime.init.mockReturnValue(chart);
  const view = vi.fn();
  const instance = initTrendChart(document.getElementById('chart')!, [{ year: 2026, net_effective_rent: 200, vacancy_rate: .1 }], view);
  document.getElementById('chart-btn-rent')!.click();
  document.getElementById('chart-btn-vac')!.click();
  document.getElementById('chart-btn-vac')!.click();
  document.getElementById('chart-btn-rent')!.click();
  expect(view.mock.calls).toEqual([['rent'], ['vac'], ['rent']]);
  expect(chart.setOption).toHaveBeenCalledTimes(3);
  instance!.dispose();
  document.getElementById('chart-btn-vac')!.click();
  expect(view).toHaveBeenCalledTimes(3);
  expect(initTrendChart(document.getElementById('chart')!, [], view)).toBeNull();
  expect(view).toHaveBeenCalledTimes(3);
});

it('keeps isolated observations visible on straight lines with a readable unit axis', () => {
  document.body.innerHTML = '<div id="chart"></div>';
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  runtime.init.mockReturnValue(chart);
  const instance = initTrendChart(document.getElementById('chart')!, [null, 0, null, 200, null].map((value, index) => ({ year: 2022 + index, net_effective_rent: value, vacancy_rate: value })));
  const option = chart.setOption.mock.calls[0][0];
  expect(option.series[0].smooth).toBe(false);
  expect(option.series[0].connectNulls).toBe(false);
  expect(option.series[0].showSymbol).toBe(true);
  expect(option.series[0].showAllSymbol).toBe(true);
  expect(option.series[0].symbol).toBe('circle');
  expect(option.yAxis[0].show).toBe(true);
  expect(option.yAxis[0].name).toBe('元/㎡/月');
  instance!.dispose();
});

it('provides exact periods and both metrics as text, preserving missing and real zero', () => {
  document.body.innerHTML = '<button id="chart-btn-rent"></button><button id="chart-btn-vac"></button><div id="chart"></div><div data-building-trend-data></div>';
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  runtime.init.mockReturnValue(chart);
  const instance = initTrendChart(document.getElementById('chart')!, [
    { year: 2025, quarter:'Q4', net_effective_rent: null, vacancy_rate: null },
    { year: 2026, quarter:'Q3', net_effective_rent: 0, vacancy_rate: 0 },
  ]);
  const disclosure = document.querySelector('[data-building-trend-data] details');
  expect(disclosure?.querySelector('summary')?.textContent).toBe('查看期间数据');
  const rows = disclosure?.querySelectorAll('tbody tr');
  expect(rows?.[0].textContent).toBe('2025Q4——');
  expect(rows?.[1].textContent).toBe('2026Q30.00.0');
  expect(document.getElementById('chart-btn-rent')).toHaveAttribute('aria-pressed','true');
  document.getElementById('chart-btn-vac')!.click();
  expect(document.getElementById('chart-btn-rent')).toHaveAttribute('aria-pressed','false');
  expect(document.getElementById('chart-btn-vac')).toHaveAttribute('aria-pressed','true');
  instance!.dispose();
  expect(document.querySelector('[data-building-trend-data]')).toBeEmptyDOMElement();
});

it('updates reduced motion without recording another metric view and removes the listener', () => {
  document.body.innerHTML = '<div id="chart"></div>';
  let change!: () => void;
  const media = { matches: true, addEventListener: vi.fn((_: string, callback: () => void) => { change=callback; }), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia',vi.fn(()=>media));
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  runtime.init.mockReturnValue(chart);
  const view=vi.fn();
  const instance=initTrendChart(document.getElementById('chart')!,[{year:2026,net_effective_rent:200,vacancy_rate:.1}],view);
  expect(chart.setOption.mock.calls[0][0].animation).toBe(false);
  media.matches=false;change();
  expect(chart.setOption.mock.lastCall?.[0].animation).toBe(true);
  expect(view).toHaveBeenCalledOnce();
  instance!.dispose();
  expect(media.removeEventListener).toHaveBeenCalledWith('change',change);
});

it('announces a metric with no usable observations without losing the period table', () => {
  document.body.innerHTML='<button id="chart-btn-rent"></button><button id="chart-btn-vac"></button><div id="chart"></div><div data-building-trend-data></div>';
  const chart={setOption:vi.fn(),resize:vi.fn(),dispose:vi.fn()};runtime.init.mockReturnValue(chart);
  const instance=initTrendChart(document.getElementById('chart')!,[{year:2026,quarter:'Q3',net_effective_rent:0,vacancy_rate:null}]);
  const status=document.querySelector('[data-building-trend-data] [role="status"]');
  expect(status).not.toBeVisible();
  document.getElementById('chart-btn-vac')!.click();
  expect(status).toBeVisible();
  expect(document.getElementById('chart')).not.toBeVisible();
  expect(status).toHaveTextContent('当前指标暂无有效历史数值');
  expect(document.querySelector('[data-building-trend-data] tbody tr')?.textContent).toBe('2026Q30.0—');
  document.getElementById('chart-btn-rent')!.click();
  expect(status).not.toBeVisible();
  expect(document.getElementById('chart')).toBeVisible();
  instance!.dispose();
});
