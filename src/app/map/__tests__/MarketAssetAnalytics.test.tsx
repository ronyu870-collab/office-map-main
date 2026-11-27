import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MarketAssetAnalytics } from '../components/MarketAssetAnalytics';
import type { ResearchAsset } from '../model/marketAssetAnalytics';
import { MapReadingContext, type ReadingStore } from '../workspace/continuity';

const { fetchResearch } = vi.hoisted(() => ({ fetchResearch: vi.fn() }));
vi.mock('@/src/services/map/marketAssetResearchClient', () => ({ fetchMarketAssetResearch: fetchResearch }));
vi.mock('@/src/utils/businessReadingAudit', () => ({ observeBusinessReading: vi.fn() }));
vi.mock('../components/MarketAssetScatter', () => ({ MarketAssetScatter: () => <div /> }));
const asset = (id: string, submarket: string, grade: string, rent: number): ResearchAsset => ({
  id, name: id, submarket, grade, metrics: [{ record_year: 2026, record_quarter: 2, is_locked: true, total_area: 1000, net_effective_rent: rent, vacant_area: 200 }],
});
const assets = [asset('CBD办公', 'CBD', 'A', 200), asset('CBD乙级', 'CBD', 'B', 120), asset('上地园区', '上地', 'BP', 80), asset('望京园区', '望京-酒仙桥', 'BP', 100), asset('望京办公', '望京-酒仙桥', 'A', 140)];

beforeEach(() => {
  fetchResearch.mockReset();
  fetchResearch.mockImplementation(async (names: string[], period: number) => ({
    period, assets: assets.filter(a => names.includes(a.submarket)), supplies: [], demand: {}, demandAvailable: true,
  }));
});
describe('benchmark research surfaces', () => {
  it.each([['CBD','office','CBD办公'],['上地','park','上地园区'],['望京-酒仙桥','office','望京办公']])('loads %s only on demand and links the genuine asset ID', async (market, product, id) => {
    const onOpen = vi.fn();
    render(<MarketAssetAnalytics buildings={assets} submarket={market} onOpen={onOpen} />);
    expect(fetchResearch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '市场深度分析与区域比较' }));
    expect((screen.getByLabelText('产品范围') as HTMLSelectElement).value).toBe(product);
    const distribution = await screen.findByRole('region', { name: '租金价格分布' });
    fireEvent.click(within(distribution).getByRole('button', { name: new RegExp(id) }));
    expect(onOpen).toHaveBeenCalledWith(id);
    expect(fetchResearch).toHaveBeenCalledTimes(1);
    expect(fetchResearch).toHaveBeenCalledWith([market], 2026 * 4 + 1, expect.any(AbortSignal));
  });
  it('binds exact standalone labels for every selector and preserves comparison controls on returning to research', async () => {
    const store: ReadingStore = {};
    const open = vi.fn();
    const workspace = (active: boolean) => <MapReadingContext.Provider value={store}>
      <MarketAssetAnalytics buildings={assets} submarket="CBD" identity="research-CBD" active={active} onOpen={open} />
    </MapReadingContext.Provider>;
    const { rerender } = render(workspace(true));
    const select = (name: string) => {
      const control = screen.getByRole('combobox', { name }) as HTMLSelectElement;
      expect(screen.getByLabelText(name, { exact: true })).toBe(control);
      expect(control.id).toBeTruthy();
      expect(control.labels).toHaveLength(1);
      expect(control.labels?.[0].textContent).toBe(name);
      expect(control.labels?.[0].htmlFor).toBe(control.id);
      expect(control.labels?.[0].contains(control)).toBe(false);
      return control;
    };
    fireEvent.click(screen.getByRole('button', { name: '市场深度分析与区域比较' }));
    await screen.findByRole('region', { name: '租金价格分布' });
    expect(select('查询季度').value).toBe(String(2026 * 4 + 1));
    expect(select('产品范围').value).toBe('office');
    fireEvent.click(screen.getByRole('button', { name: '添加比较区域' }));
    expect(select('比较区域 1').value).toBe('');
    expect(fetchResearch).toHaveBeenCalledTimes(1);
    fireEvent.change(select('比较区域 1'), { target: { value: '上地' } });
    await screen.findByRole('table', { name: '子市场同季度比较' });
    expect(fetchResearch).toHaveBeenLastCalledWith(['CBD', '上地'], 2026 * 4 + 1, expect.any(AbortSignal));

    fireEvent.click(screen.getByRole('button', { name: '添加比较区域' }));
    expect(select('比较区域 2').value).toBe('');
    expect(Array.from(select('比较区域 2').options).map(option => option.value)).not.toContain('上地');
    expect(screen.queryByRole('button', { name: '添加比较区域' })).toBeNull();
    expect(fetchResearch).toHaveBeenCalledTimes(2);
    fireEvent.change(select('比较区域 2'), { target: { value: '望京-酒仙桥' } });
    await screen.findByRole('rowheader', { name: '望京-酒仙桥' });
    fireEvent.change(select('比较区域 1'), { target: { value: '金融街' } });
    await screen.findByRole('rowheader', { name: '金融街' });
    expect(fetchResearch).toHaveBeenLastCalledWith(['CBD', '金融街', '望京-酒仙桥'], 2026 * 4 + 1, expect.any(AbortSignal));
    fireEvent.click(screen.getByRole('button', { name: '移除比较区域 1' }));
    expect(select('比较区域 1').value).toBe('望京-酒仙桥');
    expect(screen.queryByRole('combobox', { name: '比较区域 2' })).toBeNull();
    await screen.findByRole('rowheader', { name: '望京-酒仙桥' });

    const reads = fetchResearch.mock.calls.length;
    fireEvent.change(select('产品范围'), { target: { value: 'park' } });
    expect(screen.getByText('当前产品在该季度暂无有效租金观测。')).toBeTruthy();
    expect(fetchResearch).toHaveBeenCalledTimes(reads);
    rerender(workspace(false));
    rerender(workspace(true));
    await screen.findByRole('table', { name: '子市场同季度比较' });
    expect(select('产品范围').value).toBe('park');
    expect(select('比较区域 1').value).toBe('望京-酒仙桥');
    expect(select('查询季度').value).toBe(String(2026 * 4 + 1));
    expect(fetchResearch).toHaveBeenLastCalledWith(['CBD', '望京-酒仙桥'], 2026 * 4 + 1, expect.any(AbortSignal));
  });

  it('compares regions without mixing products or quarters and leaves missing quarters unavailable', async () => {
    render(<MarketAssetAnalytics buildings={assets} submarket="CBD" onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '市场深度分析与区域比较' }));
    await screen.findByRole('region', { name: '租金价格分布' });
    fireEvent.click(screen.getByRole('button', { name: '添加比较区域' }));
    fireEvent.change(screen.getByLabelText('比较区域 1'), { target: { value: '上地' } });
    const matrix = await screen.findByRole('table', { name: '子市场同季度比较' });
    expect(within(matrix).getByRole('rowheader', { name: '上地' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('查询季度'), { target: { value: String(2026 * 4) } });
    await waitFor(() => expect(screen.getByText('当前产品在该季度暂无有效租金观测。')).toBeTruthy());
    expect(fetchResearch).toHaveBeenLastCalledWith(['CBD', '上地'], 2026 * 4, expect.any(AbortSignal));
  });
});

describe('personalized analysis availability', () => {
  it.each([['四季青', 'BP', '园区项目与供应参照'], ['玉渊潭', 'B', '具体资产与选址条件']])(
    '%s displays one observed building rather than a regional distribution', async (market, grade, title) => {
      const records = [asset('项目甲', market, grade, 88)];
      fetchResearch.mockImplementation(async (_names: string[], period: number) => ({
        period, assets: records, supplies: [], demand: {}, demandAvailable: true,
      }));
      const onOpen = vi.fn();
      render(<MarketAssetAnalytics buildings={records} submarket={market} onOpen={onOpen} />);
      fireEvent.click(screen.getByRole('button', { name: title }));
      const distribution = await screen.findByRole('region', { name: '租金价格分布' });
      expect(within(distribution).getByText('单项目租金观测')).toBeTruthy();
      expect(within(distribution).queryByText('楼宇中位数')).toBeNull();
      expect(within(distribution).queryByText('面积加权平均')).toBeNull();
      fireEvent.click(within(distribution).getByRole('button', { name: /项目甲/ }));
      expect(onOpen).toHaveBeenCalledWith('项目甲');
      const select = screen.getByLabelText('产品范围') as HTMLSelectElement;
      if (grade === 'BP') expect(Array.from(select.options, option => option.value)).toEqual(['park']);
      else expect(Array.from(select.options, option => option.value)).not.toContain('park');
      expect(screen.queryByRole('region', { name: '未来供应分析' })).toBeNull();
      expect(screen.queryByRole('region', { name: '租赁需求与成交' })).toBeNull();
    },
  );
});

describe('product scope during personalized market comparisons', () => {
  it('exposes a second product only when a compared market supports it, then restores the primary scope', async () => {
    const records = [asset('园区甲', '四季青', 'BP', 88), asset('办公甲', 'CBD', 'A', 180)];
    fetchResearch.mockImplementation(async (names: string[], period: number) => ({
      period, assets: records.filter(row => names.includes(row.submarket)), supplies: [], demand: {}, demandAvailable: true,
    }));
    render(<MarketAssetAnalytics buildings={records} submarket="四季青" onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '园区项目与供应参照' }));
    await screen.findByRole('region', { name: '租金价格分布' });
    const product = screen.getByRole('combobox', { name: '产品范围' }) as HTMLSelectElement;
    const values = () => Array.from(product.options, item => item.value);
    expect(values()).toEqual(['park']);
    fireEvent.click(screen.getByRole('button', { name: '添加比较区域' }));
    expect(values()).toEqual(['park']);
    fireEvent.change(screen.getByRole('combobox', { name: '比较区域 1' }), { target: { value: 'CBD' } });
    await screen.findByRole('table', { name: '子市场同季度比较' });
    expect(values()).toContain('office');
    fireEvent.change(product, { target: { value: 'office' } });
    expect(product.value).toBe('office');
    fireEvent.click(screen.getByRole('button', { name: '移除比较区域 1' }));
    expect(values()).toEqual(['park']);
    expect(product.value).toBe('park');
  });
});
