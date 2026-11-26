import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { buildListResult } from '@/src/lib/intelligence/query/result';
import { buildResultChart } from '@/src/lib/intelligence/query/charts';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
const client = vi.hoisted(() => ({ chart: vi.fn(), download: vi.fn(), reportDelivery: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client }));
import { HomeQueryResult } from '../HomeQueryResult';
import { HomeQueryChartWorkspace } from '../HomeQueryChartWorkspace';
const scope = { actorId: 'owner', effectiveId: 'owner', sessionId: 'session', targetId: null };
const requestId = crypto.randomUUID();
function formal() {
  const r = buildListResult(fixture(), ['height', 'netEffectiveRent']);
  return resultViewSchema.parse({ ...r, parameters: { ...r.parameters, agentChart: { version: 'chart-workspace/1',
    format: 'png_zip', request: { kind: 'plot', type: 'horizontal_bar', x: 'name', y: ['netEffectiveRent'] } } },
    table: { ...r.table, rows: Array.from({ length: 40 }, (_, i) => ({ ...r.table.rows[i % 4], entityId: `row${i}`, cells: { ...r.table.rows[i % 4].cells, name: { kind: 'text', value: `国贸楼宇${i}`, sourceIds: [] } } })) } });
}
beforeEach(() => {
  vi.resetAllMocks(); client.reportDelivery.mockResolvedValue(true);
  client.chart.mockImplementation(async (_scope, _id, result, chart) => buildResultChart(result, chart));
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:synthetic'); static revokeObjectURL = vi.fn(); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('shows the requested chart and PNG/SVG download beside a collapsed result, retaining all plotted rows', async () => {
  const result = formal();
  render(<HomeQueryResult result={result} presentation="compact" requestId={requestId} scope={scope} internalExport />);
  await waitFor(() => expect(document.querySelectorAll('rect[data-entity]')).toHaveLength(30));
  fireEvent.click(screen.getByText('下载图表'));
  expect(screen.getByRole('button', { name: '下载 PNG 与来源' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '下载 SVG 与来源' })).toBeEnabled();
  expect(screen.queryByRole('table', { name: '本次结果的完整表格，分页不改变统计范围' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('查看数据明细（40 行）'));
  expect((await screen.findByRole('table', { name: '本次结果的完整表格，分页不改变统计范围' })).querySelectorAll('tbody tr')).toHaveLength(25);
  expect(client.download).not.toHaveBeenCalled();
  const file = { blob: new Blob(['verified transport bytes'], { type: 'application/zip' }), filename: 'chart_png_zip.zip' };
  client.download.mockResolvedValue(file);
  fireEvent.click(screen.getByRole('button', { name: '下载 PNG 与来源' }));
  await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
  expect(client.download).toHaveBeenCalledWith(scope, expect.objectContaining({ requestId, resultId: result.resultId, action: 'export', format: 'png_zip', chart: result.parameters.agentChart && (result.parameters.agentChart as { request: unknown }).request }), expect.any(AbortSignal));
  expect(client.reportDelivery).toHaveBeenCalledWith(scope, file, 'browser_download_dispatched');
  expect(screen.getByText(/已发起图片与来源包下载/)).not.toHaveTextContent('已保存');
});
it('keeps inputs stable and applies field, orientation, sort and legitimate range without altering the source table', async () => {
  const result = formal(), original = structuredClone(result.table), onSource = vi.fn();
  render(<HomeQueryChartWorkspace result={result} requestId={requestId} scope={scope} internalExport onSource={onSource} />);
  await waitFor(() => expect(client.chart).toHaveBeenCalledOnce());
  const details = screen.getByText('调整图表').closest('details')!; details.open = true;
  fireEvent.change(screen.getByLabelText('图表类型'), { target: { value: 'bar' } });
  fireEvent.change(screen.getByLabelText('排序'), { target: { value: 'netEffectiveRent:desc' } });
  fireEvent.click(screen.getByText('高级坐标设置'));
  const input = screen.getByLabelText('数值轴最大值'); input.focus();
  for (const value of ['3', '30', '300']) { fireEvent.change(input, { target: { value } }); expect(document.activeElement).toBe(input); }
  fireEvent.click(screen.getByRole('button', { name: '应用图表配置' }));
  await waitFor(() => expect(client.chart).toHaveBeenCalledTimes(2));
  expect(client.chart.mock.calls[1][3]).toMatchObject({ type: 'bar', yAxis: { max: 300, ticks: 5 }, sort: { field: 'netEffectiveRent', direction: 'desc' } });
  expect(result.table).toEqual(original);
  await waitFor(() => expect(document.querySelector('rect[data-entity]')).not.toBeNull());
  fireEvent.click(document.querySelector('rect[data-entity]')!);
  fireEvent.click(screen.getByRole('button', { name: '查看图元来源' }));
  expect(onSource).toHaveBeenCalledWith(expect.any(Array), expect.stringContaining('国贸楼宇'), expect.any(HTMLButtonElement));
});
it('does not report a saved file or dispatch when a download is revoked and permits retry', async () => {
  render(<HomeQueryChartWorkspace result={formal()} requestId={requestId} scope={scope} internalExport onSource={vi.fn()} />);
  fireEvent.click(screen.getByText('下载图表'));
  await waitFor(() => expect(screen.getByRole('button', { name: '下载 PNG 与来源' })).toBeEnabled());
  client.download.mockRejectedValue(new Error('当前导出资格已撤回。'));
  fireEvent.click(screen.getByRole('button', { name: '下载 PNG 与来源' }));
  await screen.findByText('当前导出资格已撤回。');
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  expect(client.reportDelivery.mock.calls.some(call => call[2] === 'browser_download_dispatched')).toBe(false);
  fireEvent.click(screen.getByText('下载图表'));
  expect(screen.getByRole('button', { name: '下载 PNG 与来源' })).toBeEnabled();
});
