import * as React from 'react';
import { MapReadingContext } from '../workspace/continuity';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubmarketDetailPayload } from '@/src/services/mapDataClient';
import { PitchHandoffProvider, readPitchHandoff } from '@/src/components/pitch/PitchHandoffLink';
import { aggregateMarket } from '../model/marketStatistics';
import type { SubmarketSummary } from '../model/submarketOverview';
import { emptySubmarketProfile } from '../model/submarketProfile';
import { SubmarketDetailPanel } from '../components/SubmarketDetailPanel';

const api = vi.hoisted(() => ({
  audit:vi.fn(),read: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@/src/utils/audit',()=>({logAction:api.audit}));
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
  it('keeps the overview all-grade trend after visiting a grade with no observations', async () => {
    const point={period:'2026Q3',year:2026,quarter:3,rent:180,vacancyPct:10,rentSamples:1,vacancySamples:1,rentArea:100,vacancyArea:100};
    api.read.mockResolvedValueOnce({...payload,trends:{all:[point],a:[point],b:[]}});
    render(<SubmarketDetailPanel {...props} />);
    await screen.findByTestId('trend-chart');
    fireEvent.click(screen.getByRole('tab',{name:'行情趋势'}));
    fireEvent.click(screen.getByRole('button',{name:'乙级'}));
    expect(screen.queryByTestId('trend-chart')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab',{name:'市场概览'}));
    expect(screen.getByTestId('trend-chart')).toBeInTheDocument();
  });

  it('falls back to building composition when a published profile has only introduction copy', async () => {
    api.read.mockResolvedValueOnce({...payload,profile:{...profile,industries:'',transport:''}});
    render(<SubmarketDetailPanel {...props} />);
    await screen.findByText(profile.headline);
    expect(screen.getByRole('region',{name:'楼宇结构'})).toHaveTextContent('甲级写字楼');
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
    expect(screen.getByText('甲级 1 · 乙级 1')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByText(/AI公开资料研究|研究草案|待业务团队复核/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '区域画像' }));
    expect(screen.getByRole('heading', { name: '交通与配套' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '人口与就业参考' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '政策与规划' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /政策原文/ })).toHaveAttribute('target', '_blank');
    expect(api.read).toHaveBeenCalledWith('CBD');
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
    render(<PitchHandoffProvider enabled><SubmarketDetailPanel {...props} /></PitchHandoffProvider>);
    const link = await screen.findByRole('link', { name: '将子市场行情加入 Pitch' });
    const href = new URL(link.getAttribute('href')!, window.location.origin);
    expect(readPitchHandoff(href.hash)).toEqual({ source: { kind: 'submarket', key: 'CBD' }, period: '2026-Q2' });
    fireEvent.click(screen.getByRole('tab', { name: '行情趋势' }));
    await waitFor(() => expect(screen.getByText('2026Q2')).toBeInTheDocument());
    expect(screen.getByText('-10.0')).toBeInTheDocument();
    expect(screen.getByText('+2.0')).toBeInTheDocument();
    expect(screen.getAllByText(/与相邻季度比较/).length).toBeGreaterThan(0);
  });


  it('distinguishes temporarily unavailable trend data from genuine missing observations', async () => {
    api.read.mockResolvedValueOnce({ ...payload, trendError: true, trends: emptyTrend });
    render(<PitchHandoffProvider enabled><SubmarketDetailPanel {...props} /></PitchHandoffProvider>);
    await waitFor(() => expect(screen.getByText('历史行情暂不可用')).toBeInTheDocument());
    const link = await screen.findByRole('link', { name: '将子市场行情加入 Pitch' });
    const href = new URL(link.getAttribute('href')!, window.location.origin);
    expect(readPitchHandoff(href.hash)).toEqual({ source: { kind: 'submarket', key: 'CBD' } });
    fireEvent.click(screen.getByRole('tab', { name: '行情趋势' }));
    expect(screen.getByText('历史行情暂不可用')).toBeInTheDocument();
    expect(screen.queryByText('最新有效样本')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText('CBD办公市场概览')).toBeInTheDocument());
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.queryByText(/研究草案|待业务团队复核|只供内部讨论/)).not.toBeInTheDocument();
    expect(screen.getByText('186.8')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '维护资料' }));
    expect(screen.getByDisplayValue('客户研究（研究草案）')).toBeInTheDocument();
  });

  it('saves and publishes clean submarket copy without a separate approval step', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    api.save.mockResolvedValue({ profile, profilePublished: true });
    render(<SubmarketDetailPanel {...props} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '维护资料' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '维护资料' }));
    expect(screen.queryByRole('button', { name: '核验并发布' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存并展示' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith('CBD', expect.objectContaining({ headline: profile.headline }), true));
    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('tab', { name: '区域画像' })).toBeInTheDocument());
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
  await waitFor(() => expect(api.read).toHaveBeenCalledWith('CBD'));
  expect(screen.getByRole('tab', { name: '行情趋势' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: /^甲级$/ })).toHaveAttribute('aria-pressed', 'true');
  const scroll = screen.getByRole('tabpanel');
  scroll.scrollTop = 215; fireEvent.scroll(scroll);
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
