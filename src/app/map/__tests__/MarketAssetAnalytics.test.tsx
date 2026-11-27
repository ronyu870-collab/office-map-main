import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MarketAssetAnalytics } from '../components/MarketAssetAnalytics';
import type { ResearchAsset } from '../model/marketAssetAnalytics';

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
