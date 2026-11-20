import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAggregateResult, buildTrendResult } from '@/src/lib/intelligence/query/result';
import { buildResultChart } from '@/src/lib/intelligence/query/charts';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
const client = vi.hoisted(() => ({ capabilities: vi.fn(), submit: vi.fn(), recover: vi.fn(), chart: vi.fn(), download: vi.fn(), reportDelivery: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client, queryScopeKey: (s: { actorId: string }) => s.actorId }));
import { HomeQuery } from '../HomeQuery';
const scope = { actorId: 'p0', effectiveId: 'p0', sessionId: 'session', targetId: null };
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const access = { enabled: true, permissionRevision: 'one', examples: Array.from({ length: 10 }, (_, i) => `问题${i + 1}`) };
async function open() { render(<><label htmlFor="home-query">对话查询</label><HomeQuery scope={scope} /></>); const input = screen.getByRole('textbox'); await waitFor(() => expect(input).toBeEnabled()); return input; }
function send(input: HTMLElement, question: string) { fireEvent.change(input, { target: { value: question } }); fireEvent.click(screen.getByRole('button', { name: '发送问题' })); }
describe('homepage AI P0 behavior', () => {
  beforeEach(() => { sessionStorage.clear(); vi.resetAllMocks(); client.capabilities.mockResolvedValue(access); client.reportDelivery.mockResolvedValue(true); client.chart.mockImplementation(async (_s, _id, result, request) => buildResultChart(result, request)); });
  afterEach(cleanup);
  it('keeps only three initial examples and hides the rest until requested', async () => {
    await open(); expect(screen.getByText('今天想研究什么？')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '问题3' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '问题4' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '问题5' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '能力与范围' }));
    expect(await screen.findByRole('button', { name: '问题5' })).toBeVisible();
  });
  it('submits Enter but not Shift+Enter, IME Enter or legacy composition keyCode 229', async () => {
    client.submit.mockResolvedValue({ status: 'clarification', message: '补充季度' });
    const input = await open(); fireEvent.change(input, { target: { value: 'CBD租金' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: 'Enter' });
    expect(client.submit).not.toHaveBeenCalled(); fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' }); await waitFor(() => expect(client.submit).toHaveBeenCalledOnce());
  });
  it('shows a source-linked KPI without a one-cell table or normal recovery controls', async () => {
    client.submit.mockResolvedValue({ status: 'ready', requestId, result: buildAggregateResult(fixture(), 'rent') });
    const input = await open(); send(input, '2026Q3CBD净有效租金');
    const metric = await screen.findByRole('region', { name: '核心指标' }); expect(metric).toHaveTextContent('170'); expect(metric).toHaveTextContent('元/㎡/月');
    expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: '检查状态并恢复结果' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /查看来源：面积加权净有效租金 170/ }));
    expect(screen.getByRole('region', { name: '来源详情' })).toHaveTextContent('net_effective_rent'); expect(client.chart).not.toHaveBeenCalled();
  });
  it('automatically draws one same-result trend in StrictMode without another query or download', async () => {
    const result = resultViewSchema.parse(buildTrendResult([fixture({ year: 2026, quarter: 2 }), fixture({ year: 2026, quarter: 3 })], 'rent', 'per_period'));
    client.submit.mockResolvedValue({ status: 'ready', requestId, result });
    render(<React.StrictMode><HomeQuery scope={scope} /></React.StrictMode>); const input = screen.getByRole('textbox'); await waitFor(() => expect(input).toBeEnabled()); send(input, '租金趋势');
    expect(await screen.findByRole('figure', { name: '同源查询图表' })).toBeInTheDocument();
    expect(client.chart).toHaveBeenCalledOnce(); expect(client.chart.mock.calls[0][3]).toEqual({ kind: 'time_series' });
    expect(client.submit).toHaveBeenCalledOnce(); expect(client.download).not.toHaveBeenCalled();
  });
  it('retains session questions, hides old answers by default and clears all history after revocation', async () => {
    client.submit.mockImplementation(async () => ({ status: 'ready', requestId, result: buildAggregateResult(fixture(), 'rent') }));
    const input = await open(); send(input, '第一条完整问题'); await screen.findByRole('region', { name: '核心指标' });
    send(input, '第二条完整问题'); await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(2)); await screen.findByRole('region', { name: '核心指标' });
    expect(screen.getByText('第一条完整问题')).toBeVisible(); expect(screen.getAllByRole('region', { name: '查询结果' })).toHaveLength(1);
    expect(JSON.stringify(sessionStorage)).not.toContain('第一条');
    client.capabilities.mockResolvedValue({ ...access, permissionRevision: 'two' }); fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByText('第一条完整问题')).not.toBeInTheDocument()); expect(screen.queryByText('第二条完整问题')).not.toBeInTheDocument();
  });
  it('does not offer an unrelated old request for recovery after a new submission fails', async () => {
    client.submit.mockResolvedValueOnce({ status: 'ready', requestId, result: buildAggregateResult(fixture(), 'rent') }).mockRejectedValueOnce(new Error('offline'));
    const input = await open(); send(input, '旧查询'); await screen.findByRole('region', { name: '查询结果' }); send(input, '新查询');
    await screen.findByText(/未能取得查询响应/); expect(screen.queryByRole('button', { name: '检查状态并恢复结果' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试本次请求' })).toBeEnabled();
  });
  it('preserves a draft typed during a pending request and does not resurrect a stopped response', async () => {
    let resolve!: (value: unknown) => void; client.submit.mockReturnValue(new Promise(done => { resolve = done; }));
    const input = await open(); send(input, '已提交'); fireEvent.change(input, { target: { value: '下一条草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '停止等待' }));
    await act(async () => resolve({ status: 'ready', requestId, result: buildAggregateResult(fixture(), 'rent') }));
    expect(input).toHaveValue('下一条草稿'); expect(screen.queryByRole('region', { name: '查询结果' })).not.toBeInTheDocument();
  });
});
