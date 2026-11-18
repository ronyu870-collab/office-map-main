import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAggregateResult, buildTrendResult } from '@/src/lib/intelligence/query/result';
import { buildResultChart } from '@/src/lib/intelligence/query/charts';
import { resultViewSchema, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import * as presentation from '@/src/lib/intelligence/query/presentation';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
import type { QueryClientScope } from '@/src/services/trustedQueryClient';
const client = vi.hoisted(() => ({ chart: vi.fn(), reportDelivery: vi.fn(), download: vi.fn(), copy: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client }));
import { HomeQueryResult } from '../HomeQueryResult';
import { HomeQueryResearchPanel } from '../HomeQueryResearchPanel';
import { useQueryPresentationReceipt } from '../useQueryPresentationReceipt';
const scope = { actorId: 'owner', effectiveId: 'owner', sessionId: 'session', targetId: null };
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ticks = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 70)); }); };
const longResult = () => resultViewSchema.parse(buildTrendResult(Array.from({ length: 28 }, (_, index) => {
  const snapshot = fixture({ year: 2020 + Math.floor(index / 4), quarter: index % 4 + 1 });
  return { ...snapshot, rows: snapshot.rows.map(row => ({ ...row, facts: Object.fromEntries(Object.entries(row.facts).map(([field, fact]) => [field,
    { ...fact, sources: fact.sources.map(source => source.period ? { ...source, id: `${source.id}/${snapshot.period!.year}`, recordId: `${source.recordId}/${snapshot.period!.year}` } : source) },
  ])) })) };
}), 'rent', 'per_period'));

describe('progressive research result in one retained workspace', () => {
  beforeEach(() => { vi.resetAllMocks(); client.reportDelivery.mockResolvedValue(true); client.chart.mockImplementation(async (_scope, _id, result, request) => buildResultChart(result, request)); });
  afterEach(cleanup);
  it('keeps a short metric immediately available, including its authorized source action', async () => {
    const result = resultViewSchema.parse(buildAggregateResult(fixture(), 'rent'));
    render(<HomeQueryResult result={result} presentation="compact" />);
    expect(screen.getByRole('region', { name: '核心指标' })).toHaveTextContent('170');
    expect(screen.queryByRole('button', { name: '展开完整分析' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /查看来源：面积加权净有效租金/ }));
    expect(screen.getByRole('region', { name: '来源详情' })).toHaveFocus();
    expect(screen.getByRole('region', { name: '来源详情' })).toHaveTextContent('net_effective_rent');
  });
  it('opens nearby source metadata, returns focus, and keeps full sample exclusions visible', () => {
    const result = resultViewSchema.parse(buildAggregateResult(fixture(), 'rent'));
    render(<HomeQueryResult result={result} />);
    const summary = screen.getByRole('region', { name: '数据依据摘要' });
    const source = within(summary).getByRole('button', { name: /季度数据/ });
    fireEvent.click(source);
    const panel = screen.getByRole('region', { name: '来源详情' });
    expect(panel).toHaveFocus();
    expect(panel).toHaveTextContent('building_metrics');
    expect(panel).toHaveTextContent('记录版本');
    fireEvent.click(screen.getByRole('button', { name: '关闭来源' }));
    expect(source).toHaveFocus();
    const limitations = screen.getByRole('region', { name: '统计口径与限制' });
    expect(limitations).toHaveTextContent('缺失');
    expect(limitations).toHaveTextContent('未核验');
    expect(limitations.closest('details')).toBeNull();
  });
  it('keeps results, evidence and the footer actions available when chart generation fails', async () => {
    client.chart.mockRejectedValueOnce(new Error('synthetic chart unavailable'));
    const result = longResult();
    render(<HomeQueryResult result={result} requestId={requestId} scope={scope} internalExport />);
    await screen.findByText('synthetic chart unavailable');
    expect(screen.getByRole('table', { name: '本次结果的完整表格，分页不改变统计范围' })).toBeVisible();
    const sources = screen.getByRole('region', { name: '数据来源' });
    const limitations = screen.getByRole('region', { name: '统计口径与限制' });
    const copy = screen.getByRole('button', { name: '复制结论' });
    expect(copy).toBeEnabled();
    expect(sources.compareDocumentPosition(limitations) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(limitations.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(sources).getByRole('button', { name: /获权来源/ }));
    expect(screen.getByRole('region', { name: '来源详情' })).toHaveFocus();
    expect(client.chart).toHaveBeenCalledOnce();
    expect(client.download).not.toHaveBeenCalled();
  });
  it('shows download progress and failure beside the footer controls without losing the current chart', async () => {
    let rejectDownload!: (reason: Error) => void;
    client.download.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectDownload = reject; }));
    const result = longResult();
    render(<HomeQueryResult result={result} requestId={requestId} scope={scope} internalExport />);
    const chart = await screen.findByRole('figure', { name: '同源查询图表' });
    const actions = screen.getByRole('group', { name: '结果操作与反馈' });
    fireEvent.click(within(actions).getByText('下载本次结果'));
    const download = within(actions).getByRole('button', { name: 'Excel' });
    fireEvent.click(download);
    expect(within(actions).getByRole('status')).toHaveTextContent('正在核对导出权限并生成文件');
    expect(download).toBeDisabled();
    await act(async () => { rejectDownload(new Error('synthetic download failed')); });
    expect(within(actions).getByRole('status')).toHaveTextContent('synthetic download failed');
    expect(download).toBeEnabled();
    expect(screen.getByRole('figure', { name: '同源查询图表' })).toBe(chart);
    expect(client.download).toHaveBeenCalledWith(scope, { requestId, resultId: result.resultId, action: 'export', format: 'xlsx' }, expect.any(AbortSignal));
    expect(client.chart).toHaveBeenCalledOnce();
  });
  it('defers a long result, then retains the chart, page, source selection and receipt across mode switches', async () => {
    const result = longResult(), delivery = { status: 'ready', requestId, result }, onExpand = vi.fn();
    const props = { result, delivery, requestId, scope, onExpand, internalExport: true };
    const view = render(<HomeQueryResult {...props} presentation="compact" />);
    expect(screen.getByRole('region', { name: '查询结果' })).toHaveTextContent('各季度参与楼宇可能不同');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(client.chart).not.toHaveBeenCalled(); await ticks(); expect(client.reportDelivery).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '在全屏中查看完整分析' })); expect(onExpand).toHaveBeenCalledOnce();
    view.rerender(<HomeQueryResult {...props} presentation="expanded" />);
    const figure = await screen.findByRole('figure', { name: '同源查询图表' });
    const copy = screen.getByRole('button', { name: '复制结论' });
    const table = screen.getByRole('table', { name: '本次结果的完整表格，分页不改变统计范围' });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
    const sourceButton = within(table).getAllByRole('button', { name: /查看来源/ })[1];
    fireEvent.click(sourceButton);
    const source = screen.getByRole('region', { name: '来源详情' });
    await waitFor(() => expect(client.reportDelivery.mock.calls.some(call => call[3]?.sourceIds?.length)).toBe(true));
    const receipts = client.reportDelivery.mock.calls.length;
    view.rerender(<HomeQueryResult {...props} presentation="compact" />);
    expect(figure).not.toBeVisible(); expect(table).not.toBeVisible();
    expect(copy).not.toBeVisible();
    expect(source).toBeVisible();
    view.rerender(<HomeQueryResult {...props} presentation="expanded" />); await ticks();
    expect(screen.getByRole('figure', { name: '同源查询图表' })).toBe(figure);
    expect(screen.getByRole('button', { name: '复制结论' })).toBe(copy);
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(screen.getByRole('region', { name: '来源详情' })).toBe(source);
    expect(client.chart).toHaveBeenCalledOnce(); expect(client.reportDelivery).toHaveBeenCalledTimes(receipts);
    fireEvent.click(screen.getByRole('button', { name: '关闭来源' })); expect(sourceButton).toHaveFocus();
  });
  it('keeps an in-flight chart alive while contracted and reports it only after a real reveal', async () => {
    let finish!: (value: unknown) => void;
    client.chart.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const result = longResult(), delivery = { status: 'ready', requestId, result };
    const props = { result, delivery, requestId, scope };
    const view = render(<HomeQueryResult {...props} presentation="expanded" />);
    await waitFor(() => expect(client.chart).toHaveBeenCalledOnce());
    view.rerender(<HomeQueryResult {...props} presentation="compact" />);
    expect(client.chart.mock.calls[0][4].aborted).toBe(false);
    await act(async () => finish(buildResultChart(result, { kind: 'time_series' })));
    await ticks(); expect(client.reportDelivery.mock.calls.some(call => call[3]?.surface === 'chart')).toBe(false);
    view.rerender(<HomeQueryResult {...props} presentation="expanded" />);
    await screen.findByRole('figure', { name: '同源查询图表' });
    await waitFor(() => expect(client.reportDelivery.mock.calls.some(call => call[3]?.surface === 'chart')).toBe(true));
    expect(client.chart).toHaveBeenCalledOnce();
  });
  it('offers all source details from a compact preview without generating or querying results again', () => {
    const result = longResult(); render(<HomeQueryResult result={result} presentation="compact" />);
    fireEvent.click(screen.getByText('来源、口径与结果版本'));
    fireEvent.click(screen.getByRole('button', { name: '查看全部来源' }));
    expect(screen.getByRole('region', { name: '来源详情' })).toHaveTextContent('全部获权候选来源');
    expect(client.chart).not.toHaveBeenCalled(); expect(client.download).not.toHaveBeenCalled();
  });
  it('shows authorized context in a companion without presenting historical values as current data', () => {
    const result = resultViewSchema.parse(buildAggregateResult(fixture(), 'rent'));
    const onClose = vi.fn(); render(<HomeQueryResearchPanel result={result} onClose={onClose} />);
    expect(screen.getByRole('complementary', { name: '研究资料与口径' })).toHaveTextContent('季度指标');
    expect(screen.getByRole('region', { name: '当前分析范围' })).toHaveTextContent('2026 年第 3 季度');
    expect(screen.getByRole('region', { name: '结果时间' })).toHaveTextContent('不代表最新市场数据');
    expect(screen.getByRole('region', { name: '统计口径' })).toHaveTextContent('按有效总面积加权');
    expect(screen.queryByText(result.resultId)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭研究资料' })); expect(onClose).toHaveBeenCalledOnce();
    expect(client.chart).not.toHaveBeenCalled(); expect(client.reportDelivery).not.toHaveBeenCalled();
  });
  it('does not recompute a retained large result for each draft edit in its parent', () => {
    const summary = vi.spyOn(presentation, 'resultSummary');
    try {
      render(<ResultWithDraft result={longResult()} />);
      const table = screen.getByRole('table', { name: '本次结果的完整表格，分页不改变统计范围' });
      fireEvent.click(screen.getByRole('button', { name: '下一页' }));
      expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
      summary.mockClear();
      for (const value of ['下', '下一', '下一条', '下一条问题']) fireEvent.change(screen.getByRole('textbox', { name: '下一条草稿' }), { target: { value } });
      expect(summary).not.toHaveBeenCalled();
      expect(screen.getByRole('table', { name: '本次结果的完整表格，分页不改变统计范围' })).toBe(table);
      expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
    } finally { summary.mockRestore(); }
  });
});

function ResultWithDraft({ result }: { result: QueryResultView }) {
  const [draft, setDraft] = React.useState('');
  return <><textarea aria-label="下一条草稿" value={draft} onChange={event => setDraft(event.target.value)} /><HomeQueryResult result={result} /></>;
}

function ReceiptProbe({ enabled, value, page = 0, identity = scope }: { enabled: boolean; value: object; page?: number; identity?: QueryClientScope }) {
  useQueryPresentationReceipt(identity, value, { surface: 'answer_table', page, pageSize: 25, sourceIds: [] }, enabled);
  return <div>已挂载的结果</div>;
}
describe('retained presentation receipt lifecycle', () => {
  beforeEach(() => { vi.resetAllMocks(); client.reportDelivery.mockResolvedValue(true); });
  afterEach(cleanup);
  it('suppresses retained hidden views and duplicate reopen receipts but reports actual page, result and identity changes', async () => {
    const value: Partial<QueryResultView> = { resultId: requestId };
    const view = render(<ReceiptProbe value={value} enabled={false} />); await ticks(); expect(client.reportDelivery).not.toHaveBeenCalled();
    view.rerender(<ReceiptProbe value={value} enabled />); await waitFor(() => expect(client.reportDelivery).toHaveBeenCalledOnce()); await ticks();
    view.rerender(<ReceiptProbe value={value} enabled={false} />); view.rerender(<ReceiptProbe value={value} enabled />); await ticks(); expect(client.reportDelivery).toHaveBeenCalledOnce();
    view.rerender(<ReceiptProbe value={value} enabled page={1} />); await waitFor(() => expect(client.reportDelivery).toHaveBeenCalledTimes(2));
    const another = { resultId: 'another' }; view.rerender(<ReceiptProbe value={another} enabled page={1} />); await waitFor(() => expect(client.reportDelivery).toHaveBeenCalledTimes(3));
    view.rerender(<ReceiptProbe value={another} enabled page={1} identity={{ ...scope, actorId: 'second', effectiveId: 'second' }} />);
    await waitFor(() => expect(client.reportDelivery).toHaveBeenCalledTimes(4));
  });
  it('does not treat failed or canceled delivery reports as confirmed', async () => {
    const value = {}; client.reportDelivery.mockResolvedValueOnce(false);
    const view = render(<ReceiptProbe value={value} enabled />); await waitFor(() => expect(client.reportDelivery).toHaveBeenCalledOnce()); await ticks();
    view.rerender(<ReceiptProbe value={value} enabled={false} />); view.rerender(<ReceiptProbe value={value} enabled />);
    await waitFor(() => expect(client.reportDelivery).toHaveBeenCalledTimes(2));
    view.unmount(); expect(client.reportDelivery.mock.calls[1][4].aborted).toBe(true);
  });
  it('keeps an already dispatched receipt alive across hide and reveal while its confirmation is delayed', async () => {
    const value = {};
    let confirm!: (confirmed: boolean) => void;
    client.reportDelivery.mockReturnValueOnce(new Promise<boolean>(resolve => { confirm = resolve; }));
    const view = render(<ReceiptProbe value={value} enabled />);
    await waitFor(() => expect(client.reportDelivery).toHaveBeenCalledOnce());
    const signal = client.reportDelivery.mock.calls[0][4] as AbortSignal;
    view.rerender(<ReceiptProbe value={value} enabled={false} />);
    expect(signal.aborted).toBe(false);
    view.rerender(<ReceiptProbe value={value} enabled />);
    await ticks(); expect(client.reportDelivery).toHaveBeenCalledOnce();
    view.rerender(<ReceiptProbe value={value} enabled={false} />);
    await act(async () => { confirm(true); });
    view.rerender(<ReceiptProbe value={value} enabled />);
    await ticks(); expect(client.reportDelivery).toHaveBeenCalledOnce();
    expect(signal.aborted).toBe(false);
    view.unmount(); expect(signal.aborted).toBe(true);
  });
  it('cancels a scheduled receipt when the view is hidden before its animation frames commit', async () => {
    const value = {};
    const view = render(<ReceiptProbe value={value} enabled />);
    view.rerender(<ReceiptProbe value={value} enabled={false} />);
    await ticks(); expect(client.reportDelivery).not.toHaveBeenCalled();
    view.rerender(<ReceiptProbe value={value} enabled />);
    await waitFor(() => expect(client.reportDelivery).toHaveBeenCalledOnce());
  });
  it.each(['scope', 'result', 'view'] as const)('aborts a dispatched receipt after its %s changes while hidden and ignores its late confirmation', async change => {
    const value = {}, next = {
      value: change === 'result' ? {} : value,
      identity: change === 'scope' ? { ...scope, actorId: 'second', effectiveId: 'second', sessionId: 'second-session' } : scope,
      page: change === 'view' ? 1 : 0,
    };
    let confirmOld!: (confirmed: boolean) => void, confirmCurrent!: (confirmed: boolean) => void;
    client.reportDelivery
      .mockReturnValueOnce(new Promise<boolean>(resolve => { confirmOld = resolve; }))
      .mockReturnValueOnce(new Promise<boolean>(resolve => { confirmCurrent = resolve; }));
    const view = render(<ReceiptProbe value={value} enabled />);
    await waitFor(() => expect(client.reportDelivery).toHaveBeenCalledOnce());
    const signal = client.reportDelivery.mock.calls[0][4] as AbortSignal;
    view.rerender(<ReceiptProbe value={value} enabled={false} />);
    view.rerender(<ReceiptProbe {...next} enabled={false} />);
    expect(signal.aborted).toBe(true);
    await ticks(); expect(client.reportDelivery).toHaveBeenCalledOnce();
    view.rerender(<ReceiptProbe {...next} enabled />);
    await waitFor(() => expect(client.reportDelivery).toHaveBeenCalledTimes(2));
    expect(client.reportDelivery.mock.calls[1].slice(0, 2)).toEqual([next.identity, next.value]);
    expect(client.reportDelivery.mock.calls[1][3].page).toBe(next.page);
    await act(async () => { confirmOld(true); });
    view.rerender(<ReceiptProbe {...next} enabled={false} />);
    view.rerender(<ReceiptProbe {...next} enabled />);
    await ticks(); expect(client.reportDelivery).toHaveBeenCalledTimes(2);
    await act(async () => { confirmCurrent(false); });
    view.rerender(<ReceiptProbe {...next} enabled={false} />);
    view.rerender(<ReceiptProbe {...next} enabled />);
    await waitFor(() => expect(client.reportDelivery).toHaveBeenCalledTimes(3));
  });
  it('aborts an unconfirmed dispatched receipt on actual unmount even while its view is hidden', async () => {
    const value = {};
    let confirm!: (confirmed: boolean) => void;
    client.reportDelivery.mockReturnValueOnce(new Promise<boolean>(resolve => { confirm = resolve; }));
    const view = render(<ReceiptProbe value={value} enabled />);
    await waitFor(() => expect(client.reportDelivery).toHaveBeenCalledOnce());
    const signal = client.reportDelivery.mock.calls[0][4] as AbortSignal;
    view.rerender(<ReceiptProbe value={value} enabled={false} />);
    expect(signal.aborted).toBe(false);
    view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => { confirm(true); });
    expect(client.reportDelivery).toHaveBeenCalledOnce();
  });
});
