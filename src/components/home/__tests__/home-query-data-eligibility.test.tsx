import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { buildListResult } from '@/src/lib/intelligence/query/result';
import { resultViewSchema, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
const client = vi.hoisted(() => ({ chart: vi.fn(), download: vi.fn(), reportDelivery: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client }));
import { HomeQueryArtifacts } from '../HomeQueryArtifacts';
import { HomeQueryDataTable } from '../HomeQueryDataTable';
import { SourceOverview } from '../HomeQuerySources';
const scope = { actorId: 'owner', effectiveId: 'owner', sessionId: 'session', targetId: null };
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const unknown = { kind: 'unknown' as const, state: 'missing' as const, reason: 'no_valid_sample', sourceIds: [] };
function leaseResult(available = false): QueryResultView {
  const value = resultViewSchema.parse(buildListResult(fixture(), ['height']));
  value.parameters = { dataDomain: 'lease-research/1', scope: { mode: 'aggregate', source: 'combined', from: '2026-10-01', to: '2026-12-31', groupBy: 'quarter' } };
  value.table.columns = [{ key: 'group', label: '季度', unit: null }, { key: 'count', label: '成交记录数', unit: 'transaction_count' }, { key: 'area', label: '成交面积', unit: 'm2' }];
  const number = { kind: 'number' as const, value: { numeric: 1234, exact: { numerator: '1234', denominator: '1' } }, sourceIds: [] };
  value.table.rows = [{ entityId: 'quarter', cells: { group: { kind: 'text', value: '2026-Q4', sourceIds: [] }, count: available ? number : unknown, area: available ? number : unknown } }];
  value.sources = [];
  return value;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('shows an all-unknown lease state with traceable detail and no inappropriate workbench controls', () => {
  const result = leaseResult();
  render(<><HomeQueryDataTable result={result} requestId={requestId} scope={scope} internalExport onSource={vi.fn()} />
    <HomeQueryArtifacts result={result} requestId={requestId} scope={scope} internalExport onSource={vi.fn()} /></>);
  expect(screen.getByText('该期间暂无可交付统计')).toBeVisible();
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '在地图中查看' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /查看散点图|查看柱状图|下一页/ })).not.toBeInTheDocument();
  expect(screen.getByText('查看原始结果')).toBeInTheDocument();
  expect(client.chart).not.toHaveBeenCalled();
});
it('keeps a small aggregate concise and exposes its original controls on demand', () => {
  render(<HomeQueryDataTable result={leaseResult(true)} requestId={requestId} scope={scope} internalExport onSource={vi.fn()} />);
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  expect(screen.queryByText(/第 1–1 条/)).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: '全选筛选结果' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '表格工具' }));
  expect(screen.getByRole('searchbox', { name: '搜索本次结果' })).toBeVisible();
  expect(screen.getByRole('checkbox', { name: '全选筛选结果' })).toBeVisible();
  expect(screen.queryByRole('link', { name: '在地图中查看' })).not.toBeInTheDocument();
});
it('uses source domain and business period instead of a building-directory fallback', () => {
  const result = leaseResult();
  const { rerender } = render(<SourceOverview result={result} research={null} compact />);
  expect(screen.getByText(/2026-10-01 至 2026-12-31，获权成交记录/)).toBeVisible();
  expect(screen.queryByText(/楼宇目录/)).not.toBeInTheDocument();
  result.parameters = { dataDomain: 'business-research/1' };
  rerender(<SourceOverview result={result} research={null} compact />);
  expect(screen.getByText(/获权业务资料/)).toBeVisible();
  result.parameters = { domain: 'knowledge-research/1', evidenceKind: 'external_public' };
  rerender(<SourceOverview result={result} research={null} compact />);
  expect(screen.getByText(/公开研究来源/)).toBeVisible();
});
