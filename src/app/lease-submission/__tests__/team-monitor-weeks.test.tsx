import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LeaseTransaction } from '@/src/types/lease-transaction';
import { TeamSubmissionMonitor } from '../components/TeamSubmissionMonitor';

const fixtures = vi.hoisted(() => ({
  rows: [
    { id: 'a', company: '本周甲公司', submitter_id: 'a', submitter_name: '顾问甲', created_at: '2026-11-10T12:00:00Z' },
    { id: 'b', company: '历史乙公司', submitter_id: 'b', submitter_name: '顾问乙', created_at: '2026-10-16T12:00:00Z' },
  ].map((row): LeaseTransaction => ({ ...row, new_building: '测试楼宇', transaction_year: 2026, transaction_quarter: 'Q4' })),
  brokers: [{ user_id: 'a', name: '顾问甲' }, { user_id: 'b', name: '顾问乙' }],
}));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: async () => ({ role: 'admin' }) }));
vi.mock('@/src/services/leaseTransactionSubmitService', () => ({
  getAllBrokers: async () => fixtures.brokers,
  getAllSubmissions: async () => fixtures.rows,
}));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('../components/AdminLeaseExportButton', () => ({ AdminLeaseExportButton: () => null }));
vi.mock('../components/LeaseTransactionHistoryDrawer', () => ({ LeaseTransactionHistoryDrawer: () => null }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('团队监控的周度统计', () => {
  it('returns the weekly table to its start after browsing history and keeps the selected broker details', async () => {
    vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
    const user = userEvent.setup();
    render(<TeamSubmissionMonitor userRole="admin" />);
    const showWeeks = await screen.findByRole('button', { name: '全部周次' });
    const stats = screen.getByRole('region', { name: '周度统计' });
    const scrollIntoView = vi.fn();
    expect(showWeeks).toHaveAttribute('aria-controls', stats.id);
    await user.click(showWeeks);
    const hideWeeks = screen.getByRole('button', { name: '收起各周' });
    expect(hideWeeks).toHaveAttribute('aria-expanded', 'true');
    expect(within(stats).getByRole('columnheader', { name: /第 1 周/ })).toBeVisible();
    stats.scrollLeft = 500;

    // jsdom has no scrollIntoView. Stub only the live detail region target.
    Object.defineProperty(screen.getByRole('region', { name: '成交明细' }), 'scrollIntoView', { value: scrollIntoView });
    await user.click(within(stats).getByRole('button', { name: '顾问甲' }));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: '顾问甲 的成交填报明细' })).toBeVisible();
    expect(screen.getByText('本周甲公司')).toBeVisible();
    expect(screen.queryByText('历史乙公司')).not.toBeInTheDocument();

    await user.click(hideWeeks);
    expect(stats.scrollLeft).toBe(0);
    expect(showWeeks).toHaveAttribute('aria-expanded', 'false');
    expect(showWeeks).toHaveFocus();
    expect(screen.getByRole('heading', { name: '顾问甲 的成交填报明细' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '显示全部' }));
    expect(screen.getByRole('heading', { name: '团队全量明细' })).toBeVisible();
    expect(screen.getByText('历史乙公司')).toBeVisible();
  });
});
