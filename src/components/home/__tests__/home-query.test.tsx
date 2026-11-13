import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildResultChart } from '@/src/lib/intelligence/query/charts';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { buildAggregateResult, buildRankResult, buildTrendResult } from '@/src/lib/intelligence/query/result';
import { resolveNumericFact } from '@/src/lib/intelligence/query/facts';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';

const client = vi.hoisted(() => ({ capabilities: vi.fn(), submit: vi.fn(), recover: vi.fn(), chart: vi.fn(), download: vi.fn(), reportDelivery: vi.fn().mockResolvedValue(true) }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client, queryScopeKey: (scope: { actorId: string }) => scope.actorId }));
import { HomeQuery } from '../HomeQuery';
const scope = { actorId: 'first', effectiveId: 'first', sessionId: 'session', targetId: null };
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const capabilities = { enabled: true, permissionRevision: 'one', examples: ['CBD有哪些楼'] };
const view = (actor = 'first') => <><label htmlFor="home-query">对话查询</label><HomeQuery key={actor} scope={actor === 'first' ? scope : { ...scope, actorId: actor, effectiveId: actor }} /></>;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; };

describe('homepage trusted query actual input and result lifecycle', () => {
  beforeEach(() => { sessionStorage.clear(); client.reportDelivery.mockClear(); client.capabilities.mockReset().mockResolvedValue(capabilities); client.submit.mockReset(); client.recover.mockReset(); client.chart.mockReset(); client.download.mockReset(); });
  afterEach(cleanup);
  it('renders a quarterly gap and switches graph type without rerunning data', async () => {
    const snapshots = [1, 2, 3, 4].map(quarter => fixture({ year: 2026, quarter }));
    snapshots[2] = { ...snapshots[2], rows: snapshots[2].rows.map(row => ({ ...row, facts: { ...row.facts,
      netEffectiveRent: resolveNumericFact('netEffectiveRent', row.id, [], snapshots[2].period),
    } })) };
    const result = resultViewSchema.parse(buildTrendResult(snapshots, 'rent', 'per_period'));
    client.capabilities.mockResolvedValue({ ...capabilities, internalExport: true });
    client.submit.mockResolvedValue({ requestId, status: 'ready', result });
    client.chart.mockImplementation(async (_scope, _id, result, request) => buildResultChart(result, request));
    client.download.mockResolvedValue(undefined);
    render(view()); const input = screen.getByRole('textbox'); await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'CBD净有效租金2026Q1至2026Q4趋势各期样本' } });
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    fireEvent.click(await screen.findByRole('button', { name: '查看折线图' }));
    const figure = await screen.findByRole('figure', { name: '同源查询图表' });
    expect(figure.querySelectorAll('polyline')).toHaveLength(1);
    expect(figure.querySelectorAll('circle')).toHaveLength(3);
    expect(figure).toHaveTextContent('2026-Q3');
    await waitFor(() => expect(client.reportDelivery.mock.calls.some(call => call[3]?.layout === 'line_all')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '查看柱状图' }));
    await waitFor(() => expect(figure.querySelectorAll('polyline')).toHaveLength(0));
    expect(client.submit).toHaveBeenCalledOnce();
    expect(client.chart.mock.calls.map(call => call[3].kind)).toEqual(['time_series', 'bar']);
    expect(input).toHaveValue('CBD净有效租金2026Q1至2026Q4趋势各期样本');
  });
  it('keeps character input, focus, selection and IME across pending and result updates', async () => {
    const pending = deferred<unknown>(); client.submit.mockReturnValue(pending.promise);
    render(view()); const input = screen.getByRole('textbox', { name: '对话查询' }) as HTMLTextAreaElement;
    await waitFor(() => expect(input).toBeEnabled()); const user = userEvent.setup();
    await user.click(input); await user.type(input, 'C'); expect(input).toHaveFocus();
    await user.type(input, 'BD有哪些楼'); fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(client.submit).toHaveBeenCalledOnce(); expect(input).toHaveFocus(); expect(input).toBeEnabled();
    await user.type(input, 'A'); input.setSelectionRange(3, 3); await user.keyboard('Z');
    expect(input).toHaveValue('CBDZ有哪些楼A'); expect(input.selectionStart).toBe(4);
    await act(async () => { pending.resolve({ requestId, status: 'ready', result: buildAggregateResult(fixture(), 'rent') }); });
    expect(screen.getByRole('region', { name: '查询结果' })).toHaveTextContent('170');
    expect(screen.getByRole('textbox')).toBe(input); expect(input).toHaveFocus(); expect(input.selectionStart).toBe(4);
    await user.clear(input); await user.keyboard('CBD');
    fireEvent.compositionStart(input); await user.keyboard('中'); fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(client.submit).toHaveBeenCalledOnce(); expect(input).toHaveFocus();
    fireEvent.compositionEnd(input); await user.keyboard('文'); expect(input).toHaveValue('CBD中文');
    await user.clear(input); await user.type(input, '新'); expect(input).toHaveFocus(); expect(input).toHaveValue('新');
  });
  it('retries the exact original question and nonce after a lost response, while preserving the new draft', async () => {
    client.submit.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ status: 'already_received', requestId });
    client.recover.mockResolvedValue({ status: 'ready', requestId, result: buildRankResult(fixture(), 'height', 1, 'desc') });
    render(view()); const input = screen.getByRole('textbox'); await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'CBD最高的楼是什么' } }); fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    await screen.findByText(/未能取得查询响应/); fireEvent.change(input, { target: { value: '新问题' } });
    fireEvent.click(screen.getByRole('button', { name: '重试本次请求' })); await screen.findByRole('button', { name: '检查状态并恢复结果' });
    expect(client.submit.mock.calls[0][1]).toEqual(client.submit.mock.calls[1][1]); expect(input).toHaveValue('新问题');
    fireEvent.click(screen.getByRole('button', { name: '检查状态并恢复结果' })); await screen.findByRole('region', { name: '查询结果' });
    expect(client.submit).toHaveBeenCalledTimes(2); expect(client.recover).toHaveBeenCalledOnce();
    expect(screen.getByText(/已知有效高度记录中最高的是A座/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看来源：建筑高度 210' }));
    expect(screen.getByRole('region', { name: '来源详情' })).toHaveTextContent('building_height');
    expect(screen.getByRole('region', { name: '来源详情' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '关闭来源' }));
    expect(screen.getByRole('button', { name: '查看来源：建筑高度 210' })).toHaveFocus();
    expect(sessionStorage.getItem('trusted-query:last:first')).toBe(requestId);
    expect(JSON.stringify(sessionStorage)).not.toContain('CBD最高');
  });
  it('suppresses late results after stopping or changing accounts, without collecting unsubmitted input', async () => {
    const pending = deferred<unknown>(); client.submit.mockReturnValue(pending.promise);
    const rendered = render(view()); const input = screen.getByRole('textbox'); await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: '未提交草稿' } }); expect(client.submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '发送问题' })); fireEvent.click(screen.getByRole('button', { name: '停止等待' }));
    expect(screen.getByText(/不能据此认定服务端已取消/)).toBeInTheDocument();
    rendered.rerender(view('second')); await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    await act(async () => { pending.resolve({ requestId, status: 'ready', result: buildAggregateResult(fixture(), 'rent') }); });
    expect(screen.queryByRole('region', { name: '查询结果' })).not.toBeInTheDocument(); expect(screen.getByRole('textbox')).toHaveValue('');
    expect(sessionStorage.length).toBe(0);
  });
  it('clears old sources on permission revision changes and never sends a closed query', async () => {
    client.submit.mockResolvedValue({ requestId, status: 'ready', result: buildAggregateResult(fixture(), 'rent') });
    render(view()); const input = screen.getByRole('textbox'); await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: '2026Q3CBD净有效租金' } }); fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    await screen.findByRole('region', { name: '查询结果' });
    client.capabilities.mockResolvedValue({ enabled: false, examples: [] }); fireEvent.focus(window);
    await waitFor(() => expect(input).toBeDisabled()); expect(screen.queryByRole('region', { name: '查询结果' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送问题' })).toBeDisabled(); expect(sessionStorage.length).toBe(0);
  });
  it('shows clarification without guessing a result and keeps input editable', async () => {
    client.submit.mockResolvedValue({ status: 'clarification', requestId, message: '请明确年份与租金口径。' });
    render(view()); const input = screen.getByRole('textbox'); await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: '今年租金' } }); fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    await screen.findByText('请明确年份与租金口径。'); expect(input).toHaveValue('今年租金'); expect(input).toBeEnabled();
    expect(screen.queryByRole('region', { name: '查询结果' })).not.toBeInTheDocument(); expect(sessionStorage.length).toBe(0);
  });
  it('shows a chart from the same result, preserves draft and source focus, and requires an explicit export grant', async () => {
    const result = buildAggregateResult(fixture(), 'vacancy');
    client.submit.mockResolvedValue({ requestId, status: 'ready', result });
    client.chart.mockResolvedValue(buildResultChart(resultViewSchema.parse(result), { kind: 'bar', field: 'value' }));
    render(view()); const input = screen.getByRole('textbox'); await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: '2026Q3CBD空置率' } }); fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    fireEvent.click(await screen.findByRole('button', { name: '查看柱状图' }));
    const chart = await screen.findByRole('figure', { name: '同源查询图表' }); expect(chart).toHaveTextContent('17.5');
    expect(client.chart.mock.calls[0].slice(0, 4)).toEqual([scope, requestId, resultViewSchema.parse(result), { kind: 'bar', field: 'value' }]);
    expect(client.submit).toHaveBeenCalledOnce(); expect(input).toHaveValue('2026Q3CBD空置率');
    expect(screen.queryByText('下载本次结果')).not.toBeInTheDocument();
    fireEvent.click(chart.querySelector('button')!); expect(screen.getByRole('region', { name: '来源详情' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '关闭来源' })); expect(chart.querySelector('button')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '收起图表' })); expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '查询结果' })).toHaveTextContent('17.5');
  });
  it('does not expose a late chart after a permission change and removes the export controls', async () => {
    const result = buildAggregateResult(fixture(), 'rent'), pending = deferred<unknown>();
    client.capabilities.mockResolvedValue({ ...capabilities, internalExport: true });
    client.submit.mockResolvedValue({ requestId, status: 'ready', result }); client.chart.mockReturnValue(pending.promise);
    render(view()); await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2026Q3CBD净有效租金' } }); fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    await screen.findByText('下载本次结果'); fireEvent.click(screen.getByRole('button', { name: '查看柱状图' }));
    client.capabilities.mockResolvedValue({ enabled: false, examples: [] }); fireEvent.focus(window);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeDisabled());
    await act(async () => pending.resolve(buildResultChart(resultViewSchema.parse(result), { kind: 'bar', field: 'value' })));
    expect(screen.queryByRole('figure')).not.toBeInTheDocument(); expect(screen.queryByText('下载本次结果')).not.toBeInTheDocument();
  });

  it('reports committed result/source views and never reports input drafts as displayed answers', async () => {
    const result = resultViewSchema.parse(buildAggregateResult(fixture(), 'rent'));
    const reply = { requestId, status: 'ready', result }; client.submit.mockResolvedValue(reply);
    render(view()); const input = screen.getByRole('textbox'); await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: '季度租金问题' } }); fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    await screen.findByRole('region', { name: '查询结果' });
    await waitFor(() => expect(client.reportDelivery).toHaveBeenCalledWith(scope, reply, 'client_dom_committed', { surface: 'answer_table', page: 0, pageSize: 25, sourceIds: [] }, expect.any(AbortSignal)));
    fireEvent.click(screen.getAllByRole('button', { name: /查看来源/ })[0]);
    await waitFor(() => expect(client.reportDelivery.mock.calls.some(call => call[3].sourceIds?.length > 0)).toBe(true));
    const count = client.reportDelivery.mock.calls.length;
    fireEvent.change(input, { target: { value: '未提交的新草稿' } });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(client.reportDelivery.mock.calls).toHaveLength(count);
    expect(JSON.stringify(client.reportDelivery.mock.calls)).not.toContain('未提交的新草稿');
  });

  it('does not report a hidden document or an unmounted result as presented', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      client.submit.mockResolvedValue({ requestId, status: 'ready', result: resultViewSchema.parse(buildAggregateResult(fixture(), 'rent')) });
      const mounted = render(view()); const input = screen.getByRole('textbox'); await waitFor(() => expect(input).toBeEnabled());
      fireEvent.change(input, { target: { value: '季度租金' } }); fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
      await screen.findByRole('region', { name: '查询结果' });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
      expect(client.reportDelivery).not.toHaveBeenCalled();
      mounted.unmount(); visibility.mockReturnValue('visible'); fireEvent(document, new Event('visibilitychange'));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
      expect(client.reportDelivery).not.toHaveBeenCalled();
    } finally { visibility.mockRestore(); }
  });

});
