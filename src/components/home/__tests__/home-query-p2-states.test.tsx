import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAggregateResult, buildListResult } from '@/src/lib/intelligence/query/result';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
import { resolveNumericFact } from '@/src/lib/intelligence/query/facts';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';

const client = vi.hoisted(() => ({ capabilities: vi.fn(), submit: vi.fn(), recover: vi.fn(), reportDelivery: vi.fn().mockResolvedValue(true) }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client, queryScopeKey: (scope: { actorId: string }) => scope.actorId }));
vi.mock('../HomeQueryArtifacts', () => ({ HomeQueryArtifacts: () => null }));
import { HomeQuery } from '../HomeQuery';
import { HomeQueryResult } from '../HomeQueryResult';
const scope = { actorId: 'first', effectiveId: 'first', sessionId: 'session', targetId: null };
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function submit() {
  const input = screen.getByRole('textbox');
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: 'CBD有哪些楼' } });
  fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
}
describe('P2 query failure, empty results and recovery lifecycle', () => {
  beforeEach(() => { sessionStorage.clear(); client.capabilities.mockReset().mockResolvedValue({ enabled: true, permissionRevision: 'one', examples: [] }); client.submit.mockReset(); client.recover.mockReset(); });
  afterEach(cleanup);
  it('distinguishes a network failure and retries the same idempotency key', async () => {
    client.submit.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ requestId, status: 'running' });
    render(<HomeQuery scope={scope} />); await submit();
    expect(await screen.findByText(/网络连接中断/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试本次请求' }));
    await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(2));
    expect(client.submit.mock.calls[0][1]).toEqual(client.submit.mock.calls[1][1]);
    expect(await screen.findByText(/服务端仍在处理/)).toBeInTheDocument();
  });
  it('distinguishes a deadline from no data without claiming server cancellation', async () => {
    client.submit.mockRejectedValue(new DOMException('deadline exceeded', 'TimeoutError'));
    render(<HomeQuery scope={scope} />); await submit();
    expect(await screen.findByText(/等待响应超时/)).toHaveTextContent('服务端可能仍在处理');
    expect(screen.queryByText('没有符合条件的楼宇记录')).not.toBeInTheDocument();
  });
  it('does not let the late response of stopped waiting overwrite a later query', async () => {
    let finish!: (value: unknown) => void;
    client.submit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ requestId, status: 'clarification', message: '请补充第二次查询的季度' });
    render(<HomeQuery scope={scope} />); await submit();
    fireEvent.click(screen.getByRole('button', { name: '停止等待' }));
    expect(screen.getByRole('status')).toHaveTextContent('回答可能仍在生成');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '金融街季度租金' } });
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    expect(await screen.findByText('请补充第二次查询的季度')).toBeInTheDocument();
    finish({ requestId, status: 'clarification', message: '过期的第一次回答' });
    await waitFor(() => expect(screen.queryByText('过期的第一次回答')).not.toBeInTheDocument());
    expect(client.submit).toHaveBeenCalledTimes(2);
  });
  it('shows a real empty state without an empty table or a fabricated zero', () => {
    const snapshot = { ...fixture(), rows: [], expectedCount: 0 };
    const result = resultViewSchema.parse(buildListResult(snapshot, []));
    render(<HomeQueryResult result={result} />);
    expect(screen.getByText('没有符合条件的楼宇记录')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('distinguishes missing numeric facts from a valid zero', () => {
    const original = fixture();
    const missing = { ...original, rows: original.rows.map(row => ({ ...row, facts: { ...row.facts, netEffectiveRent: resolveNumericFact('netEffectiveRent', row.id, [], original.period) } })) };
    const result = resultViewSchema.parse(buildAggregateResult(missing, 'rent'));
    const { rerender } = render(<HomeQueryResult result={result} />);
    expect(screen.getByText('有记录，但没有可用的指标数值')).toBeInTheDocument();
    const zero = structuredClone(result);
    const cell = zero.table.rows[0].cells[zero.table.columns[0].key];
    zero.table.rows[0].cells[zero.table.columns[0].key] = { kind: 'number', value: { exact: { numerator: '0', denominator: '1' }, numeric: 0 }, sourceIds: cell.sourceIds };
    rerender(<HomeQueryResult result={zero} />);
    expect(screen.queryByText('有记录，但没有可用的指标数值')).not.toBeInTheDocument();
  });
});
