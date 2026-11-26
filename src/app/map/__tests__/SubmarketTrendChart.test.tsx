import * as React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketChartCanvas } from '../components/MarketChartCanvas';
import { MarketGradeComparison, SubmarketTrendChart } from '../components/SubmarketTrendChart';
import { buildTrendTimeline, designMarketTrends } from '../model/marketTrendPresentation';
import type { SubmarketTrendPoint } from '../model/submarketMarketTrend';

const api = vi.hoisted(() => ({
  init: vi.fn(), setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), dispatchAction: vi.fn(),
  observe: vi.fn(), disconnectObserver: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
}));
vi.mock('echarts/core', () => ({
  use: vi.fn(), init: api.init, connect: api.connect, disconnect: api.disconnect,
}));
const point = (period: string, rent: number | null, vacancyPct: number | null = null, extra: Partial<SubmarketTrendPoint> = {}): SubmarketTrendPoint => ({
  period, year: Number(period.slice(0, 4)), quarter: Number(period.at(-1)), rent, vacancyPct,
  rentSamples: rent == null ? 0 : 2, vacancySamples: vacancyPct == null ? 0 : 3,
  rentArea: rent == null ? 0 : 100, vacancyArea: vacancyPct == null ? 0 : 100, ...extra,
});
const continuous = [point('2026Q1', 170, 0), point('2026Q2', 172, 12), point('2026Q3', 150, 10)];
const history = [point('2025Q2', 180, 15), ...continuous];
const plot = (data: SubmarketTrendPoint[], range: 'default' | 'history' = 'default') =>
  designMarketTrends(buildTrendTimeline(data), 'research', range)[0];

let width: number;
let height: number;
let remeasure: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  api.init.mockImplementation(() => ({ ...api }));
  width = 314;
  height = 180;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
  vi.stubGlobal('ResizeObserver', class {
    constructor(measure: () => void) { remeasure = measure; }
    observe = api.observe;
    disconnect = api.disconnectObserver;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('submarket trend reading', () => {
  it('shows the last actual quarter and its zero value without rendering a one-point trend', () => {
    render(<SubmarketTrendChart data={[point('2026Q1', null, 0), point('2026Q2', null, null)]} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const vacancy = screen.getByRole('heading', { name: '空置率' }).closest('figure')!;
    expect(within(vacancy).getByText('2026Q1')).toBeVisible();
    expect(within(vacancy).getByText('0.0%')).toBeVisible();
    expect(api.init).not.toHaveBeenCalled();
  });

  it('uses an explicit two-period comparison across a gap and preserves all quarters in the details', async () => {
    const user = userEvent.setup();
    render(<SubmarketTrendChart data={[point('2026Q1', 0, 0), point('2026Q3', 150)]} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('2026Q1 至 2026Q3变化 +150.0 元/㎡/月')).toBeVisible();
    expect(screen.queryByText(/环比/)).not.toBeInTheDocument();
    await user.tab();
    expect(document.activeElement).toHaveTextContent('查看季度数据');
    await user.click(screen.getByText('查看季度数据'));
    const table = screen.getByRole('table', { name: '季度租金与空置率' });
    const [, observed, missing] = within(table).getAllByRole('row');
    expect(observed).toHaveTextContent('2026Q1');
    expect(observed).toHaveTextContent('0.0');
    expect(observed).toHaveTextContent('3 个样本');
    expect(observed).toHaveTextContent('100 ㎡');
    expect(missing).toHaveTextContent('2026Q2');
    expect(missing).toHaveTextContent('未收录');
    expect(missing).not.toHaveTextContent('0.0');
  });

  it('explains the recent interval and reveals early observations when complete history is selected', async () => {
    const user = userEvent.setup();
    function Reading() {
      const [range, setRange] = React.useState<'default' | 'history'>('default');
      return <SubmarketTrendChart data={history} range={range} onRangeChange={setRange} />;
    }
    render(<Reading />);
    expect(screen.getAllByText('2026Q1 至 2026Q3 · 另有早期观测')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: '查看完整历史' }));
    expect(screen.getAllByText('2025Q2 至 2026Q3 · 离散观测')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: '返回默认区间' }));
    expect(screen.getAllByText('2026Q1 至 2026Q3 · 另有早期观测')).toHaveLength(2);
  });

  it('separates the observed market move from the same-sample move', () => {
    const data = [point('2026Q1', 170, 0), point('2026Q2', 190, 14, {
      sampleChanged: { rent: true, vacancy: false },
      sameSampleQoq: { rent: { samples: 2, rentPct: -3, vacancyPp: null }, vacancy: { samples: 0, rentPct: null, vacancyPp: null } },
    })];
    render(<SubmarketTrendChart data={data} />);
    expect(screen.getByText(/市场样本环比 \+20.0 元\/㎡\/月/)).toBeVisible();
    expect(screen.getByText('同样本环比 −3.0%（2 个共同样本）')).toBeVisible();
    expect(screen.getByText('样本构成或覆盖有变')).toBeVisible();
  });

  it('provides accessible A/B values, sample counts and dates only for comparable quarters', async () => {
    const user = userEvent.setup();
    render(<MarketGradeComparison series={{ a: continuous, b: [point('2026Q1', 140, 0), point('2026Q2', 142, null, { rentSamples: 1 })] }} />);
    await user.click(screen.getByText('比较甲级与乙级'));
    const table = screen.getByRole('table', { name: '同季度甲乙级比较' });
    expect(table).toHaveTextContent('甲级较乙级 +30.0 元/㎡/月');
    expect(table).toHaveTextContent('甲级较乙级 0.0 百分点');
    expect(table).not.toHaveTextContent('2026Q2');
  });

  it('does not render any axes or table for completely unavailable observations', () => {
    render(<SubmarketTrendChart data={[point('2026Q1', null)]} />);
    expect(screen.getByText('当前等级暂无已发布的有效季度观测。')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('查看季度数据')).not.toBeInTheDocument();
  });
});

describe('market ECharts runtime', () => {
  it('retains nulls, renders truthful shapes and keeps a confined quarterly tooltip', () => {
    const { rerender } = render(<MarketChartCanvas presentation={plot(continuous)} label="租金走势" active />);
    const [line] = api.setOption.mock.calls.at(-1)!;
    expect(line.animation).toBe(false);
    expect(line.series[0]).toMatchObject({ type: 'line', smooth: false, connectNulls: false, data: [170, 172, { value: 150 }] });
    rerender(<MarketChartCanvas presentation={plot(history, 'history')} label="租金走势" active />);
    const [scatter] = api.setOption.mock.calls.at(-1)!;
    expect(scatter.series[0]).toMatchObject({ type: 'scatter', data: [180, null, null, 170, 172, { value: 150 }] });
    expect(scatter.xAxis.data).toEqual(['2025Q2', '2025Q3', '2025Q4', '2026Q1', '2026Q2', '2026Q3']);
    expect(scatter.tooltip).toMatchObject({ confine: true, triggerOn: 'mousemove|click' });
    expect(scatter.tooltip.formatter([{ dataIndex: 1 }])).toContain('未收录');
    expect(scatter.tooltip.formatter([{ dataIndex: 5 }])).toContain('净有效租金 150.0 元/㎡/月');
    expect(scatter.tooltip.formatter([{ dataIndex: 5 }])).toContain('2 个有效样本');
    expect(api.init).toHaveBeenCalledTimes(1);
    expect(api.dispose).not.toHaveBeenCalled();
  });

  it('initializes after visibility, recalculates width, clears stale tips and releases resources on unmount', () => {
    width = 0;
    const series = plot(history, 'history');
    const { rerender, unmount } = render(<MarketChartCanvas presentation={series} label="租金走势" active group="test-group" />);
    expect(api.init).not.toHaveBeenCalled();
    width = 310;
    act(() => remeasure());
    expect(api.init).toHaveBeenCalledTimes(1);
    expect(api.connect).toHaveBeenCalledWith('test-group');
    const [narrow] = api.setOption.mock.calls.at(-1)!;
    width = 630;
    act(() => {
      remeasure();
      expect(api.resize).toHaveBeenCalledWith({ width: 630, height });
    });
    expect(api.dispatchAction).toHaveBeenCalledWith({ type: 'hideTip' });
    const [wide] = api.setOption.mock.calls.at(-1)!;
    expect(wide.yAxis.splitNumber).toBeGreaterThan(narrow.yAxis.splitNumber);
    rerender(<MarketChartCanvas presentation={series} label="租金走势" active={false} group="test-group" />);
    expect(api.disconnect).toHaveBeenCalledWith('test-group');
    expect(api.dispose).not.toHaveBeenCalled();
    rerender(<MarketChartCanvas presentation={series} label="租金走势" active group="test-group" />);
    expect(api.init).toHaveBeenCalledTimes(1);
    unmount();
    expect(api.dispose).toHaveBeenCalledTimes(1);
    expect(api.disconnectObserver).toHaveBeenCalledTimes(1);
    act(() => remeasure());
    expect(api.init).toHaveBeenCalledTimes(1);
  });
});
