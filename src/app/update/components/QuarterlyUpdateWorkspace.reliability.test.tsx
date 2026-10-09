import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  userId: 'synthetic-user', role: 'editor', preview: null as string | null, loggedIn: true, settingsFailure: false, missingSettings: false, supplyFailure: false,
  authCallback: null as ((event: string, session: { user: { id: string } } | null) => void) | null,
  router: { replace: vi.fn() }, rpc: vi.fn(),
  draftRead: vi.fn<(tab: string) => Promise<{ data: unknown; error: unknown }>>(),
  formal: [] as Record<string, unknown>[], reads: [] as Array<{ table: string; filters: Record<string, unknown> }>,
  buildings: [
    { id: 'synthetic-a', name: 'Synthetic Tower A', grade: 'A', submarket: 'CBD', total_area: 1000 },
    { id: 'synthetic-b', name: 'Synthetic Tower B', grade: 'B', submarket: 'CBD', total_area: 2000 },
  ],
}));
vi.mock('next/navigation', () => ({ useRouter: () => state.router, useSearchParams: () => ({ get: () => state.preview }) }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: async () => state.loggedIn ? ({ user: { id: state.userId, email: 'synthetic@example.invalid', user_metadata: { full_name: 'Synthetic Person' } } }) : null }));
vi.mock('@/src/hooks/useBuildings', () => ({ useBuildings: () => ({ buildings: state.buildings, error: null, mutate: vi.fn() }) }));
vi.mock('@/src/contexts/ImpersonationContext', () => ({ useImpersonation: () => ({ isImpersonating: false }) }));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: {
  auth: { onAuthStateChange: (callback: typeof state.authCallback) => { state.authCallback = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; } },
  rpc: (...args: unknown[]) => state.rpc(...args),
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    let range: [number, number] | null = null;
    const resolve = async () => {
      state.reads.push({ table, filters: { ...filters } });
      if (table === 'app_settings' && state.settingsFailure) return { data: null, error: new Error('synthetic settings failure') };
      if (table === 'app_settings' && state.missingSettings) return { data: [], error: null };
      if (table === 'future_supply_assignments' && state.supplyFailure) return { data: null, error: new Error('synthetic assignment failure') };
      if (table === 'update_drafts') return state.draftRead(String(filters.tab));
      let data: unknown = [];
      if (table === 'user_roles') data = filters.user_id === state.userId ? { role: state.role } : { full_name: 'Synthetic Preview' };
      if (table === 'building_assignments') data = state.buildings.map((building) => ({ building_id: building.id }));
      if (table === 'app_settings') data = [{ key: 'current_submission_year', value: '2026' }, { key: 'current_submission_quarter', value: '4' }];
      if (table === 'quarterly_submissions') data = state.formal;
      if (table === 'building_metrics') data = [{ building_id: 'synthetic-a', record_year: 2026, record_quarter: 3, asking_rent: 444, total_area: 1000 }];
      if (range && Array.isArray(data)) data = data.slice(range[0], range[1] + 1);
      return { data, error: null };
    };
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      in: () => query, order: () => query, range: (from: number, to: number) => { range = [from, to]; return query; }, single: resolve, maybeSingle: resolve,
      then: <T,>(fulfilled: (value: Awaited<ReturnType<typeof resolve>>) => T, rejected?: (reason: unknown) => T) => resolve().then(fulfilled, rejected),
    };
    return query;
  },
} }));
vi.mock('@/src/components/ui', () => ({
  AppHeader: ({ title, status, actions }: { title: React.ReactNode; status?: React.ReactNode; actions?: React.ReactNode }) => <header>{title}{status}{actions}</header>,
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  Dialog: ({ open, children, title, footer }: { open: boolean; children: React.ReactNode; title: string; footer?: React.ReactNode }) => open ? <div role="dialog">{title}{children}{footer}</div> : null,
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  ErrorState: ({ title, description }: { title: string; description: string }) => <div><h2>{title}</h2><p>{description}</p></div>,
  LoadingState: ({ label }: { label: string }) => <div>{label}</div>,
}));
import { QuarterlyUpdateWorkspace } from './QuarterlyUpdateWorkspace';

function quoteInputs() { return [...document.querySelectorAll<HTMLInputElement>('input[data-quarterly-field="qQuote"]')]; }
async function ready() {
  await screen.findByRole('button', { name: '甲级' });
  await waitFor(() => expect(state.reads.some((read) => read.table === 'update_drafts')).toBe(true));
}
function draft(quote: string) { return { data: { draft_data: { 'synthetic-a': { qQuote: quote }, 'synthetic-b': { qQuote: quote }, __quarterly_meta__: { version: 2, year: 2026, quarter: 4, revision: 1 } }, revision: 1, updated_at: '2026-10-08T00:00:00.000Z', record_year: 2026, record_quarter: 4 }, error: null }; }

beforeEach(() => {
  state.userId = 'synthetic-user'; state.role = 'editor'; state.preview = null; state.formal = []; state.reads = [];
  state.loggedIn = true; state.settingsFailure = false; state.missingSettings = false; state.supplyFailure = false; state.authCallback = null; state.router.replace.mockClear();
  state.rpc.mockReset().mockImplementation(async (_name: string, args: Record<string, unknown>) => ({ data: [{ revision: Number(args.p_expected_revision ?? 0) + 1, updated_at: '2026-10-08T00:00:00.000Z' }], error: null }));
  state.draftRead.mockReset().mockResolvedValue({ data: null, error: null });
  window.localStorage.clear();
  window.localStorage.setItem('quarterly-client-ack:20261008-v2:synthetic-user', 'saved-closed-legacy-pages');
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('QuarterlyUpdateWorkspace reliability integration', () => {
  it('refuses to switch category after failed save and retains local input', async () => {
    state.rpc.mockResolvedValue({ data: null, error: new Error('offline') });
    render(<QuarterlyUpdateWorkspace />); await ready();
    fireEvent.change(quoteInputs()[0], { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: '乙级' }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Synthetic Person · 甲级')).toBeInTheDocument());
    expect(quoteInputs().every((input) => input.value === '123')).toBe(true);
    expect(state.reads.filter((read) => read.table === 'update_drafts').every((read) => read.filters.tab === 'GradeA')).toBe(true);
  });

  it('keeps a late Grade A response separate from the active Grade B controller', async () => {
    let resolve!: (value: ReturnType<typeof draft>) => void;
    const late = new Promise<ReturnType<typeof draft>>((res) => { resolve = res; });
    state.draftRead.mockImplementation((tab) => tab === 'GradeA' ? late : Promise.resolve(draft('222')));
    render(<QuarterlyUpdateWorkspace />); await ready();
    fireEvent.click(screen.getByRole('button', { name: '乙级' }));
    await waitFor(() => expect(quoteInputs()[0]?.value).toBe('222'));
    await act(async () => { resolve(draft('111')); await late; });
    expect(screen.getByText('Synthetic Person · 乙级')).toBeInTheDocument();
    expect(quoteInputs().every((input) => input.value === '222')).toBe(true);
  });

  it('renders administrator preview as read-only without save or submit actions', async () => {
    state.role = 'admin'; state.preview = 'synthetic-preview';
    window.localStorage.setItem('quarterly-client-ack:20261008-v2:synthetic-preview', 'saved-closed-legacy-pages');
    render(<QuarterlyUpdateWorkspace />); await ready();
    expect(quoteInputs().length).toBeGreaterThan(0);
    expect(quoteInputs().every((input) => input.readOnly)).toBe(true);
    expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交当前分类' })).not.toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '我已保存并关闭其他旧版编辑页面，启用本页编辑' })).not.toBeInTheDocument();
    expect(state.reads.filter((read) => read.table === 'update_drafts').every((read) => read.filters.user_id === 'synthetic-preview')).toBe(true);
  });

  it('does not promote formal submissions or historical metrics into editable current-quarter input', async () => {
    state.formal = [{ building_id: 'synthetic-a', record_year: 2026, record_quarter: 4, asking_rent: 777, created_at: '2026-10-08T00:00:00.000Z' }];
    render(<QuarterlyUpdateWorkspace />); await ready();
    await waitFor(() => expect(state.reads.some((read) => read.table === 'quarterly_submissions')).toBe(true));
    expect(quoteInputs().every((input) => input.value === '')).toBe(true);
    expect(state.rpc).not.toHaveBeenCalled();
    const formalRead = state.reads.find((read) => read.table === 'quarterly_submissions');
    expect(formalRead?.filters).toMatchObject({ user_id: 'synthetic-user', record_year: 2026, record_quarter: 4 });
    fireEvent.click(screen.getByRole('button', { name: '提交当前分类' }));
    fireEvent.click(await screen.findByRole('button', { name: '强行提交已填数据' }));
    await screen.findByText(/当前分类尚未填写数据/);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('autosaves during continuous typing rather than postponing every keystroke', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T00:00:00.000Z'));
    render(<QuarterlyUpdateWorkspace />);
    await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
    expect(screen.getByRole('button', { name: '甲级' })).toBeInTheDocument();
    for (let i = 0; i < 4; i++) {
      fireEvent.change(quoteInputs()[0], { target: { value: String(100 + i) } });
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    }
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc).toHaveBeenLastCalledWith('save_quarterly_draft_v2', expect.objectContaining({ p_draft_data: expect.objectContaining({ 'synthetic-a': { qQuote: '103' } }) }));
    for (let i = 0; i < 4; i++) {
      fireEvent.change(quoteInputs()[0], { target: { value: String(200 + i) } });
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    }
    expect(state.rpc).toHaveBeenCalledTimes(2);
    expect(state.rpc).toHaveBeenLastCalledWith('save_quarterly_draft_v2', expect.objectContaining({ p_expected_revision: 1, p_draft_data: expect.objectContaining({ 'synthetic-a': { qQuote: '203' } }) }));
  });

  it('backs off failed autosaves and retries immediately on the online event', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T00:00:00.000Z'));
    state.rpc.mockResolvedValueOnce({ data: null, error: new Error('offline') }).mockResolvedValueOnce({ data: null, error: new Error('offline') });
    render(<QuarterlyUpdateWorkspace />);
    await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
    fireEvent.change(quoteInputs()[0], { target: { value: '321' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(state.rpc).toHaveBeenCalledTimes(2);
    fireEvent.change(quoteInputs()[0], { target: { value: '654' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(state.rpc).toHaveBeenCalledTimes(2);
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(state.rpc).toHaveBeenCalledTimes(3);
    expect(state.rpc).toHaveBeenLastCalledWith('save_quarterly_draft_v2', expect.objectContaining({ p_draft_data: expect.objectContaining({ 'synthetic-a': { qQuote: '654' } }) }));
    expect(quoteInputs()[0].value).toBe('654');
  });

  it.each(['settingsFailure', 'missingSettings'] as const)('fails closed for %s rather than using the browser quarter', async (failure) => {
    state[failure] = true;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<QuarterlyUpdateWorkspace />);
    await screen.findByText('填报任务加载失败');
    expect(quoteInputs()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交当前分类' })).not.toBeInTheDocument();
    expect(state.reads.some((read) => read.table === 'update_drafts')).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('shows a future-assignment read failure instead of claiming empty successful tasks', async () => {
    state.supplyFailure = true;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<QuarterlyUpdateWorkspace />);
    await screen.findByText('填报任务加载失败');
    expect(screen.queryByText('暂无填报任务')).not.toBeInTheDocument();
    expect(quoteInputs()).toHaveLength(0);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('hides previous account fields on sign-out while preserving scoped recovery data', async () => {
    render(<QuarterlyUpdateWorkspace />); await ready();
    fireEvent.change(quoteInputs()[0], { target: { value: '432' } });
    const localBeforeSignOut = window.localStorage.getItem('quarterly-draft:v1:synthetic-user:2026:Q4:GradeA');
    expect(localBeforeSignOut).toContain('432');
    state.loggedIn = false;
    await act(async () => { state.authCallback?.('SIGNED_OUT', null); });
    expect(quoteInputs()).toHaveLength(0);
    expect(screen.queryByText('Synthetic Tower A')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交当前分类' })).not.toBeInTheDocument();
    expect(state.router.replace).toHaveBeenCalledWith('/login');
    expect(window.localStorage.getItem('quarterly-draft:v1:synthetic-user:2026:Q4:GradeA')).toBe(localBeforeSignOut);
  });

  it('includes owner and property-management fields on the mobile card and preserves numeric zeros in submission', async () => {
    state.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === 'submit_quarterly_batch_v2'
      ? { data: [{ regular_count: 1, future_count: 0, submitted_at: '2026-10-08T00:00:00.000Z' }], error: null }
      : { data: [{ revision: Number(args.p_expected_revision ?? 0) + 1, updated_at: '2026-10-08T00:00:00.000Z' }], error: null });
    render(<QuarterlyUpdateWorkspace />); await ready();
    const mobileRoot = document.querySelector('.md\\:hidden');
    expect(mobileRoot).not.toBeNull();
    const mobile = within(mobileRoot as HTMLElement);
    const owner = mobile.getByLabelText('业主');
    const manager = mobile.getByLabelText('物业', { exact: true });
    fireEvent.change(owner, { target: { value: 'Synthetic Owner' } });
    fireEvent.change(manager, { target: { value: 'Synthetic Manager' } });
    for (const field of ['qQuote', 'qProp', 'qFace', 'qFree', 'qVacArea']) {
      const input = mobileRoot?.querySelector(`[data-quarterly-field="${field}"]`);
      expect(input).not.toBeNull();
      fireEvent.change(input as Element, { target: { value: '0' } });
    }
    fireEvent.click(screen.getByRole('button', { name: '提交当前分类' }));
    await screen.findByText('提交成功');
    const submission = state.rpc.mock.calls.find(([name]) => name === 'submit_quarterly_batch_v2')?.[1];
    expect(submission.p_regular_rows).toEqual([expect.objectContaining({ asking_rent: 0, management_fee: 0, face_rent: 0, rent_free_period: 0, vacant_area: 0, owner: 'Synthetic Owner', property_management: 'Synthetic Manager' })]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('requires explicit confirmation to restore an unconfirmed legacy draft, backs up local edits, and never auto-submits', async () => {
    state.draftRead.mockResolvedValue({ data: { draft_data: { 'synthetic-a': { qQuote: '876' } }, revision: 7, updated_at: '2026-10-08T00:00:00.000Z', record_year: 2026, record_quarter: 4 }, error: null });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<QuarterlyUpdateWorkspace />); await ready();
    const banner = (await screen.findByText('已有草稿已保留，来源待核实')).closest('[role="status"]');
    expect(banner).toHaveTextContent('共 1 个项目条目');
    expect(banner).toHaveTextContent('2026-10-08T00:00:00.000Z');
    expect(banner).toHaveTextContent('报价 876');
    expect(quoteInputs().every((input) => input.value === '')).toBe(true);
    expect(state.rpc).not.toHaveBeenCalled();
    fireEvent.change(quoteInputs()[0], { target: { value: '555' } });
    fireEvent.click(screen.getByRole('button', { name: '查看全部原草稿' }));
    expect(screen.getByText(/原有草稿 2026 Q4/)).toBeInTheDocument();
    expect(screen.getByText(/"qQuote": "876"/)).toBeInTheDocument();
    const restore = screen.getByRole('button', { name: '载入原草稿到编辑区供核对' });
    fireEvent.click(restore);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(quoteInputs().every((input) => input.value === '555')).toBe(true);
    fireEvent.click(restore);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(quoteInputs().every((input) => input.value === '876')).toBe(true);
    const keys = Object.keys(window.localStorage).filter((key) => key.includes(':recovery:') && key.includes(':before-formal-restore:'));
    expect(keys).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem(keys[0])!).value).toEqual({ regular: { 'synthetic-a': { qQuote: '555' } }, future: {} });
    expect(state.rpc.mock.calls.filter(([name]) => name === 'submit_quarterly_batch_v2')).toHaveLength(0);
    expect(screen.queryByText('提交成功')).not.toBeInTheDocument();
  });

  it('keeps unacknowledged editing read-only and autosave blocked until explicit account/release acknowledgement, persisting it on reload', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T00:00:00.000Z'));
    const ackKey = 'quarterly-client-ack:20261008-v2:synthetic-user';
    window.localStorage.removeItem(ackKey);
    window.localStorage.setItem('quarterly-draft:v1:synthetic-user:2026:Q4:GradeA', JSON.stringify({ version: 1, identity: { userId: 'synthetic-user', year: 2026, quarter: 4, tab: 'GradeA' }, payload: { regular: { 'synthetic-a': { qQuote: '321' } }, future: {} }, revision: 1, dirty: true, updatedAt: '2026-10-08T00:00:00.000Z', cachedAt: Date.now() }));
    state.draftRead.mockResolvedValue(draft('987'));
    const first = render(<QuarterlyUpdateWorkspace />);
    await act(async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); });
    expect(quoteInputs()[0].value).toBe('321');
    expect(quoteInputs().every((input) => input.readOnly)).toBe(true);
    fireEvent.change(quoteInputs()[0], { target: { value: '999' } });
    expect(quoteInputs()[0].value).toBe('321');
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '我已保存并关闭其他旧版编辑页面，启用本页编辑' }));
    expect(window.localStorage.getItem(ackKey)).toBe('saved-closed-legacy-pages');
    expect(quoteInputs().every((input) => !input.readOnly)).toBe(true);
    expect(state.rpc).not.toHaveBeenCalled();
    first.unmount();
    render(<QuarterlyUpdateWorkspace />);
    await act(async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); });
    expect(quoteInputs()[0].value).toBe('321');
    expect(quoteInputs().every((input) => !input.readOnly)).toBe(true);
    expect(screen.queryByRole('button', { name: '我已保存并关闭其他旧版编辑页面，启用本页编辑' })).not.toBeInTheDocument();
  });

  it('does not inherit another account acknowledgement on a shared browser', async () => {
    state.userId = 'synthetic-other-account';
    render(<QuarterlyUpdateWorkspace />); await ready();
    expect(window.localStorage.getItem('quarterly-client-ack:20261008-v2:synthetic-user')).toBe('saved-closed-legacy-pages');
    expect(quoteInputs().every((input) => input.readOnly)).toBe(true);
    expect(screen.getByRole('button', { name: '我已保存并关闭其他旧版编辑页面，启用本页编辑' })).toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('quarterly-client-ack:20261008-v2:synthetic-other-account')).toBeNull();
  });

});
