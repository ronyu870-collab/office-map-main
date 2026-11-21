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
  fireEvent.click(screen.getByRole('button', { name: '下载生成的 Excel' }));
  await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
  expect(client.download).toHaveBeenCalledWith(scope, { requestId, resultId: value.resultId, action: 'export', format: 'xlsx' }, expect.any(AbortSignal));
  expect(client.reportDelivery).toHaveBeenCalledWith(scope, file, 'browser_download_dispatched');
  expect(screen.getByText(/浏览器已发起下载/)).toHaveTextContent('尚未确认文件已实际保存');
});
it('keeps the server-generated state and allows retry when the download is denied or fails', async () => {
  client.download.mockRejectedValue(new Error('无法访问此请求。'));
  render(<HomeQueryResult result={result()} presentation="compact" requestId={requestId} scope={scope} internalExport />);
  fireEvent.click(screen.getByRole('button', { name: '下载生成的 Excel' }));
  await screen.findByText('无法访问此请求。');
  expect(client.reportDelivery).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'browser_download_dispatched');
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '下载生成的 Excel' })).toBeEnabled();
});
