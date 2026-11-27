import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { buildAggregateResult, buildListResult, buildTrendResult } from '@/src/lib/intelligence/query/result';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
import type { AnswerSelection } from '@/src/lib/intelligence/query/answerSelection';
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: { reportDelivery: vi.fn().mockResolvedValue(true), chart: vi.fn() } }));
import { HomeQueryResponse } from '../HomeQueryResponse';
const scope = { actorId: 'owner', effectiveId: 'owner', sessionId: 'session', targetId: null };
afterEach(cleanup);
function lease(known: boolean) {
  const result = resultViewSchema.parse(buildAggregateResult(fixture(), 'rent'));
  result.parameters = { dataDomain: 'lease-research/1', scope: { mode: 'aggregate', source: 'combined', from: known ? '2026-07-01' : '2026-10-01', to: known ? '2026-09-30' : '2026-12-31' } };
  const n = (value: number) => ({ kind: 'number' as const, value: { exact: { numerator: String(value), denominator: '1' }, numeric: value }, sourceIds: [] });
  const unknown = { kind: 'unknown' as const, state: 'missing' as const, reason: 'no_valid_sample', sourceIds: [] };
  result.table = { id: 'lease', columns: [{ key: 'count', label: '成交记录数', unit: 'transaction_count' }, { key: 'area', label: '成交面积', unit: 'm2' }],
    rows: [{ entityId: known ? '2026Q3' : '2026Q4', cells: { count: known ? n(12) : unknown, area: known ? n(23456) : unknown } }] };
  return result;
}
it('renders the selected Q3 alternative and keeps a Q4 unknown check secondary with no data workstation', async () => {
  const q3 = lease(true), q4 = lease(false);
  const selection: AnswerSelection = { version: 'answer-selection/1', task: 'record', status: 'partial', primaryResultId: q3.resultId,
    notice: '当前结果为成交汇总，无法确认最新一笔成交。', results: [{ role: 'alternative', result: q3 }, { role: 'supporting', result: q4 }] };
  const { container } = render(<HomeQueryResponse result={q3} answerSelection={selection} scope={scope} internalExport={false} presentation="expanded" onExpand={() => {}} />);
  expect(screen.getByRole('status')).toHaveTextContent('无法确认最新一笔');
  expect(screen.getByText('替代信息 · 成交汇总')).toBeVisible();
  expect(screen.getByRole('region', { name: '关键结果' })).toHaveTextContent('23,456');
  expect(container.querySelector(`[data-result-id="${q3.resultId}"]`)).toBeVisible();
  expect(container.querySelector(`[data-result-id="${q4.resultId}"]`)).not.toBeVisible();
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('查看辅助依据'));
  await waitFor(() => expect(screen.getByRole('region', { name: '查询数据状态' })).toBeVisible());
  expect(screen.getByRole('region', { name: '查询数据状态' })).toHaveTextContent('暂无可交付统计');
  expect(screen.queryByRole('button', { name: /地图|散点|下一页/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
});
it('renders both verified comparison snapshots and their separate evidence rather than a model table', () => {
  const a = lease(true), b = lease(true);
  b.parameters.scope = { mode: 'aggregate', from: '2026-04-01', to: '2026-06-30' };
  const selection: AnswerSelection = { version: 'answer-selection/1', task: 'comparison', status: 'answered', primaryResultId: a.resultId,
    results: [{ role: 'primary', result: a }, { role: 'comparison', result: b }] };
  render(<HomeQueryResponse result={a} answerSelection={selection} scope={scope} internalExport={false} presentation="expanded" onExpand={() => {}} />);
  expect(screen.getAllByRole('region', { name: '关键结果' })).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: '数据依据' })).toHaveLength(2);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: '共同参与比较的结果' })).toBeVisible();
});
it('shows the authorized dossier fields inline with their own data sources', () => {
  const result = resultViewSchema.parse(buildAggregateResult(fixture(), 'rent'));
  const dossier = resultViewSchema.parse(buildListResult(fixture(), []));
  dossier.parameters = { businessTool: 'query_building_dossier', dataDomain: 'business-research/1' };
  const row = dossier.table.rows[0];
  dossier.table = { id: 'dossier', columns: [{ key: 'name', label: '楼宇', unit: null }, { key: 'address', label: '地址（楼书）', unit: null }],
    rows: [{ ...row, cells: { name: row.cells.name, address: { kind: 'text', value: '合成地址 2 号', sourceIds: [] } } }] };
  const selection: AnswerSelection = { version: 'answer-selection/1', task: 'list', status: 'answered', primaryResultId: result.resultId,
    results: [{ role: 'primary', result }, { role: 'supporting', result: dossier }] };
  render(<HomeQueryResponse result={result} answerSelection={selection} scope={scope} internalExport={false} presentation="expanded" onExpand={() => {}} />);
  expect(screen.getByRole('table')).toHaveTextContent('合成地址 2 号');
  expect(screen.getByRole('heading', { name: '楼宇资料' })).toBeVisible();
  expect(screen.getAllByRole('button', { name: '数据依据' })).toHaveLength(2);
  expect(screen.queryByText('查看辅助依据')).not.toBeInTheDocument();
});
it('keeps a trusted map outcome visible once when formal data owns the result summary', () => {
  const result = resultViewSchema.parse(buildAggregateResult(fixture(), 'rent'));
  result.parameters.responsePresentation = { version: 'response-presentation/1', narrativeRole: 'result_summary' };
  const notice = '本轮未准备地图操作。当前结果无法准备所选操作，尚未打开地图。';
  const answerSelection: AnswerSelection = { version: 'answer-selection/1', task: 'fact', status: 'partial', primaryResultId: result.resultId,
    notice, results: [{ role: 'primary', result }] };
  render(<HomeQueryResponse message={notice} result={result} answerSelection={answerSelection} executionStatus="partial"
    scope={scope} internalExport={false} presentation="expanded" onExpand={() => {}} />);
  expect(screen.getByRole('status')).toHaveTextContent(notice);
  expect(screen.getAllByText(notice)).toHaveLength(1);
  expect(screen.getByRole('region', { name: '核心指标' })).toBeVisible();
});
it('shows the one real dated trend fact after three missing quarters without an empty chart', () => {
  const result = resultViewSchema.parse(buildTrendResult([1, 2, 3, 4].map(quarter => fixture({ year: 2026, quarter: quarter as 1 | 2 | 3 | 4 })), 'rent', 'per_period'));
  for (const row of result.table.rows.slice(0, 3)) row.cells.value = { kind: 'unknown', state: 'missing', reason: 'no_valid_sample', sourceIds: row.cells.value.sourceIds };
  render(<HomeQueryResponse result={result} scope={scope} internalExport={false} presentation="expanded" onExpand={() => {}} />);
  const fact = screen.getByRole('region', { name: '核心指标' });
  expect(fact).toHaveTextContent('2026-Q4');
  expect(fact).not.toHaveTextContent('未知');
  expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  expect(screen.getByText('查看数据明细（4 行）')).toBeVisible();
});
