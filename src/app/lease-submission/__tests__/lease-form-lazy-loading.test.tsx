import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  role: 'editor', loads: 0, mounts: 0, unmounts: 0, router: { replace: vi.fn() },
  readProgress: vi.fn<() => Promise<{ targetCount: number; submittedCount: number }>>(),
  readTeam: vi.fn<() => Promise<[]>>(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('next/dynamic', () => ({ default: (load: () => Promise<React.ComponentType<any>>) => {
  const Form = React.lazy(() => { state.loads += 1; return load().then((defaultExport) => ({ default: defaultExport })); });
  return function DeferredForm(props: Record<string, unknown>) { return <React.Suspense fallback={<span>Loading form</span>}><Form {...props} /></React.Suspense>; };
} }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: async () => ({ user: { id: 'synthetic-user' }, displayName: 'Synthetic Person', role: state.role }) }));
vi.mock('@/src/services/leaseTransactionSubmitService', () => ({
  getWeeklyProgress: state.readProgress, getMySubmissions: async () => [], getAllSubmissions: state.readTeam, getAllBrokers: async () => [],
}));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('@/src/components/demo', () => ({ MaskedCell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../components/SubmissionDetailTable', () => ({ SubmissionDetailTable: () => <div>Team rows</div> }));
vi.mock('../components/LeaseTransactionForm', () => ({ LeaseTransactionForm: ({ onClose, userId, mode }: { onClose: () => void; userId: string; mode: string }) => {
  React.useEffect(() => { state.mounts += 1; return () => { state.unmounts += 1; }; }, []);
  return <div role="dialog"><span>{userId}:{mode}</span><button onClick={onClose}>Close form</button></div>;
} }));
vi.mock('@/src/components/ui', () => ({
  AppHeader: ({ title, actions }: { title: React.ReactNode; actions: React.ReactNode }) => <header>{title}{actions}</header>,
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  Dialog: () => null, LoadingState: ({ label }: { label: string }) => <span>{label}</span>,
}));
import LeaseSubmissionPage from '../page';

beforeEach(() => {
  state.role = 'editor'; state.mounts = 0; state.unmounts = 0;
  state.readProgress.mockReset().mockResolvedValue({ targetCount: 2, submittedCount: 0 });
  state.readTeam.mockReset().mockResolvedValue([]);
});
afterEach(cleanup);

describe('lease form deferred mounting', () => {
  it('loads and mounts only when opened, then remounts with the current draft owner after closing', async () => {
    const initialLoads = state.loads;
    render(<LeaseSubmissionPage />);
    await screen.findByText('数据已就绪');
    expect(state.loads).toBe(initialLoads);
    expect(state.mounts).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '新增成交' }));
    await screen.findByText('synthetic-user:create');
    expect(state.loads).toBe(initialLoads + 1);
    expect(state.mounts).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close form' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(state.unmounts).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '新增成交' }));
    await screen.findByText('synthetic-user:create');
    expect(state.mounts).toBe(2);
    expect(state.loads).toBe(initialLoads + 1);
  });

  it('keeps read-only users outside the form loading path', async () => {
    state.role = 'viewer';
    const initialLoads = state.loads;
    render(<LeaseSubmissionPage />);
    await screen.findByText('只读模式');
    expect(screen.queryByRole('button', { name: '新增成交' })).toBeNull();
    expect(state.loads).toBe(initialLoads);
    expect(state.mounts).toBe(0);
  });

  it('shows true personal counts only after reading them and reports readiness while the team request is still pending', async () => {
    let resolveProgress!: (progress: { targetCount: number; submittedCount: number }) => void;
    let resolveTeam!: (rows: []) => void;
    state.readProgress.mockReturnValueOnce(new Promise(resolve => { resolveProgress = resolve; }));
    state.readTeam.mockReturnValueOnce(new Promise(resolve => { resolveTeam = resolve; }));
    render(<LeaseSubmissionPage />);
    const status = within(await screen.findByRole('region', { name: '租赁成交填报状态' }));
    expect(status.getAllByText('读取中…')).toHaveLength(2);
    expect(status.queryByText('0')).not.toBeInTheDocument();
    await act(async () => resolveProgress({ targetCount: 2, submittedCount: 1 }));
    expect(status.getByText('还需 1 条')).toBeVisible();
    expect(status.getByText('0')).toBeVisible();
    expect(status.getByText('数据已就绪')).toBeVisible();
    expect(screen.getByText('正在加载团队成交数据…')).toBeVisible();
    await act(async () => resolveTeam([]));
  });

  it('keeps the successful metric, identifies a failed read, and recovers through the existing retry', async () => {
    state.readProgress.mockRejectedValue(new Error('暂时无法读取周进度'));
    render(<LeaseSubmissionPage />);
    const status = within(await screen.findByRole('region', { name: '租赁成交填报状态' }));
    expect(await status.findByText('数据未完整读取', undefined, { timeout: 2500 })).toBeVisible();
    expect(status.getByText('暂不可用')).toBeVisible();
    expect(status.getByText('0')).toBeVisible();
    expect(status.queryByText('数据已就绪')).not.toBeInTheDocument();
    state.readProgress.mockResolvedValue({ targetCount: 2, submittedCount: 2 });
    fireEvent.click(screen.getByRole('button', { name: '重试加载本周进度' }));
    expect(await status.findByText('本周目标已完成')).toBeVisible();
    expect(status.getByText('数据已就绪')).toBeVisible();
  });
});
