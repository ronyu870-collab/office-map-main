import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildListResult, buildAggregateResult } from '@/src/lib/intelligence/query/result';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
import { HomeQueryDataTable } from '../HomeQueryDataTable';
import { HomeQueryResult } from '../HomeQueryResult';
import { HomeQueryDetailProvider, HomeQueryDetailPanel } from '../HomeQueryDetailPanel';
import { HomeQueryMarkdown } from '../HomeQueryMarkdown';
import { HomeQueryChartWorkspace } from '../HomeQueryChartWorkspace';
import { buildResultChart } from '@/src/lib/intelligence/query/charts';
const client = vi.hoisted(() => ({ chart: vi.fn(), download: vi.fn(), reportDelivery: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client }));
const scope = { actorId: 'owner', effectiveId: 'owner', sessionId: 'session', targetId: null };
function classified() {
  const raw = resultViewSchema.parse(buildListResult(fixture(), ['height']));
  return resultViewSchema.parse({ ...raw, table: { ...raw.table, columns: [...raw.table.columns, { key: 'submarket', label: '子市场', unit: null }, { key: 'grade', label: '等级', unit: null }],
    rows: raw.table.rows.map((row, i) => ({ ...row, cells: { ...row.cells, submarket: { kind: 'text', value: i < 3 ? 'CBD' : '望京', sourceIds: [] }, grade: { kind: 'text', value: i % 2 ? 'B' : 'A', sourceIds: [] } } })) } });
}
function Workspace({ children, drawer = false }: { children: React.ReactNode; drawer?: boolean }) {
  return <HomeQueryDetailProvider><div data-result-id="test">{children}</div><HomeQueryDetailPanel drawer={drawer} /></HomeQueryDetailProvider>;
}
beforeEach(() => { vi.resetAllMocks(); client.reportDelivery.mockResolvedValue(true); client.chart.mockImplementation(async (_scope, _request, result, request) => buildResultChart(result, request)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('retains local table state through workspace opening, source switching and return without chart or query calls', async () => {
  const user = userEvent.setup();
  render(<Workspace><HomeQueryResult result={classified()} /></Workspace>);
  const search = screen.getByRole('searchbox'); await user.type(search, 'A');
  fireEvent.click(screen.getByRole('checkbox', { name: '选择A座' }));
  fireEvent.click(screen.getByRole('button', { name: '展开表格' }));
  const panel = screen.getByRole('region', { name: '数据工作区' });
  expect(within(panel).getByRole('searchbox')).toHaveValue('A');
  expect(within(panel).getByRole('checkbox', { name: '选择A座' })).toBeChecked();
  fireEvent.click(within(panel).getByRole('button', { name: '查看来源：建筑高度 210' }));
  expect(screen.queryByRole('region', { name: '数据工作区' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: '数据依据' })).toHaveTextContent('210');
  expect(screen.getByText('高级技术信息').closest('details')).not.toHaveAttribute('open');
  fireEvent.click(screen.getByRole('button', { name: '返回对话' }));
  expect(screen.getByRole('searchbox')).toHaveValue('A');
  expect(screen.getByRole('checkbox', { name: '选择A座' })).toBeChecked();
  expect(screen.getByRole('button', { name: '查看来源：建筑高度 210' })).toHaveFocus();
  expect(client.chart).not.toHaveBeenCalled(); expect(client.download).not.toHaveBeenCalled();
});
it('supports source drawer keyboard close, exact evidence and focus restoration', async () => {
  const user = userEvent.setup();
  render(<Workspace drawer><HomeQueryResult result={resultViewSchema.parse(buildAggregateResult(fixture(), 'rent'))} /></Workspace>);
  const trigger = screen.getByRole('button', { name: /查看来源：面积加权/ });
  await user.click(trigger);
  expect(screen.getByRole('dialog', { name: '数据依据' })).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByRole('region', { name: '来源详情' })).toHaveTextContent('net_effective_rent');
  await user.keyboard('{Escape}'); expect(trigger).toHaveFocus();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('opens only the selected occurrence when history and a follow-up reuse one result snapshot', () => {
  const result = classified();
  render(<Workspace><HomeQueryDataTable result={result} internalExport={false} onSource={vi.fn()} /><HomeQueryDataTable result={result} internalExport={false} onSource={vi.fn()} /></Workspace>);
  const searches = screen.getAllByRole('searchbox');
  fireEvent.change(searches[0], { target: { value: 'A座' } });
  fireEvent.click(screen.getAllByRole('button', { name: '展开表格' })[0]);
  const panel = screen.getByRole('region', { name: '数据工作区' });
  expect(within(panel).getAllByRole('table')).toHaveLength(1);
  expect(within(panel).getByRole('searchbox')).toHaveValue('A座');
  expect(screen.getAllByRole('table')).toHaveLength(2);
});
it('retains semantic Markdown heading levels and natural soft line breaks', () => {
  const { container } = render(<HomeQueryMarkdown text={'# 研究\n\n## 发现\n\n### 数据\n\n第一行\n第二行\n\n显式换行  \n保留'} />);
  expect(screen.getByRole('heading', { name: '研究', level: 2 })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '发现', level: 3 })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '数据', level: 4 })).toBeInTheDocument();
  expect(container.querySelectorAll('h1')).toHaveLength(0);
  expect(container.querySelectorAll('br')).toHaveLength(1);
});
it('rejects inverted axes locally and downloads the applied view after workspace switches', async () => {
  const value = classified(), request = { kind: 'plot', type: 'bar', x: 'name', y: ['height'] } as const;
  const chartResult = { ...value, parameters: { ...value.parameters, agentChart: { version: 'chart-workspace/1', request, format: 'png_zip' } } };
  render(<Workspace><HomeQueryChartWorkspace result={chartResult} scope={scope} requestId="request" internalExport onSource={vi.fn()} /></Workspace>);
  await waitFor(() => expect(client.chart).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByText('调整图表')); fireEvent.click(screen.getByText('高级坐标设置'));
  fireEvent.change(screen.getByLabelText('数值轴最小值'), { target: { value: '300' } });
  fireEvent.change(screen.getByLabelText('数值轴最大值'), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: '应用图表配置' }));
  expect(screen.getByRole('status')).toHaveTextContent('最小值须小于最大值'); expect(client.chart).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText('数值轴最小值'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('数值轴最大值'), { target: { value: '300' } });
  fireEvent.click(screen.getByRole('button', { name: '应用图表配置' }));
  await waitFor(() => expect(client.chart).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: '展开图表' }));
  expect(screen.getByLabelText('数值轴最大值')).toHaveValue('300');
  fireEvent.click(screen.getByRole('button', { name: '返回对话' }));
  expect(screen.getByLabelText('数值轴最大值')).toHaveValue('300'); expect(client.chart).toHaveBeenCalledTimes(2);
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:chart'); static revokeObjectURL = vi.fn(); });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  client.download.mockResolvedValue({ blob: new Blob(['verified transport']), filename: '图表.zip' });
  fireEvent.click(screen.getByText('下载图表'));
  fireEvent.click(screen.getByRole('button', { name: '下载 PNG 与来源' }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  expect(client.download).toHaveBeenCalledWith(scope, expect.objectContaining({ resultId: value.resultId, chart: expect.objectContaining({ yAxis: { min: 0, max: 300, ticks: 5 } }) }), expect.any(AbortSignal));
});

it('keeps a detail editor open for legacy IME Escape and closes only its active menu', async () => {
  render(<Workspace drawer><HomeQueryDataTable result={classified()} internalExport={false} onSource={vi.fn()} /></Workspace>);
  fireEvent.click(screen.getByRole('button', { name: '展开表格' }));
  const panel = screen.getByRole('dialog', { name: '数据工作区' });
  const search = within(panel).getByRole('searchbox');
  search.focus();
  fireEvent.keyDown(search, { key: 'Escape', keyCode: 229 });
  expect(panel).toBeVisible();
  const fields = within(panel).getByRole('button', { name: '显示字段' });
  fireEvent.click(fields);
  const option = within(panel).getByRole('checkbox', { name: '建筑高度' });
  option.focus();
  fireEvent.keyDown(option, { key: 'Escape' });
  expect(fields).toHaveAttribute('aria-expanded', 'false');
  expect(fields).toHaveFocus(); expect(panel).toBeVisible();
});
