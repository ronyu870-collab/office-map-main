import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubmarketTrendChart } from '../components/SubmarketTrendChart';
import type { SubmarketTrendPoint } from '../model/submarketMarketTrend';

const api = vi.hoisted(() => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), observe: vi.fn(), disconnect: vi.fn() }));
vi.mock('echarts/core', () => ({ use: vi.fn(), init: vi.fn(() => api) }));
const point = (period: string, rent: number | null, vacancyPct: number | null): SubmarketTrendPoint => ({
  period, year: 2026, quarter: Number(period.at(-1)), rent, vacancyPct,
  rentSamples: rent == null ? 0 : 2, vacancySamples: vacancyPct == null ? 0 : 3, rentArea: 100, vacancyArea: 100,
});
const data = [point('2026Q1', 0, 0), point('2026Q2', null, null)];
let reduced = true;
const add = vi.fn(), remove = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); reduced = true;
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced; }, addEventListener: add, removeEventListener: remove }));
  vi.stubGlobal('ResizeObserver', class { observe = api.observe; disconnect = api.disconnect; });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('submarket trend reading', () => {
  it('shows isolated observations in separate single-axis plots with the same quarter categories', () => {
    render(<SubmarketTrendChart data={[point('2026Q2', null, null), point('2026Q3', 170, 13)]} />);
    expect(screen.getByRole('img', { name: '净有效租金季度趋势图' })).toBeVisible();
    expect(screen.getByRole('img', { name: '空置率季度趋势图' })).toBeVisible();
    const [rent, vacancy] = api.setOption.mock.calls.map(([options]) => options);
    for (const [option, value] of [[rent, 170], [vacancy, 13]]) {
      expect(Array.isArray(option.yAxis)).toBe(false);
      expect(option.xAxis.data).toEqual(['2026Q2', '2026Q3']);
      expect(option.series).toEqual([expect.objectContaining({ data: [null, value], showSymbol: true, connectNulls: false })]);
    }
    expect(vacancy.tooltip.formatter([{ dataIndex: 1 }])).toContain('空置率：13.0%（3 个样本）');
  });

  it('has no chart for a missing metric, rather than an empty scale or a made-up zero', () => {
    render(<SubmarketTrendChart data={[point('2026Q3', 0, null)]} />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getAllByRole('img')[0]).toHaveAccessibleName('净有效租金季度趋势图');
    expect(screen.getByText('暂无已发布的有效季度观测。')).toBeVisible();
  });

  it('exposes focusable quarter values with units and sample counts, preserving real zero and missing values', async () => {
    const user = userEvent.setup();
    render(<SubmarketTrendChart data={data} />);
    await user.tab();
    expect(document.activeElement).toHaveTextContent('查看季度数据');
    // jsdom does not implement native summary keyboard activation; browser regression uses Enter.
    await user.click(screen.getByText('查看季度数据'));
    expect(document.querySelector('details')).toHaveAttribute('open');
    const table = screen.getByRole('table', { name: '季度租金与空置率' });
    expect(table).toBeVisible();
    expect(table).toHaveTextContent('元/㎡/月');
    expect(table).toHaveTextContent('空置率');
    const [, observed, missing] = screen.getAllByRole('row');
    expect(observed).toHaveTextContent('2026Q1');
    expect(observed).toHaveTextContent('0.0');
    expect(observed).toHaveTextContent('2 个样本');
    expect(observed).toHaveTextContent('3 个样本');
    expect(missing).toHaveTextContent('2026Q2');
    expect(missing).toHaveTextContent('—');
    expect(missing).not.toHaveTextContent('0.0');
  });

  it('honors live reduced motion and releases both charts, media listeners and resize observers', () => {
    const { unmount } = render(<SubmarketTrendChart data={data} />);
    for (const [option] of api.setOption.mock.calls) {
      expect(option.animation).toBe(false);
      expect(option.series[0].data).toEqual([0, null]);
    }
    expect(add).toHaveBeenCalledTimes(2);
    reduced = false;
    const [, listener] = add.mock.calls[0];
    listener();
    expect(api.setOption).toHaveBeenLastCalledWith(expect.objectContaining({ animation: true }));
    unmount();
    expect(remove).toHaveBeenCalledWith('change', listener);
    expect(api.disconnect).toHaveBeenCalledTimes(2);
    expect(api.dispose).toHaveBeenCalledTimes(2);
  });

  it('disposes previous chart instances on data change before releasing the final ones', () => {
    const { rerender, unmount } = render(<SubmarketTrendChart data={data} />);
    rerender(<SubmarketTrendChart data={[point('2026Q3', 150, 12)]} />);
    expect(api.dispose).toHaveBeenCalledTimes(2);
    expect(api.observe).toHaveBeenCalledTimes(4);
    unmount();
    expect(api.dispose).toHaveBeenCalledTimes(4);
    expect(api.disconnect).toHaveBeenCalledTimes(4);
  });
});
