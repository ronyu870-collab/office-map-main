import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildListResult } from '@/src/lib/intelligence/query/result';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
const client = vi.hoisted(() => ({ download: vi.fn(), reportDelivery: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client }));
import { HomeQueryResult } from '../HomeQueryResult';

const scope = { actorId: 'owner', effectiveId: 'owner', sessionId: 'session', targetId: null };
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function result() {
  const raw = buildListResult(fixture(), []);
  return resultViewSchema.parse({ ...raw, parameters: { ...raw.parameters,
    agentExport: { version: 'agent-export/1', format: 'xlsx', singleSheet: false, matchedRows: 40, exportedRows: 40 } },
    table: { ...raw.table, rows: Array.from({ length: 40 }, (_, i) => ({ ...raw.table.rows[i % 4], entityId: 'row' + i })) } });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:synthetic'); static revokeObjectURL = vi.fn(); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  client.reportDelivery.mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('delivers a real download operation beside a collapsed answer; reports dispatch without claiming saved', async () => {
  const value = result(), file = { blob: new Blob(['synthetic downloaded bytes']), filename: 'query.xlsx' };
  client.download.mockResolvedValue(file);
  render(<HomeQueryResult result={value} presentation="compact" requestId={requestId} scope={scope} internalExport />);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(client.download).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '下载 Excel' }));
  await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
  expect(client.download).toHaveBeenCalledWith(scope, { requestId, resultId: value.resultId, action: 'export', format: 'xlsx' }, expect.any(AbortSignal));
  expect(client.reportDelivery).toHaveBeenCalledWith(scope, file, 'browser_download_dispatched');
  expect(screen.getByText('已发起下载')).not.toHaveTextContent('已保存');
});
it('keeps the server-generated state and allows retry when the download is denied or fails', async () => {
  client.download.mockRejectedValue(new Error('无法访问此请求。'));
  render(<HomeQueryResult result={result()} presentation="compact" requestId={requestId} scope={scope} internalExport />);
  fireEvent.click(screen.getByRole('button', { name: '下载 Excel' }));
  await screen.findByText('文件暂不可用或下载失败，请重试。');
  expect(client.reportDelivery).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'browser_download_dispatched');
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '下载 Excel' })).toBeEnabled();
});

it('renders a restored exported list as one attachment and one interactive table without a card per building', () => {
  render(<HomeQueryResult result={result()} requestId={requestId} scope={scope} internalExport />);
  expect(screen.getByRole('searchbox', { name: '搜索本次结果' })).toBeInTheDocument();
  expect(screen.getAllByRole('table')).toHaveLength(1);
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  expect(screen.getAllByRole('button', { name: '下载 Excel' })).toHaveLength(1);
  expect(screen.queryByText(/服务器已生成/)).not.toBeInTheDocument();
  expect(screen.getByText('已找到 40 栋楼宇。')).toBeVisible();
});
