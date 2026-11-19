import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubmarketDetailPayload } from '@/src/services/mapDataClient';
import type { SubmarketSummary } from '../model/submarketOverview';
import { emptySubmarketProfile } from '../model/submarketProfile';
import { SubmarketDetailPanel } from '../components/SubmarketDetailPanel';

const api = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@/src/services/mapDataClient', () => ({
  fetchSubmarketDetailPayload: api.read,
  saveSubmarketProfile: api.save,
}));

vi.mock('next/dynamic', () => ({
  default: () => function MockTrendChart() {
    return <div data-testid="trend-chart" />;
  },
}));

const summary: SubmarketSummary = {
  name: 'CBD',
  officeCount: 2,
  gradeACount: 1,
  gradeBCount: 1,
  parkCount: 1,
  rent: 186.75,
  vacancyPct: 12.5,
  rentSampleCount: 2,
  vacancySampleCount: 2,
  rentSampleArea: 1000,
  vacancySampleArea: 1000,
};

const profile = {
  ...emptySubmarketProfile(),
  submarket: 'CBD',
  updatedAt: '2026-11-18T00:00:00Z',
  updatedBy: null,
  headline: '金融总部与国际商务服务集聚区',
  overview: '区域具备集中办公需求。',
  industries: '金融服务及专业服务',
  transport: '轨道交通与干线道路',
  demographics: [{
    label: '行政区常住人口', value: '100', unit: '万人', scope: '朝阳区',
    asOf: '2025年', sourceUrl: 'https://example.org/demography',
  }],
  policies: [{
    title: '区域相关政策', issuer: '测试部门', summary: '政策主要内容',
    applicability: '以原文为准', asOf: '2025年',
    sourceUrl: 'https://example.org/policy',
  }],
  insights: [{
    title: '客户适配需核查', body: '仅供业务复核', author: '内部研究',
    asOf: '2026年11月',
  }],
};

const emptyTrend = { all: [], a: [], b: [] };
const payload: SubmarketDetailPayload = {
  submarket: 'CBD',
  stockCount: 2,
  profileAvailable: true,
  profile,
  trends: emptyTrend,
  quarterMethod: 'same quarter',
  source: 'building_metrics',
};

const props = {
  name: 'CBD',
  summary,
  buildings: [{
    id: 'office-a', name: '测试楼宇', submarket: 'CBD', grade: 'A',
    location_lng: 116.45, location_lat: 39.92,
    metrics: [{ record_year: 2026, record_quarter: 3, total_area: 1000 }],
  }],
  futureCount: 3,
  canEdit: true,
  onClose: vi.fn(),
  onShowAll: vi.fn(),
  onOpenBuilding: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  api.read.mockResolvedValue(payload);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('submarket research modal', () => {
  it('opens a centered accessible modal, preserves existing market metrics and separates editorial chapters', async () => {
    const { unmount } = render(<SubmarketDetailPanel {...props} />);
    const dialog = screen.getByRole('dialog', { name: 'CBD' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.className).toContain('max-w-[1400px]');
    expect(dialog.className).not.toContain('sm:w-[420px]');
    await waitFor(() => expect(screen.getByText('金融总部与国际商务服务集聚区')).toBeInTheDocument());
    expect(screen.getByText('186.8')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();
    expect(screen.getByText('甲级 1 · 乙级 1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '交通与通达性' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '人口与就业背景' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '政策与规划' })).toBeInTheDocument();
    expect(screen.getAllByText(/AI公开资料研究（待业务团队复核）/).length).toBeGreaterThan(0);
    expect(screen.getByText('暂无足够的季度行情数据')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /查看政策原文/ })).toHaveAttribute('target', '_blank');
    expect(api.read).toHaveBeenCalledWith('CBD');
    unmount();
  });


  it('uses the latest quarter containing real observations, not the trailing empty axis cell', async () => {
    const makePoint = (period: string, rent: number | null, vacancyPct: number | null) => ({
      period, year: 2026, quarter: Number(period.slice(-1)), rent, vacancyPct,
      rentSamples: rent == null ? 0 : 1, vacancySamples: vacancyPct == null ? 0 : 1,
      rentArea: rent == null ? 0 : 100, vacancyArea: vacancyPct == null ? 0 : 100,
    });
    const series = [
      makePoint('2026Q1', 180, 10),
      makePoint('2026Q2', 170, 12),
      makePoint('2026Q3', null, null),
    ];
    api.read.mockResolvedValueOnce({ ...payload, trends: { all: series, a: [], b: [] } });
    render(<SubmarketDetailPanel {...props} />);
    const digest = within(screen.getByRole('complementary', { name: '季度行情解读' }));
    await waitFor(() => expect(digest.getByText('2026Q2')).toBeInTheDocument());
    expect(digest.getByText('-10.0 元/㎡/月')).toBeInTheDocument();
    expect(digest.getByText('+2.0 个百分点')).toBeInTheDocument();
    expect(digest.getByText(/基于与 2026Q1 相邻的季度/)).toBeInTheDocument();
  });

  it('supports Escape, explicit close and backdrop dismissal without losing the map click handlers', async () => {
    const onClose = vi.fn();
    const { unmount } = render(<SubmarketDetailPanel {...props} onClose={onClose} />);
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(document.querySelector('[data-map-submarket-backdrop]')!);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '关闭子市场介绍' }));
    expect(onClose).toHaveBeenCalledTimes(3);
    unmount();
  });

  it('suspends but does not unmount content when entering a building, then restores the same modal', async () => {
    const onOpenBuilding = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<SubmarketDetailPanel {...props} onClose={onClose} onOpenBuilding={onOpenBuilding} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /测试楼宇/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /测试楼宇/ }));
    expect(onOpenBuilding).toHaveBeenCalledWith('office-a');
    rerender(<SubmarketDetailPanel {...props} onClose={onClose} onOpenBuilding={onOpenBuilding} suspended />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('[data-map-submarket-backdrop]')).toHaveClass('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    rerender(<SubmarketDetailPanel {...props} onClose={onClose} onOpenBuilding={onOpenBuilding} />);
    expect(screen.getByRole('dialog', { name: 'CBD' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /在地图查看本区域全部项目/ }));
    expect(props.onShowAll).toHaveBeenCalledOnce();
  });

  it('retains the unsaved-edit confirmation when Escape closes the full-screen dialog', async () => {
    const onClose = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SubmarketDetailPanel {...props} onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /维护资料/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /维护资料/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(confirm).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
