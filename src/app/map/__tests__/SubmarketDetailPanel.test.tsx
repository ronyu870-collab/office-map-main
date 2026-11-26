import * as React from 'react';
import { MapReadingContext } from '../workspace/continuity';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubmarketDetailPayload } from '@/src/services/mapDataClient';
import { aggregateMarket } from '../model/marketStatistics';
import type { SubmarketSummary } from '../model/submarketOverview';
import { submarketIntelligenceSchema } from '../model/submarketIntelligence';
import shangdiEdition from '../../../../data/submarket-research/2026-11-27/shangdi.json';
import { emptySubmarketProfile } from '../model/submarketProfile';
import { SubmarketDetailPanel } from '../components/SubmarketDetailPanel';
import { WorkspacePanelContext } from '../components/WorkspacePanelHeader';

const api = vi.hoisted(() => ({
  audit:vi.fn(),read: vi.fn(),
  save: vi.fn(), history: vi.fn(),
}));

vi.mock('@/src/utils/audit',()=>({logAction:api.audit}));
vi.mock('@/src/services/mapDataClient', () => ({
  fetchSubmarketDetailPayload: api.read,
  saveSubmarketProfile: api.save,
  fetchSubmarketResearchHistory: api.history,
}));

vi.mock('next/dynamic', () => ({
  default: () => function MockTrendChart() {
    return <div data-testid="trend-chart" />;
  },
}));

const summary: SubmarketSummary = {
  ...aggregateMarket([]),
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
  profilePublished: true,
  trendError: false,
  profile,
  draftProfile: profile,
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
  futureState: 'ready' as const,
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

describe('submarket research workspace', () => {
  it('adds a filtered stock fact and opens the representative projects tab from quick reading', async () => {
    function CompactWorkspace({ market }: { market: SubmarketSummary }) {
      const [mode, setMode] = React.useState<'compact' | 'reading' | 'full'>('compact');
      return <WorkspacePanelContext.Provider value={{ compact: true, mode, setMode }}>
        <SubmarketDetailPanel {...props} summary={market} />
      </WorkspacePanelContext.Provider>;
    }
    const { rerender } = render(<CompactWorkspace market={{ ...aggregateMarket([]), name: 'CBD' }} />);
    await screen.findByText(profile.headline);
    const quick = within(screen.getByRole('region', { name: '市场核心指标' }));
    expect(quick.queryByText(/存量构成/)).not.toBeInTheDocument();
    rerender(<CompactWorkspace market={summary} />);
    const fact = quick.getByText('存量构成：甲级 1 个，乙级 1 个。');
    expect(fact.closest('[data-workspace-summary]')).toBeNull();
    expect(screen.queryByRole('button', { name: /测试楼宇/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '查看全部项目' })).toHaveLength(1);

    fireEvent.click(quick.getByRole('button', { name: '查看代表项目' }));
    const tab = screen.getByRole('tab', { name: '代表项目' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveFocus();
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: /测试楼宇/ })).toBeInTheDocument();
    expect(props.onShowAll).not.toHaveBeenCalled();
  });

  it('keeps the region profile tab visible while loading and retries an unavailable profile in place', async () => {
    api.read.mockResolvedValueOnce({ ...payload, profileAvailable: false, profilePublished: false });
    let finishRetry!: (value: SubmarketDetailPayload) => void;
    api.read.mockReturnValueOnce(new Promise<SubmarketDetailPayload>(resolve => { finishRetry = resolve; }));
    render(<SubmarketDetailPanel {...props} />);
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['市场概览', '行情趋势', '区域画像', '代表项目']);
    const tab = screen.getByRole('tab', { name: '区域画像' });
    fireEvent.click(tab);
    const active = within(screen.getByRole('tabpanel'));
    expect(active.getByRole('status')).toHaveTextContent('正在读取区域画像');
    expect(await active.findByRole('button', { name: '重试区域画像' })).toBeInTheDocument();
    expect(active.getByRole('status')).toHaveTextContent('区域画像暂不可用');
    fireEvent.click(active.getByRole('button', { name: '重试区域画像' }));
    expect(active.getByRole('status')).toHaveTextContent('正在读取区域画像');
    await act(async () => finishRetry(payload));
    expect(active.getByText(profile.overview)).toBeInTheDocument();
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(api.read).toHaveBeenCalledTimes(2);
  });

  it('shows zero future projects only after a successful read and hides unavailable area', async () => {
    const { rerender } = render(<SubmarketDetailPanel {...props} futureState="loading" futureCount={0} />);
    await screen.findByText(profile.headline);
    const composition = () => within(screen.getByRole('region', { name: '楼宇构成' }));
    const supply = '未来供应（另计）';
    expect(composition().queryByText(supply)).not.toBeInTheDocument();

    rerender(<SubmarketDetailPanel {...props} futureState="error" futureArea={1000} futureAreaSamples={1} />);
    expect(composition().getByText(supply).parentElement).toHaveTextContent('暂不可用');
    expect(composition().queryByText('未来供应已知面积')).not.toBeInTheDocument();

    rerender(<SubmarketDetailPanel {...props} futureState="ready" futureCount={0} />);
    expect(composition().getByText(supply).parentElement).toHaveTextContent('0 个');

    rerender(<SubmarketDetailPanel {...props} futureState="disabled" />);
    expect(composition().queryByText(supply)).not.toBeInTheDocument();
  });

  it('keeps the all-grade overview digest independent of the selected trend grade without rendering a chart', async () => {
    const point = { period: '2026Q3', year: 2026, quarter: 3, rent: 180, vacancyPct: 10, rentSamples: 1, vacancySamples: 1, rentArea: 100, vacancyArea: 100 };
    api.read.mockResolvedValueOnce({ ...payload, trends: { all: [point], a: [point], b: [] } });
    render(<SubmarketDetailPanel {...props} />);
    await screen.findByText(profile.headline);
    const overviewDigest = () => within(screen.getByRole('region', { name: '季度变化' }));
    expect(overviewDigest().getByText('净有效租金', { exact: false })).toHaveTextContent('2026Q3');
    expect(screen.queryByTestId('trend-chart')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '行情趋势' }));
    expect(screen.getByTestId('trend-chart')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '乙级' }));
    expect(screen.getByRole('button', { name: '乙级' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: '季度行情' })).toHaveTextContent('当前等级暂无已发布的有效季度观测');
    expect(screen.queryByTestId('trend-chart')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '市场概览' }));
    expect(overviewDigest().getByText('净有效租金', { exact: false })).toHaveTextContent('2026Q3');
    expect(screen.queryByTestId('trend-chart')).not.toBeInTheDocument();
  });

  it('combines overlapping research notes in full reading without hiding the selected grade digest', async () => {
    const point = { period: '2026Q3', year: 2026, quarter: 3, rent: 180, vacancyPct: 10, rentSamples: 1, vacancySamples: 1, rentArea: 100, vacancyArea: 100 };
    api.read.mockResolvedValueOnce({ ...payload, trends: { all: [point], a: [point], b: [] } });
    render(<WorkspacePanelContext.Provider value={{ compact: false, mode: 'full', setMode: vi.fn() }}>
      <SubmarketDetailPanel {...props} />
    </WorkspacePanelContext.Provider>);
    expect(await screen.findByTestId('trend-chart')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '季度变化' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '最新季度变化' })).not.toBeInTheDocument();
    expect(screen.getByText('数据口径与来源').closest('details')).toHaveTextContent('历史按当前楼宇归属及等级统计');

    fireEvent.click(screen.getByRole('button', { name: '甲级' }));
    expect(screen.getByRole('region', { name: '最新季度变化' })).toHaveTextContent('2026Q3');
    expect(screen.getByRole('region', { name: '季度行情' })).toHaveTextContent('完整授权子市场 · 甲级');
    expect(screen.getAllByText('数据口径与来源')).toHaveLength(1);
  });

  it('falls back to building composition when a published profile has only introduction copy', async () => {
    api.read.mockResolvedValueOnce({...payload,profile:{...profile,industries:'',transport:''}});
    render(<SubmarketDetailPanel {...props} />);
    await screen.findByText(profile.headline);
    expect(within(screen.getByRole('region', { name: '楼宇构成' })).getByText('甲级写字楼').parentElement).toHaveTextContent('1 个');
    expect(screen.queryByRole('region',{name:'区域特点'})).not.toBeInTheDocument();
    expect(screen.getByRole('tab',{name:'区域画像'})).toBeInTheDocument();
  });

  it('opens a nonmodal workspace with top project action and preserves market metrics and editorial chapters', async () => {
    const { unmount } = render(<SubmarketDetailPanel {...props} />);
    const dialog = screen.getByRole('region', { name: 'CBD' });
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(screen.getByRole('button', { name: '查看全部项目' }).closest('[data-map-submarket-panel]')).toBe(dialog);
    expect(document.querySelector('[data-map-submarket-backdrop]')).toBeNull();
    await waitFor(() => expect(screen.getByText('金融总部与国际商务服务集聚区')).toBeInTheDocument());
    expect(screen.getByText('186.8')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();
    const composition = within(screen.getByRole('region', { name: '楼宇构成' }));
    expect(composition.getByText('甲级写字楼').parentElement).toHaveTextContent('1 个');
    expect(composition.getByText('乙级写字楼').parentElement).toHaveTextContent('1 个');
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByText(/AI公开资料研究|研究草案|待业务团队复核/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '区域画像' }));
    expect(screen.getByRole('heading', { name: '交通与配套' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '人口与就业参考' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '政策与规划' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /政策原文/ })).toHaveAttribute('target', '_blank');
    expect(api.read).toHaveBeenCalledWith('CBD', expect.any(AbortSignal));
    unmount();
  });


  it('uses the latest quarter containing real observations, not the trailing empty axis cell', async () => {
    const makePoint = (period: string, rent: number | null, vacancyPct: number | null) => ({
      period, year: 2026, quarter: Number(period.slice(-1)), rent, vacancyPct,
      rentSamples: rent == null ? 0 : 3, vacancySamples: vacancyPct == null ? 0 : 3,
      rentArea: rent == null ? 0 : 100, vacancyArea: vacancyPct == null ? 0 : 100,
    });
    const series = [
      makePoint('2026Q1', 180, 10),
      makePoint('2026Q2', 170, 12),
      makePoint('2026Q3', null, null),
    ];
    api.read.mockResolvedValueOnce({ ...payload, trends: { all: series, a: [], b: [] } });
    render(<SubmarketDetailPanel {...props} />);
    fireEvent.click(screen.getByRole('tab', { name: '行情趋势' }));
    const digest = within(await screen.findByRole('region', { name: '最新季度变化' }));
    const rent = digest.getByText('净有效租金', { exact: false }).parentElement;
    const vacancy = digest.getByText('空置率', { exact: false }).parentElement;
    expect(rent).toHaveTextContent('2026Q2');
    expect(rent).toHaveTextContent(/环比 −10\.0 元\/㎡\/月/);
    expect(vacancy).toHaveTextContent('2026Q2');
    expect(vacancy).toHaveTextContent(/环比 \+2\.0 百分点/);
    expect(digest.queryByText('2026Q3')).not.toBeInTheDocument();
  });


  it('distinguishes temporarily unavailable trend data from genuine missing observations', async () => {
    api.read.mockResolvedValueOnce({ ...payload, trendError: true, trends: emptyTrend });
    render(<SubmarketDetailPanel {...props} />);
    fireEvent.click(screen.getByRole('tab', { name: '行情趋势' }));
    const trend = within(screen.getByRole('region', { name: '季度行情' }));
    await waitFor(() => expect(trend.getByRole('status')).toHaveTextContent('历史行情暂不可用'));
    expect(trend.queryByText(/暂无已发布的有效季度观测/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('trend-chart')).not.toBeInTheDocument();
    fireEvent.click(trend.getByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(trend.getByText(/暂无已发布的有效季度观测/)).toBeInTheDocument());
    expect(trend.queryByText(/历史行情暂不可用/)).not.toBeInTheDocument();
    expect(api.read).toHaveBeenCalledTimes(2);
  });

  it('supports explicit close and Escape while allowing map interactions', async () => {
    const onClose = vi.fn();
    const { unmount } = render(<SubmarketDetailPanel {...props} onClose={onClose} />);
    fireEvent.pointerDown(screen.getByRole('region', { name: 'CBD' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '关闭子市场介绍' }));
    expect(onClose).toHaveBeenCalledTimes(2);
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
    expect(screen.queryByRole('region', { name: 'CBD' })).not.toBeInTheDocument();
    expect(document.querySelector('.map-submarket-workspace')).toHaveClass('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    rerender(<SubmarketDetailPanel {...props} onClose={onClose} onOpenBuilding={onOpenBuilding} />);
    expect(screen.getByRole('region', { name: 'CBD' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '代表项目' }));
    fireEvent.click(screen.getByRole('button', { name: '查看全部项目' }));
    expect(props.onShowAll).toHaveBeenCalledOnce();
  });


  it('hides all unreviewed research copy in customer mode but preserves admin editing', async () => {
    api.read.mockResolvedValueOnce({
      ...payload,
      profilePublished: false,
      profile: { ...emptySubmarketProfile(), submarket: 'CBD', updatedAt: null, updatedBy: null },
      draftProfile: { ...profile, headline: '客户研究（研究草案）',
        insights: [{ title: 'AI公开资料研究（待业务团队复核）',
          body: '只供内部讨论', author: '内部研究', asOf: '2026年' }] },
    });
    render(<SubmarketDetailPanel {...props} />);
    const edit = await screen.findByRole('button', { name: '维护资料' });
    expect(screen.getByText('CBD办公市场概览')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByText('186.8')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '区域画像' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('暂无已发布的区域画像。');
    expect(screen.queryByText(/研究草案|待业务团队复核|只供内部讨论/)).not.toBeInTheDocument();
    fireEvent.click(edit);
    expect(screen.getByDisplayValue('客户研究（研究草案）')).toBeInTheDocument();
  });

  it('discards a late same-name read from an older authorization scope and resets the editor on role loss', async () => {
    let finishOldRead!: (value: SubmarketDetailPayload) => void;
    const oldRead = new Promise<SubmarketDetailPayload>(resolve => { finishOldRead = resolve; });
    api.read.mockReturnValueOnce(oldRead);
    const view = render(<SubmarketDetailPanel {...props} researchScopeKey="old-session" />);
    const oldSignal = api.read.mock.calls[0][1] as AbortSignal;
    expect(oldSignal.aborted).toBe(false);

    view.rerender(<SubmarketDetailPanel {...props} researchScopeKey="new-session" />);
    expect(oldSignal.aborted).toBe(true);
    fireEvent.click(await screen.findByRole('button', { name: '维护资料' }));
    fireEvent.change(screen.getByLabelText('一句话定位'), { target: { value: '旧角色未保存资料' } });

    api.read.mockResolvedValueOnce({ ...payload, draftProfile: undefined });
    view.rerender(<SubmarketDetailPanel {...props} researchScopeKey="new-session" canEdit={false} />);
    await screen.findByText(profile.headline);
    await act(async () => finishOldRead({ ...payload, profile: { ...profile, headline: '旧授权区域资料' } }));
    expect(screen.queryByText('旧授权区域资料')).not.toBeInTheDocument();
    expect(screen.getByText(profile.headline)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('旧角色未保存资料')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '维护资料' })).not.toBeInTheDocument();
    expect(api.read).toHaveBeenCalledTimes(3);
  });

  it('saves and publishes clean submarket copy without a separate approval step', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    api.save.mockResolvedValue({ profile, profilePublished: true });
    render(<SubmarketDetailPanel {...props} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '维护资料' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '维护资料' }));
    expect(screen.queryByRole('button', { name: '核验并发布' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存并展示' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith('CBD', expect.objectContaining({ headline: profile.headline }), true, profile.updatedAt));
    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('tab', { name: '区域画像' })).toBeInTheDocument());
  });

  it('shows a park edition with citations and opens a curated park in the normal map path', async () => {
    const research = submarketIntelligenceSchema.parse(shangdiEdition);
    const parkBuilding = { id: research.projects[0].buildingId, name: '软件园实测项目', grade: 'BP', submarket: '上地' };
    const onOpenBuilding = vi.fn();
    api.read.mockResolvedValue({ ...payload, submarket: '上地', stockCount: 0,
      profile: { ...profile, submarket: '上地', research, headline: research.positioning } });
    render(<SubmarketDetailPanel {...props} name="上地" canEdit={false} buildings={[parkBuilding]} onOpenBuilding={onOpenBuilding}
      summary={{ ...aggregateMarket([parkBuilding], 'filtered_market', true), name: '上地' }} />);
    await screen.findByText(research.positioning);
    expect(screen.getByText('产业园项目')).toBeInTheDocument();
    expect(screen.queryByText('甲乙级项目')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: parkBuilding.name }));
    expect(onOpenBuilding).toHaveBeenCalledWith(parkBuilding.id);
    fireEvent.click(screen.getByRole('tab', { name: '区域研究' }));
    expect(screen.getByText('18号线', { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByText('来源与口径（2）'));
    expect(screen.getByText(research.sources[1].basis)).toBeInTheDocument();
  });

  it('loads an earlier structured edition into the form, then publishes using the current version token', async () => {
    const research = submarketIntelligenceSchema.parse(shangdiEdition);
    const earlier = { ...research, positioning: '软件园历史市场定位' };
    const current = { ...profile, submarket: '上地', headline: research.positioning, research };
    api.read.mockResolvedValue({ ...payload, submarket: '上地', profile: current, draftProfile: current });
    api.history.mockResolvedValue({ versions: [{ id: 'version-1', savedAt: '2026-11-20T00:00:00Z', wasPublished: true, research: earlier }], nextOffset: null });
    api.save.mockResolvedValue({ profile: { ...current, research: earlier }, profilePublished: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SubmarketDetailPanel {...props} name="上地" />);
    fireEvent.click(await screen.findByRole('button', { name: '维护资料' }));
    fireEvent.click(screen.getByRole('button', { name: '查看历史版本' }));
    fireEvent.click(await screen.findByRole('button', { name: '载入版本' }));
    expect(screen.getByLabelText('市场定位', { exact: true })).toHaveValue(earlier.positioning);
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存并展示' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith('上地', expect.objectContaining({ research: earlier }), true, current.updatedAt));
    expect(await screen.findByText(earlier.positioning)).toBeInTheDocument();
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

 it('preserves editorial input focus, caret and IME while the workspace summary updates', async () => {
   const { rerender } = render(<SubmarketDetailPanel {...props} />);
   await waitFor(() => expect(screen.getByRole('button', { name: '维护资料' })).toBeInTheDocument());
   fireEvent.click(screen.getByRole('button', { name: '维护资料' }));
   const input = screen.getByDisplayValue(profile.headline) as HTMLInputElement;
   const user = userEvent.setup();
   await user.click(input);
   input.setSelectionRange(2, 2);
   await user.keyboard('总部');
   const caret = input.selectionStart;
   rerender(<SubmarketDetailPanel {...props} summary={{ ...summary, officeCount: 3 }} />);
   expect(screen.getByDisplayValue(input.value)).toBe(input);
   expect(input).toHaveFocus();
   expect(input.selectionStart).toBe(caret);
   fireEvent.compositionStart(input);
   fireEvent.change(input, { target: { value: '组合输入中的区域定位' } });
   rerender(<SubmarketDetailPanel {...props} summary={{ ...summary, officeCount: 4 }} />);
   expect(input).toHaveFocus();
   expect(input).toHaveValue('组合输入中的区域定位');
   fireEvent.compositionEnd(input, { data: '定位' });
   expect(api.save).not.toHaveBeenCalled();
 });


it('registers the editorial exit guard for external navigation and retains drafts while suspended', async () => {
  const register = vi.fn();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { rerender, unmount } = render(<SubmarketDetailPanel {...props} onExitGuardChange={register} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '维护资料' })).toBeInTheDocument());
  expect(register.mock.lastCall?.[0]()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '维护资料' }));
  fireEvent.change(screen.getByDisplayValue(profile.headline), { target: { value: '尚未保存的区域资料' } });
  expect(register.mock.lastCall?.[0]()).toBe(false);
  rerender(<SubmarketDetailPanel {...props} onExitGuardChange={register} suspended />);
  expect(register.mock.lastCall?.[0]()).toBe(false);
  rerender(<SubmarketDetailPanel {...props} onExitGuardChange={register} />);
  expect(screen.getByDisplayValue('尚未保存的区域资料')).toBeInTheDocument();
  confirm.mockReturnValue(true);
  expect(register.mock.lastCall?.[0]()).toBe(true);
  unmount();
  expect(register.mock.lastCall?.[0]).toBeNull();
});

it('observes displayed research sections and suppresses hidden retained views',async()=>{
 const view=render(<SubmarketDetailPanel {...props}/>);
 await waitFor(()=>expect(api.audit).toHaveBeenCalledWith(undefined,'VIEW_SUBMARKET',expect.objectContaining({section:'overview',submarket:'CBD'})));
 fireEvent.click(screen.getByRole('tab',{name:'行情趋势'}));
 expect(api.audit).toHaveBeenLastCalledWith(undefined,'VIEW_SUBMARKET',expect.objectContaining({section:'trend'}));
 api.audit.mockClear();view.rerender(<SubmarketDetailPanel {...props} suspended/>);expect(api.audit).not.toHaveBeenCalled();
});

it('restores submarket section, grade and reading position independently after remount', async () => {
  const store = { submarkets: { CBD: { section: 'trend', grade: 'a', scrollTop: 120 } } };
  const first = render(<MapReadingContext.Provider value={store}><SubmarketDetailPanel {...props} /></MapReadingContext.Provider>);
  await waitFor(() => expect(api.read).toHaveBeenCalledWith('CBD', expect.any(AbortSignal)));
  expect(screen.getByRole('tab', { name: '行情趋势' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: /^甲级$/ })).toHaveAttribute('aria-pressed', 'true');
  const scroll = screen.getByRole('tabpanel');
  expect(scroll.scrollTop).toBe(120);
  fireEvent.wheel(scroll, { deltaY: 95 });
  scroll.scrollTop = 215;
  fireEvent.scroll(scroll);
  first.unmount();
  render(<MapReadingContext.Provider value={store}><SubmarketDetailPanel {...props} /></MapReadingContext.Provider>);
  expect(screen.getByRole('tabpanel').scrollTop).toBe(215);
  expect(screen.getByRole('tab', { name: '行情趋势' })).toHaveAttribute('aria-selected', 'true');
});

it('protects a changed research form on browser unload, then clears the guard on revert and unmount', async () => {
  vi.stubGlobal('navigation', new EventTarget());
  const view = render(<SubmarketDetailPanel {...props} />);
  const unload = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
  try {
    fireEvent.click(await screen.findByRole('button', { name: '维护资料' }));
    const input = screen.getByLabelText('一句话定位');
    expect(unload()).toBe(false);
    fireEvent.change(input, { target: { value: '未保存的刷新保护回归' } });
    expect(unload()).toBe(true);
    expect(input).toHaveValue('未保存的刷新保护回归');
    fireEvent.change(input, { target: { value: profile.headline } });
    expect(unload()).toBe(false);
    fireEvent.change(input, { target: { value: '另一份未保存的编辑' } });
    view.unmount();
    expect(unload()).toBe(false);
    expect(api.save).not.toHaveBeenCalled();
  } finally { view.unmount(); vi.unstubAllGlobals(); }
});

it('cancels real research-form route and history events without saving or losing its draft', async () => {
  const navigation = new EventTarget(); vi.stubGlobal('navigation', navigation);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const view = render(<><a href="/home" onClick={event => event.preventDefault()}>返回首页回归</a><SubmarketDetailPanel {...props} /></>);
  try {
    fireEvent.click(await screen.findByRole('button', { name: '维护资料' }));
    fireEvent.change(screen.getByLabelText('一句话定位'), { target: { value: '导航取消后仍需保留的草稿' } });
    fireEvent.click(screen.getByRole('link', { name: '返回首页回归' }));
    expect(confirm).toHaveBeenCalledOnce();
    const event = new Event('navigate', { cancelable: true }); Object.assign(event, { navigationType: 'traverse' });
    navigation.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('一句话定位')).toHaveValue('导航取消后仍需保留的草稿');
    expect(api.save).not.toHaveBeenCalled();
  } finally { view.unmount(); vi.unstubAllGlobals(); }
});
