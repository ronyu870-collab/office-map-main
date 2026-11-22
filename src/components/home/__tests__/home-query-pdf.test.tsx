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
    agentReport: { version: 'research-pdf/1', format: 'pdf', purpose: 'internal', generatedAt: new Date().toISOString(), sectionCount: 3, rowCount: 40 } },
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
  const value = result(), file = { blob: new Blob(['synthetic downloaded bytes']), filename: 'query.pdf' };
  client.download.mockResolvedValue(file);
  render(<HomeQueryResult result={value} presentation="compact" requestId={requestId} scope={scope} internalExport />);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(client.download).not.toHaveBeenCalled();
  expect(screen.getByRole('region', { name: '本条回答生成的 PDF 报告' })).toHaveTextContent('PDF');
  expect(screen.queryByText(/符合条件的楼宇共/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '下载 PDF 研究报告' }));
  await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
  expect(client.download).toHaveBeenCalledWith(scope, { requestId, resultId: value.resultId, action: 'export', format: 'pdf' }, expect.any(AbortSignal));
  expect(client.reportDelivery).toHaveBeenCalledWith(scope, file, 'browser_download_dispatched');
  expect(screen.getByText('已发起下载')).not.toHaveTextContent('已保存');
});
it('keeps the server-generated state and allows retry when the download is denied or fails', async () => {
  client.download.mockRejectedValue(new Error('无法访问此请求。'));
  render(<HomeQueryResult result={result()} presentation="compact" requestId={requestId} scope={scope} internalExport />);
  fireEvent.click(screen.getByRole('button', { name: '下载 PDF 研究报告' }));
  await screen.findByText('文件暂不可用或下载失败，请重试。');
  expect(client.reportDelivery).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'browser_download_dispatched');
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '下载 PDF 研究报告' })).toBeEnabled();
});
