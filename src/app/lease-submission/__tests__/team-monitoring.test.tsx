import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaseTransaction } from '@/src/types/lease-transaction';
import TeamMonitoringPage from '../monitoring/page';
import { aggregateTeamWeeks, calculateTeamWeeks } from '../teamMonitoringStats';

const fixture = vi.hoisted(() => ({ session: vi.fn(), brokers: vi.fn(), records: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => {
  const router = { replace: fixture.replace };
  return { useRouter: () => router };
});
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: fixture.session }));
vi.mock('@/src/services/leaseTransactionSubmitService', () => ({ getAllBrokers: fixture.brokers, getAllSubmissions: fixture.records }));
vi.mock('@/src/components/demo', () => ({
  MaskedText: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  MaskedCell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/AdminLeaseExportButton', () => ({ AdminLeaseExportButton: () => null }));
vi.mock('../components/LeaseTransactionHistoryDrawer', () => ({ LeaseTransactionHistoryDrawer: () => null }));

const brokers = [{ user_id: 'owner', name: '顾问甲' }];
const record: LeaseTransaction = { id: 'row', company: '隔离公司', new_building: '隔离楼宇', submitter_id: 'owner', submitter_name: '顾问甲', transaction_year: 2026, transaction_quarter: 'Q2' };
const session = { user: { id: 'account-a' }, role: 'admin', sessionId: 'a' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  fixture.session.mockReturnValue({ status: 'authenticated', session });
  fixture.brokers.mockResolvedValue(brokers);
  fixture.records.mockResolvedValue([record]);
});
afterEach(cleanup);

describe('团队监控独立明细', () => {
  it('keeps approved detail visible on directory failure and retries only the directory', async () => {
    fixture.brokers.mockRejectedValueOnce(new Error('目录不可用'));
    render(<TeamMonitoringPage />);
    expect(await screen.findByText(record.company!)).toBeVisible();
    const retry = await screen.findByRole('button', { name: '重试人员目录' });
    expect(screen.queryByText('本周达标率')).not.toBeInTheDocument();
    fireEvent.click(retry);
    expect(await screen.findByRole('button', { name: '顾问甲' })).toBeVisible();
    expect(screen.getByText(record.company!)).toBeVisible();
    expect(fixture.brokers).toHaveBeenCalledTimes(2);
    expect(fixture.records).toHaveBeenCalledTimes(1);
  });

  it('retries a failed record read without losing the directory or calling an empty result complete', async () => {
    fixture.records.mockRejectedValueOnce(new Error('明细不可用'));
    render(<TeamMonitoringPage />);
    const retry = await screen.findByRole('button', { name: '重试团队明细' });
    expect(screen.queryByText('本周达标率')).not.toBeInTheDocument();
    expect(screen.queryByText('暂无成交记录')).not.toBeInTheDocument();
    fireEvent.click(retry);
    expect(await screen.findByText(record.company!)).toBeVisible();
    expect(await screen.findByRole('button', { name: '顾问甲' })).toBeVisible();
    expect(fixture.brokers).toHaveBeenCalledTimes(1);
    expect(fixture.records).toHaveBeenCalledTimes(2);
  });

  it('mounts no protected reads for viewer and aborts old reads when the administrator scope changes', async () => {
    const held = deferred<LeaseTransaction[]>();
    fixture.session.mockReturnValue({ status: 'authenticated', session: { ...session, role: 'viewer' } });
    const { rerender } = render(<TeamMonitoringPage />);
    expect(fixture.replace).toHaveBeenCalledWith('/');
    expect(fixture.records).not.toHaveBeenCalled();
    expect(fixture.brokers).not.toHaveBeenCalled();

    fixture.session.mockReturnValue({ status: 'authenticated', session });
    fixture.records.mockReturnValueOnce(held.promise);
    rerender(<TeamMonitoringPage />);
    const oldRecordSignal = fixture.records.mock.calls[0][1].signal as AbortSignal;
    const oldDirectorySignal = fixture.brokers.mock.calls[0][0].signal as AbortSignal;
    fixture.session.mockReturnValue({ status: 'authenticated', session: { ...session, user: { id: 'account-b' }, sessionId: 'b' } });
    rerender(<TeamMonitoringPage />);
    expect(oldRecordSignal.aborted).toBe(true);
    expect(oldDirectorySignal.aborted).toBe(true);
    await act(async () => held.resolve([{ ...record, company: '上一个账号的记录' }]));
    expect(await screen.findByText(record.company!)).toBeVisible();
    expect(screen.queryByText('上一个账号的记录')).not.toBeInTheDocument();
  });
});

describe('团队周统计口径', () => {
  it('counts inclusive local week edges, preserves lifetime totals and excludes only the configured team names', () => {
    const { weeks, currentWeekNumber } = calculateTeamWeeks(new Date(2026, 5, 3));
    const first = weeks[0];
    const second = weeks[1];
    const input = [
      first.startDate.toISOString(), first.endDate.toISOString(), second.startDate.toISOString(),
      new Date(first.startDate.getTime() - 1).toISOString(), 'invalid', undefined,
      new Date(weeks.at(-1)!.endDate.getTime() + 1).toISOString(),
    ].map(created_at => ({ submitter_id: 'owner', created_at }));
    const result = aggregateTeamWeeks([...brokers, { user_id: 'excluded', name: '演示账号' }, { user_id: 'new', name: '新顾问' }],
      [...input, { submitter_id: 'excluded', created_at: first.startDate.toISOString() }], weeks, currentWeekNumber);
    expect(result.map(({ user_id, totalRequired, totalSubmitted, weeklyData }) => ({ user_id, totalRequired, totalSubmitted, weeks: [...weeklyData] }))).toEqual([
      { user_id: 'owner', totalRequired: (currentWeekNumber - 1) * 2, totalSubmitted: 7, weeks: [[1, 2], [2, 1]] },
      { user_id: 'new', totalRequired: (currentWeekNumber - 1) * 2, totalSubmitted: 0, weeks: [] },
    ]);
  });
});
