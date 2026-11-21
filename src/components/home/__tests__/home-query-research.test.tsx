import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { completedResearch } from '@/src/lib/intelligence/research/testFixtures';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
const client = vi.hoisted(() => ({ download: vi.fn(), reportDelivery: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client }));
import { HomeQueryResult } from '../HomeQueryResult';
const scope = { actorId: 'owner', effectiveId: 'owner', sessionId: 'session', targetId: null };
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:research'); static revokeObjectURL = vi.fn(); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  client.reportDelivery.mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('delivers selected Office formats in the answer, lazily reveals the complete authorized workset and never claims local save', async () => {
  const run = await completedResearch(), raw = run.checkpoint()!;
  const result = resultViewSchema.parse({ ...raw, parameters: { ...raw.parameters, researchDeliverables: ['docx', 'pptx'],
    agentReport: { version: 'research-output/1', format: 'docx', purpose: 'internal', generatedAt: raw.createdAt, sectionCount: 2, rowCount: 8 } } });
  const file = { blob: new Blob(['download transport fixture']), filename: 'research.docx' }; client.download.mockResolvedValue(file);
  render(<HomeQueryResult result={result} requestId={requestId} scope={scope} internalExport />);
  expect(screen.queryByText('下载 PDF 研究报告')).not.toBeInTheDocument();
  expect(screen.queryByText('下载本次结果')).not.toBeInTheDocument();
  expect(screen.getByText(/已完成 2\/2 个数据步骤/)).toBeInTheDocument();
  expect(client.download).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '下载 Word' }));
  await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
  expect(client.download).toHaveBeenCalledWith(scope, { requestId, resultId: result.resultId, action: 'export', format: 'docx' }, expect.any(AbortSignal));
  expect(client.reportDelivery).toHaveBeenCalledWith(scope, file, 'browser_download_dispatched');
  expect(screen.getByText(/浏览器已发起下载/)).toHaveTextContent('尚未确认文件已实际保存');
  const details = screen.getByText('净有效租金趋势与区域比较', { selector: 'summary' }).parentElement as HTMLDetailsElement;
  details.open = true; fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(screen.getByRole('img', { name: '净有效租金趋势与区域比较图表' })).toBeInTheDocument());
  expect(screen.getAllByText('155.71').length).toBeGreaterThan(0);
});
it('retains file permission errors and suppresses dispatch after a denied download', async () => {
  const raw = (await completedResearch()).checkpoint()!;
  const result = resultViewSchema.parse({ ...raw, parameters: { ...raw.parameters, researchDeliverables: ['pptx'] } });
  client.download.mockRejectedValue(new Error('导出授权已撤销。'));
  render(<HomeQueryResult result={result} requestId={requestId} scope={scope} internalExport />);
  fireEvent.click(screen.getByRole('button', { name: '下载 PowerPoint' }));
  await screen.findByText('导出授权已撤销。'); expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled(); expect(client.reportDelivery).not.toHaveBeenCalled();
});
