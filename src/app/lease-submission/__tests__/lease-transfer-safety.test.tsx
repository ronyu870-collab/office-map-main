import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  actor: '11111111-1111-4111-8111-111111111111',
  myRows: [] as Record<string, unknown>[],
  readFails: false,
  audit: vi.fn(),
  router: { replace: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: async () => ({ user: { id: state.actor }, displayName: 'Synthetic Person', role: 'editor', session: { access_token: 'synthetic-token' } }) }));
vi.mock('@/src/services/leaseTransactionSubmitService', () => ({
  getWeeklyProgress: async () => ({ targetCount: 2, submittedCount: 0 }),
  getMySubmissions: async () => { if (state.readFails) throw new Error('Synthetic read failure'); return state.myRows; },
  getAllSubmissions: async () => [],
  getAllBrokers: async () => [{ user_id: '22222222-2222-4222-8222-222222222222', name: 'Client display name' }],
}));
vi.mock('@/src/utils/audit', () => ({ logAction: state.audit }));
vi.mock('@/src/components/demo', () => ({ MaskedCell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../components/SubmissionDetailTable', () => ({ SubmissionDetailTable: () => <div>Team rows</div> }));
vi.mock('@/src/components/ui', () => ({
  AppHeader: ({ title, actions }: { title: React.ReactNode; actions: React.ReactNode }) => <header>{title}{actions}</header>,
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => <button type="button" onClick={onClick} disabled={disabled}>{children}</button>,
  Dialog: ({ title, children, footer }: { title: React.ReactNode; children: React.ReactNode; footer: React.ReactNode }) => <div role="dialog">{title}{children}{footer}</div>,
  LoadingState: ({ label }: { label: string }) => <span>{label}</span>,
}));

import LeaseSubmissionPage from '../page';
import { getPendingLeaseTransfers, prepareLeaseTransfer, submitLeaseTransfer } from '@/src/services/leaseTransferService';

const TARGET = '22222222-2222-4222-8222-222222222222';
const RECORD = '55555555-5555-4555-8555-000000000001';
const fetchMock = vi.fn<typeof fetch>();
const row = () => ({ id: RECORD, company: 'Synthetic company', new_building: 'Synthetic Tower', submitter_id: state.actor,
  updated_at: '2026-10-26T00:00:00.123456+00:00', area_sqm: 400 });
const success = (body: string, replayed = false) => {
  const request = JSON.parse(body);
  return Response.json({ success: true, requestId: request.requestId, submissionId: request.submissionId, targetUserId: request.targetUserId,
    targetUserName: 'Verified recipient', updatedAt: '2026-10-27T00:00:00+00:00', transferredAt: '2026-10-27T00:00:00+00:00', replayed });
};

beforeEach(() => {
  state.actor = '11111111-1111-4111-8111-111111111111';
  state.myRows = [row()]; state.readFails = false; state.audit.mockClear();
  localStorage.clear(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openTransfer() {
  await screen.findByRole('button', { name: '转交' });
  fireEvent.click(screen.getByRole('button', { name: '转交' }));
  await screen.findByRole('option', { name: 'Client display name' });
  fireEvent.change(screen.getByLabelText('选择接收人'), { target: { value: TARGET } });
}

describe('lease transfer workspace safety', () => {
  it('locks the target after unknown response and reopens the same request after closing', async () => {
    fetchMock.mockRejectedValueOnce(new Error('synthetic lost response'));
    render(<LeaseSubmissionPage />);
    await openTransfer();
    fireEvent.click(screen.getByRole('button', { name: '确认转交' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('选择接收人')).toBeDisabled();
    const requestId = getPendingLeaseTransfers(state.actor)[0].requestId;
    fireEvent.click(screen.getByRole('button', { name: '稍后确认' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '确认待处理转交 1' }));
    expect(screen.getByLabelText('选择接收人')).toHaveValue(TARGET);
    expect(screen.getByLabelText('选择接收人')).toBeDisabled();
    fetchMock.mockImplementationOnce(async (_url, options) => success(options!.body as string, true));
    fireEvent.click(screen.getByRole('button', { name: '重试确认原操作' }));
    await screen.findByText(/已确认原转交给 Verified recipient 的操作已完成/);
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).requestId).toBe(requestId);
    expect(state.audit.mock.calls.some((call) => call[1] === 'TRANSFER_SUBMISSION')).toBe(false);
  });

  it('recovers an unknown request after reload even when the transferred record is no longer in my list', async () => {
    const pending = prepareLeaseTransfer(state.actor, row(), TARGET);
    fetchMock.mockRejectedValueOnce(new Error('lost response'));
    await expect(submitLeaseTransfer(pending)).rejects.toThrow();
    state.myRows = [];
    render(<LeaseSubmissionPage />);
    await screen.findByText('暂无提交记录');
    fireEvent.click(await screen.findByRole('button', { name: '确认待处理转交 1' }));
    expect(screen.getByText('待确认成交记录')).toBeInTheDocument();
    expect(screen.getByLabelText('选择接收人')).toHaveValue(TARGET);
    fetchMock.mockImplementationOnce(async (_url, options) => success(options!.body as string, true));
    fireEvent.click(screen.getByRole('button', { name: '重试确认原操作' }));
    await screen.findByText(/已确认原转交给 Verified recipient 的操作已完成/);
    expect(getPendingLeaseTransfers(state.actor)).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not relabel an acknowledged transfer as failed when list readback fails', async () => {
    render(<LeaseSubmissionPage />);
    await openTransfer();
    fetchMock.mockImplementationOnce(async (_url, options) => { state.readFails = true; return success(options!.body as string); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认转交' })); });
    await screen.findByText('已确认转交给 Verified recipient。');
    await screen.findByText('提交记录：Synthetic read failure', {}, { timeout: 3000 });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getPendingLeaseTransfers(state.actor)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
