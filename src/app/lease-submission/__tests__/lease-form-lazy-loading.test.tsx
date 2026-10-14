import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ role: 'editor', loads: 0, mounts: 0, unmounts: 0, router: { replace: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('next/dynamic', () => ({ default: (load: () => Promise<React.ComponentType<any>>) => {
  const Form = React.lazy(() => { state.loads += 1; return load().then((defaultExport) => ({ default: defaultExport })); });
  return function DeferredForm(props: Record<string, unknown>) { return <React.Suspense fallback={<span>Loading form</span>}><Form {...props} /></React.Suspense>; };
} }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: async () => ({ user: { id: 'synthetic-user' }, displayName: 'Synthetic Person', role: state.role }) }));
vi.mock('@/src/services/leaseTransactionSubmitService', () => ({
  getWeeklyProgress: async () => ({ targetCount: 2, submittedCount: 0 }), getMySubmissions: async () => [], getAllSubmissions: async () => [], getAllBrokers: async () => [],
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

beforeEach(() => { state.role = 'editor'; state.mounts = 0; state.unmounts = 0; });
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
});
