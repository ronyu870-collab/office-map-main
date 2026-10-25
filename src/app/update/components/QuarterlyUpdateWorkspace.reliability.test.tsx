import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  userId: 'synthetic-user', role: 'editor', preview: null as string | null, loggedIn: true, settingsFailure: false, missingSettings: false, supplyFailure: false,
  impersonating: false, year: 2026, quarter: 4,
  authCallback: null as ((event: string, session: { user: { id: string } } | null) => void) | null,
  router: { replace: vi.fn() }, rpc: vi.fn(),
  draftRead: vi.fn<(tab: string) => Promise<{ data: unknown; error: unknown }>>(),
  assignmentRead: vi.fn<() => Promise<void>>(),
  formal: [] as Record<string, unknown>[], reads: [] as Array<{ table: string; filters: Record<string, unknown> }>,
  metrics: [] as Record<string, unknown>[],
  buildings: [
    { id: 'synthetic-a', name: 'Synthetic Tower A', grade: 'A', submarket: 'CBD', total_area: 1000 },
    { id: 'synthetic-b', name: 'Synthetic Tower B', grade: 'B', submarket: 'CBD', total_area: 2000 },
    { id: 'synthetic-bp', name: 'Synthetic Business Park', grade: 'BP', submarket: '亦庄', total_area: 3000 },
  ],
}));
vi.mock('next/navigation', () => ({ useRouter: () => state.router, useSearchParams: () => ({ get: () => state.preview }) }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: async () => state.loggedIn ? ({ user: { id: state.userId, email: 'synthetic@example.invalid', user_metadata: { full_name: 'Synthetic Person' } } }) : null }));
vi.mock('@/src/hooks/useBuildings', () => ({ useBuildings: () => ({ buildings: state.buildings, error: null, mutate: vi.fn() }) }));
vi.mock('@/src/contexts/ImpersonationContext', () => ({ useImpersonation: () => ({ isImpersonating: state.impersonating }) }));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: {
  auth: { onAuthStateChange: (callback: typeof state.authCallback) => { state.authCallback = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; } },
  rpc: (...args: unknown[]) => state.rpc(...args),
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    let range: [number, number] | null = null;
    const resolve = async () => {
      state.reads.push({ table, filters: { ...filters } });
      if (table === 'building_assignments') await state.assignmentRead();
      if (table === 'app_settings' && state.settingsFailure) return { data: null, error: new Error('synthetic settings failure') };
      if (table === 'app_settings' && state.missingSettings) return { data: [], error: null };
      if (table === 'future_supply_assignments' && state.supplyFailure) return { data: null, error: new Error('synthetic assignment failure') };
      if (table === 'update_drafts') return state.draftRead(String(filters.tab));
      let data: unknown = [];
      if (table === 'user_roles') data = filters.user_id === state.userId ? { role: state.role } : { full_name: 'Synthetic Preview' };
      if (table === 'building_assignments') data = state.buildings.map((building) => ({ building_id: building.id }));
      if (table === 'app_settings') data = [{ key: 'current_submission_year', value: String(state.year) }, { key: 'current_submission_quarter', value: String(state.quarter) }];
      if (table === 'quarterly_submissions') data = state.formal;
      if (table === 'building_metrics') data = state.metrics;
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
import { legacyReferencePreferenceKey } from '../quarterlyLegacyReferencePreference';

function quoteInputs() { return [...document.querySelectorAll<HTMLInputElement>('input[data-quarterly-field="qQuote"]')]; }
async function ready() {
  await screen.findByRole('button', { name: '甲级' });
  await waitFor(() => expect(state.reads.some((read) => read.table === 'update_drafts')).toBe(true));
}
function openRecovery() {
  fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
  const summary = screen.queryByText(/原有草稿 \d{4} Q\d/);
  if (summary && !summary.closest('details')?.open) fireEvent.click(summary);
}
function draft(quote: string) { return { data: { draft_data: { 'synthetic-a': { qQuote: quote }, 'synthetic-b': { qQuote: quote }, __quarterly_meta__: { version: 2, year: 2026, quarter: 4, revision: 1 } }, revision: 1, updated_at: '2026-10-08T00:00:00.000Z', record_year: 2026, record_quarter: 4 }, error: null }; }

beforeEach(() => {
  state.userId = 'synthetic-user'; state.role = 'editor'; state.preview = null; state.formal = []; state.reads = [];
  state.metrics = [{ building_id: 'synthetic-a', record_year: 2026, record_quarter: 3, asking_rent: 444, total_area: 1000 }];
  state.impersonating = false; state.year = 2026; state.quarter = 4;
  state.loggedIn = true; state.settingsFailure = false; state.missingSettings = false; state.supplyFailure = false; state.authCallback = null; state.router.replace.mockClear();
  state.rpc.mockReset().mockImplementation(async (_name: string, args: Record<string, unknown>) => ({ data: [{ revision: Number(args.p_expected_revision ?? 0) + 1, updated_at: '2026-10-08T00:00:00.000Z' }], error: null }));
  state.draftRead.mockReset().mockResolvedValue({ data: null, error: null });
  state.assignmentRead.mockReset().mockResolvedValue(undefined);
  window.localStorage.clear();
  window.localStorage.setItem('quarterly-client-ack:20261008-v2:synthetic-user', 'saved-closed-legacy-pages');
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('QuarterlyUpdateWorkspace reliability integration', () => {
  it('loads the authoritative period in parallel with assignments and waits for both before opening drafts', async () => {
    let release!: () => void;
    state.assignmentRead.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    render(<QuarterlyUpdateWorkspace />);
    await waitFor(() => expect(state.reads.some((read) => read.table === 'future_supply_assignments')).toBe(true));
    expect(state.assignmentRead).toHaveBeenCalled();
    expect(state.reads.some((read) => read.table === 'update_drafts')).toBe(false);
    expect(quoteInputs()).toHaveLength(0);
    await act(async () => { release(); });
    await ready();
    expect(quoteInputs().length).toBeGreaterThan(0);
  });

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
    expect(screen.queryByRole('button', { name: '开始填写' })).not.toBeInTheDocument();
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
    openRecovery();
    const banner = (await screen.findByText('历史草稿')).closest('[role="status"]');
    expect(banner).toHaveTextContent('1 个项目');
    expect(screen.getByText(/原稿保存时间：2026-10-08T00:00:00.000Z/)).toBeInTheDocument();
    expect(banner).toHaveTextContent('报价 876');
    expect(quoteInputs().every((input) => input.value === '')).toBe(true);
    expect(state.rpc).not.toHaveBeenCalled();
    fireEvent.change(quoteInputs()[0], { target: { value: '555' } });
    expect(screen.getByText(/原有草稿 2026 Q4/)).toBeInTheDocument();
    expect(screen.getByText(/"qQuote": "876"/)).toBeInTheDocument();
    const restore = screen.getByRole('button', { name: '载入草稿' });
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
    fireEvent.click(screen.getByRole('button', { name: '开始填写' }));
    expect(window.localStorage.getItem(ackKey)).toBe('saved-closed-legacy-pages');
    expect(quoteInputs().every((input) => !input.readOnly)).toBe(true);
    expect(state.rpc).not.toHaveBeenCalled();
    first.unmount();
    render(<QuarterlyUpdateWorkspace />);
    await act(async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); });
    expect(quoteInputs()[0].value).toBe('321');
    expect(quoteInputs().every((input) => !input.readOnly)).toBe(true);
    expect(screen.queryByRole('button', { name: '开始填写' })).not.toBeInTheDocument();
  });

  it('does not inherit another account acknowledgement on a shared browser', async () => {
    state.userId = 'synthetic-other-account';
    render(<QuarterlyUpdateWorkspace />); await ready();
    expect(window.localStorage.getItem('quarterly-client-ack:20261008-v2:synthetic-user')).toBe('saved-closed-legacy-pages');
    expect(quoteInputs().every((input) => input.readOnly)).toBe(true);
    expect(screen.getByRole('button', { name: '开始填写' })).toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('quarterly-client-ack:20261008-v2:synthetic-other-account')).toBeNull();
  });

  it.each(['owner', 'preview'] as const)('shows a revision-zero legacy draft without a read failure in %s mode', async (mode) => {
    if (mode === 'preview') { state.role = 'admin'; state.preview = 'synthetic-preview'; }
    window.localStorage.clear();
    const legacy = draft('321');
    legacy.data.revision = 0;
    delete (legacy.data.draft_data as Record<string, unknown>).__quarterly_meta__;
    state.draftRead.mockResolvedValue(legacy);
    render(<QuarterlyUpdateWorkspace />); await ready();
    openRecovery();
    await screen.findByText('历史草稿');
    expect(screen.queryByText('云端草稿读取失败；已保留本页及本机副本，重试读取后才能同步。')).not.toBeInTheDocument();
    expect(quoteInputs().every((input) => input.value === '' && input.readOnly)).toBe(true);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.reads.filter((read) => read.table === 'update_drafts').every((read) => read.filters.user_id === (mode === 'preview' ? 'synthetic-preview' : state.userId))).toBe(true);
    if (mode === 'preview') {
      expect(screen.queryByRole('button', { name: '载入草稿' })).not.toBeInTheDocument();
    } else {
      fireEvent.click(screen.getByRole('button', { name: '开始填写' }));
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      fireEvent.click(await screen.findByRole('button', { name: '载入草稿' }));
      expect(quoteInputs().every((input) => input.value === '321')).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
      await waitFor(() => expect(state.rpc).toHaveBeenCalledWith('save_quarterly_draft_v2', expect.objectContaining({ p_user_id: state.userId, p_expected_revision: 0 })));
    }
  });

});


describe('recovery boundary regressions', () => {
  it.each(['unacknowledged', 'viewer'])('lets %s users navigate dirty recovery without writing or losing edits', async (mode) => {
    if (mode === 'viewer') state.role = 'viewer';
    else window.localStorage.removeItem('quarterly-client-ack:20261008-v2:synthetic-user');
    const key = 'quarterly-draft:v1:synthetic-user:2026:Q4:GradeA';
    const payload = { regular: { 'synthetic-a': { qQuote: '321' } }, future: {} };
    window.localStorage.setItem(key, JSON.stringify({ version: 1, identity: { userId: state.userId, year: 2026, quarter: 4, tab: 'GradeA' }, payload, revision: 0, dirty: true, updatedAt: null, cachedAt: Date.now() }));
    render(<QuarterlyUpdateWorkspace />); await ready();
    await waitFor(() => expect(quoteInputs()[0].value).toBe('321'));
    fireEvent.click(screen.getByRole('button', { name: '乙级' }));
    await screen.findByText('Synthetic Person · 乙级');
    expect(quoteInputs().every((input) => input.readOnly)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '甲级' }));
    await screen.findByText('Synthetic Person · 甲级');
    expect(quoteInputs()[0].value).toBe('321');
    expect(JSON.parse(window.localStorage.getItem(key)!).payload).toEqual(payload);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('leaves and reenters admin preview with the correct owner and no preview writes', async () => {
    state.role = 'admin'; state.preview = 'synthetic-preview';
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const view = render(<QuarterlyUpdateWorkspace />); await ready();
    expect(quoteInputs().every((input) => input.readOnly)).toBe(true);
    expect(setItem).not.toHaveBeenCalled(); expect(removeItem).not.toHaveBeenCalled();
    state.preview = null; view.rerender(<QuarterlyUpdateWorkspace />);
    await screen.findByRole('button', { name: '保存草稿' });
    expect(quoteInputs().every((input) => !input.readOnly)).toBe(true);
    expect(screen.queryByText(/管理员预览模式/)).not.toBeInTheDocument();
    fireEvent.change(quoteInputs()[0], { target: { value: '123' } });
    const ownerCache = window.localStorage.getItem('quarterly-draft:v1:synthetic-user:2026:Q4:GradeA');
    setItem.mockClear(); removeItem.mockClear();
    state.preview = 'synthetic-preview'; view.rerender(<QuarterlyUpdateWorkspace />);
    await screen.findByText(/管理员预览模式/);
    expect(quoteInputs().every((input) => input.readOnly && input.value === '')).toBe(true);
    expect(setItem).not.toHaveBeenCalled(); expect(removeItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('quarterly-draft:v1:synthetic-user:2026:Q4:GradeA')).toBe(ownerCache);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each([{ 'synthetic-a': null }, { __futureSupply__: { 'synthetic-future': null } }, { 'synthetic-a': { qQuote: { bad: 'nested' } } }])('quarantines malformed legacy rows without crashing or normalizing them %#', async (draft_data) => {
    state.draftRead.mockResolvedValue({ data: { draft_data, revision: 0, record_year: 2026, record_quarter: 3, updated_at: '2026-10-08T00:00:00Z' }, error: null });
    render(<QuarterlyUpdateWorkspace />); await ready();
    await screen.findAllByText(/云端草稿格式异常/);
    expect(quoteInputs().every((input) => input.readOnly && input.value === '')).toBe(true);
    expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '载入草稿' })).not.toBeInTheDocument();
    openRecovery();
    expect(screen.getByText('格式异常的原始草稿（已隔离，未覆盖）').parentElement).toHaveTextContent(JSON.stringify(draft_data, null, 2).replace(/\s+/g, ' '));
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each([null, {}, { 'synthetic-a': { qQuote: 0, qFree: '0', qRemark: null }, __quarterly_meta__: null }, { __futureSupply__: { 'synthetic-future': { qQuote: 0 } } }, { __futureSupply__: null }])('retains compatible legacy empty, metadata and zero shapes %#', async (draft_data) => {
    state.draftRead.mockResolvedValue({ data: { draft_data, revision: 0, record_year: 2026, record_quarter: 3, updated_at: '2026-10-08T00:00:00Z' }, error: null });
    render(<QuarterlyUpdateWorkspace />); await ready();
    openRecovery();
    await screen.findByText('历史草稿');
    expect(screen.queryByText(/云端草稿格式异常/)).not.toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each([false, true])('never clears another category pending immutable submission, pointerPending=%s', async (pointerPending) => {
    const key = 'quarterly-draft:v1:synthetic-user:2026:Q4:GradeB:submission';
    const batch = { p_user_id: state.userId, p_year: 2026, p_quarter: 4, p_tab: 'GradeB', p_regular_rows: [], p_future_rows: [] };
    const pending = { requestId: 'pending', batch };
    window.localStorage.setItem(key, JSON.stringify(pointerPending ? pending : { requestId: 'acknowledged', batch, receipt: { regular_count: 0, future_count: 0, submitted_at: '2026-10-08T00:00:00Z' } }));
    window.localStorage.setItem(key + ':request:pending', JSON.stringify(pending));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<QuarterlyUpdateWorkspace />); await ready();
    openRecovery();
    fireEvent.click(screen.getByRole('button', { name: '清除此账号本机恢复历史' }));
    expect(window.localStorage.getItem(key + ':request:pending')).toBe(JSON.stringify(pending));
    expect(confirm).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe('recovery cleanup confirmation boundaries', () => {
  it('rechecks pending requests created by another window during confirmation', async () => {
    const key = 'quarterly-draft:v1:synthetic-user:2026:Q4:GradeB:submission:request:new-pending';
    vi.spyOn(window, 'confirm').mockImplementation(() => {
      window.localStorage.setItem(key, JSON.stringify({ requestId: 'new-pending', batch: { p_user_id: state.userId, p_year: 2026, p_quarter: 4, p_tab: 'GradeB', p_regular_rows: [], p_future_rows: [] } }));
      return true;
    });
    render(<QuarterlyUpdateWorkspace />); await ready();
    const current = 'quarterly-draft:v1:synthetic-user:2026:Q4:GradeA';
    await waitFor(() => expect(window.localStorage.getItem(current)).not.toBeNull());
    const original = window.localStorage.getItem(current);
    openRecovery();
    fireEvent.click(screen.getByRole('button', { name: '清除此账号本机恢复历史' }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(key)).not.toBeNull();
    expect(window.localStorage.getItem(current)).toBe(original);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('warns and retains every account recovery copy when an unknown record is found', async () => {
    const key = 'quarterly-draft:v1:synthetic-user:2026:Q4:GradeB:unknown';
    window.localStorage.setItem(key, '{}');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<QuarterlyUpdateWorkspace />); await ready();
    openRecovery();
    fireEvent.click(screen.getByRole('button', { name: '清除此账号本机恢复历史' }));
    expect(screen.getByText(/无法确认本机恢复副本状态/)).toBeInTheDocument();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(key)).toBe('{}');
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

function legacyDraft() {
  return { data: { draft_data: { 'synthetic-a': { qQuote: '876' }, 'synthetic-b': { qQuote: '765' }, 'synthetic-bp': { qQuote: '654' } }, revision: 0, updated_at: '2026-06-12T08:30:00.000Z', record_year: 2026, record_quarter: 3 }, error: null };
}
function preferenceKey(tab = 'GradeA') {
  const original = legacyDraft().data;
  return legacyReferencePreferenceKey({ userId: state.userId, year: state.year, quarter: state.quarter, tab }, { payload: { regular: original.draft_data, future: {} }, revision: original.revision, updatedAt: original.updated_at, year: original.record_year, quarter: original.record_quarter })!;
}
async function referenceReady() { await ready(); openRecovery(); await screen.findByRole('status', { name: '原草稿参考提示' }); }
function ignoreReference() { fireEvent.click(screen.getByRole('button', { name: '暂不使用' })); }
function expectReferenceRemoved() {
  const back = screen.queryByRole('button', { name: '返回填写' });
  if (back) fireEvent.click(back);
  expect(screen.queryByRole('status', { name: '原草稿参考提示' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '季度记录与恢复' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '填报提示' })).not.toBeInTheDocument();
  expect(screen.queryByText(/原草稿已载入供核对|本季度已忽略这份原草稿|原草稿提示已收起/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '历史记录' })).toBeInTheDocument();
}
const referenceCategories = [
  { tab: 'GradeA', label: '甲级', quote: '876' },
  { tab: 'GradeB', label: '乙级', quote: '765' },
  { tab: 'BP', label: '产业园', quote: '654' },
];
async function selectReferenceCategory(label: string) {
  await ready();
  if (label !== '甲级') fireEvent.click(screen.getByRole('button', { name: label }));
  await screen.findByText(`Synthetic Person · ${label}`);
  await waitFor(() => expect(quoteInputs().length).toBeGreaterThan(0));
}

describe('legacy reference banner choices', () => {
  beforeEach(() => { state.draftRead.mockResolvedValue(legacyDraft()); });

  it.each(referenceCategories.flatMap((category) => [true, false].map((empty) => ({ ...category, empty }))))('keeps $tab filling clear with empty=$empty history and opens recovery only on request', async ({ label, empty }) => {
    if (empty) state.draftRead.mockResolvedValue({ data: { ...legacyDraft().data, draft_data: {} }, error: null });
    render(<QuarterlyUpdateWorkspace />); await selectReferenceCategory(label);
    expectReferenceRemoved();
    expect(screen.queryByText(/正式记录覆盖|覆盖表示存在提交记录|已有草稿已保留|保存时间不代表/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '导出备份' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '提交当前分类' })).toBeEnabled();
    openRecovery();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '原草稿参考提示' })).toHaveTextContent(empty ? '0 个项目' : '3 个项目');
    expect(screen.getByRole('button', { name: '导出备份' })).toBeEnabled();
    expect(screen.getByText(/原有草稿 2026 Q3/)).toBeInTheDocument();
    expect(quoteInputs().every((input) => input.value === '')).toBe(true);
    expect(state.rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '返回填写' }));
    expectReferenceRemoved();
  });

  it.each(referenceCategories)('removes the entire $tab banner only after a successful confirmed restore, including on reload', async ({ tab, label, quote }) => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const view = render(<QuarterlyUpdateWorkspace />); await selectReferenceCategory(label);
    openRecovery();
    const banner = await screen.findByRole('status', { name: '原草稿参考提示' });
    fireEvent.click(screen.getByRole('button', { name: '载入草稿' }));
    expect(banner).toBeInTheDocument();
    expect(window.localStorage.getItem(preferenceKey(tab))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '载入草稿' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(quoteInputs().every((input) => input.value === quote)).toBe(true);
    expect(banner).not.toBeInTheDocument();
    expectReferenceRemoved();
    expect(screen.queryByText(/原有草稿 2026 Q3/)).not.toBeInTheDocument();
    expect(window.localStorage.getItem(preferenceKey(tab))).toContain('restored');
    expect(state.rpc).not.toHaveBeenCalled();
    view.unmount(); render(<QuarterlyUpdateWorkspace />); await selectReferenceCategory(label);
    openRecovery();
    await screen.findByText(/原有草稿 2026 Q3/);
    expect(quoteInputs().every((input) => input.value === quote)).toBe(true);
    expect(JSON.parse(screen.getByText(/"qQuote": "876"/).textContent!)).toEqual({ ...legacyDraft().data.draft_data, __futureSupply__: {} });
    expect(screen.getByRole('button', { name: '载入草稿' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '返回填写' }));
    expectReferenceRemoved();
  });

  it.each(referenceCategories)('removes the entire ignored $tab banner without saving, deleting or filling any draft, including on reload', async ({ tab, label }) => {
    const view = render(<QuarterlyUpdateWorkspace />); await selectReferenceCategory(label);
    openRecovery();
    const banner = await screen.findByRole('status', { name: '原草稿参考提示' });
    const before = Object.fromEntries(Object.entries(window.localStorage));
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    ignoreReference();
    expect(quoteInputs().every((input) => input.value === '')).toBe(true);
    expect(banner).not.toBeInTheDocument();
    expectReferenceRemoved();
    for (const [key, value] of Object.entries(before)) expect(window.localStorage.getItem(key)).toBe(value);
    expect(window.localStorage.getItem(preferenceKey(tab))).toContain('ignored');
    expect(remove).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(state.rpc).not.toHaveBeenCalled();
    view.unmount(); render(<QuarterlyUpdateWorkspace />); await selectReferenceCategory(label);
    openRecovery();
    await screen.findByText(/原有草稿 2026 Q3/);
    expect(quoteInputs().every((input) => input.value === '')).toBe(true);
    expect(JSON.parse(screen.getByText(/"qQuote": "876"/).textContent!)).toEqual({ ...legacyDraft().data.draft_data, __futureSupply__: {} });
    expect(screen.getByText(/原稿保存时间：2026-06-12T08:30:00.000Z/)).toHaveTextContent('保存时间不代表数据所属季度');
    expect(screen.getByRole('button', { name: '载入草稿' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '返回填写' }));
    expectReferenceRemoved();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('ignores the reference without changing dirty current input, its saved recovery or dirty state', async () => {
    render(<QuarterlyUpdateWorkspace />); await referenceReady();
    fireEvent.change(quoteInputs()[0], { target: { value: '555' } });
    const key = 'quarterly-draft:v1:synthetic-user:2026:Q4:GradeA';
    const before = window.localStorage.getItem(key);
    expect(JSON.parse(before!).dirty).toBe(true);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    expect(screen.getByText('暂不使用会保留草稿，当前填写不变。')).toBeInTheDocument();
    ignoreReference();
    expect(quoteInputs().every((input) => input.value === '555')).toBe(true);
    expect(window.localStorage.getItem(key)).toBe(before);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes).toHaveBeenCalledWith(preferenceKey(), JSON.stringify({ version: 1, disposition: 'ignored' }));
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('keeps choices separate between categories and restores the choice when switching back', async () => {
    render(<QuarterlyUpdateWorkspace />); await referenceReady(); ignoreReference();
    fireEvent.click(screen.getByRole('button', { name: '乙级' }));
    openRecovery();
    await screen.findByRole('status', { name: '原草稿参考提示' });
    expect(screen.getByText('Synthetic Person · 乙级')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '甲级' }));
    await screen.findByText('Synthetic Person · 甲级');
    expectReferenceRemoved();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it.each(['account', 'year', 'quarter'] as const)('does not inherit another %s choice on remount', async (scope) => {
    const first = render(<QuarterlyUpdateWorkspace />); await referenceReady(); ignoreReference(); first.unmount();
    if (scope === 'account') state.userId = 'synthetic-other';
    if (scope === 'year') state.year = 2027;
    if (scope === 'quarter') state.quarter = 3;
    render(<QuarterlyUpdateWorkspace />); await referenceReady();
    expect(screen.queryByRole('status', { name: '原草稿快捷入口' })).not.toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it.each(['revision', 'updated_at', 'record_year', 'record_quarter'] as const)('shows a new source when %s changes, including a replaced revision-zero legacy draft', async (field) => {
    const first = render(<QuarterlyUpdateWorkspace />); await referenceReady(); ignoreReference(); first.unmount();
    const next = legacyDraft();
    if (field === 'updated_at') next.data.updated_at = '2026-06-13T08:30:00.000Z';
    else next.data[field] += 1;
    state.draftRead.mockResolvedValue(next);
    render(<QuarterlyUpdateWorkspace />); await referenceReady();
    expect(screen.queryByRole('status', { name: '原草稿快捷入口' })).not.toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it.each(['preview', 'impersonation', 'viewer'] as const)('allows only an in-memory collapse for %s, with no preference writes or RPCs', async (mode) => {
    if (mode === 'preview') { state.role = 'admin'; state.preview = 'synthetic-preview'; }
    if (mode === 'impersonation') state.impersonating = true;
    if (mode === 'viewer') state.role = 'viewer';
    const view = render(<QuarterlyUpdateWorkspace />); await referenceReady();
    const before = Object.fromEntries(Object.entries(window.localStorage));
    const setItem = vi.spyOn(Storage.prototype, 'setItem'); const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    expect(screen.queryByRole('button', { name: '载入草稿' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '暂不使用' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起提示' }));
    expectReferenceRemoved();
    openRecovery();
    expect(screen.getByText(/"qQuote": "876"/)).toBeInTheDocument();
    expect(quoteInputs().every((input) => input.readOnly && input.value === '')).toBe(true);
    expect(Object.fromEntries(Object.entries(window.localStorage))).toEqual(before);
    expect(setItem).not.toHaveBeenCalled(); expect(removeItem).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
    view.unmount(); render(<QuarterlyUpdateWorkspace />); await referenceReady();
    expect(screen.queryByRole('status', { name: '原草稿快捷入口' })).not.toBeInTheDocument();
  });

  it('never dismisses or grants the separate old-tab editing acknowledgement', async () => {
    const ackKey = 'quarterly-client-ack:20261008-v2:synthetic-user'; window.localStorage.removeItem(ackKey);
    render(<QuarterlyUpdateWorkspace />); await referenceReady(); ignoreReference();
    expect(screen.getByRole('region', { name: '新版编辑安全确认' })).toBeInTheDocument();
    expect(window.localStorage.getItem(ackKey)).toBeNull();
    expect(quoteInputs().every((input) => input.readOnly)).toBe(true);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('keeps the reference expanded if restore cannot safely preserve current work', async () => {
    render(<QuarterlyUpdateWorkspace />); await referenceReady();
    fireEvent.change(quoteInputs()[0], { target: { value: '555' } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    fireEvent.click(screen.getByRole('button', { name: '载入草稿' }));
    expect(screen.getByRole('status', { name: '原草稿参考提示' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('恢复版本无法保存');
    expect(quoteInputs().every((input) => input.value === '555')).toBe(true);
    expect(window.localStorage.getItem(preferenceKey())).toBeNull(); expect(state.rpc).not.toHaveBeenCalled();
  });

  it('tolerates malformed preferences without hiding references or deleting the bad value', async () => {
    window.localStorage.setItem(preferenceKey(), 'broken');
    render(<QuarterlyUpdateWorkspace />); await referenceReady();
    expect(window.localStorage.getItem(preferenceKey())).toBe('broken');
    expect(screen.getByText(/原稿保存时间：2026-06-12T08:30:00.000Z/)).toBeInTheDocument();
  });

  it('still collapses in memory if preference storage is full and accurately redisplays on reload', async () => {
    const view = render(<QuarterlyUpdateWorkspace />); await referenceReady();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    ignoreReference();
    expectReferenceRemoved();
    expect(screen.queryByText('仅在本页收起，浏览器未能记住选择')).not.toBeInTheDocument();
    openRecovery();
    const warning = screen.getByText('仅在本页收起，浏览器未能记住选择');
    expect(warning).toHaveAttribute('role', 'status');
    expect(warning.parentElement).toContainElement(screen.getByText(/原有草稿 2026 Q3/));
    fireEvent.click(screen.getByRole('button', { name: '返回填写' }));
    expectReferenceRemoved();
    expect(quoteInputs().every((input) => input.value === '')).toBe(true);
    expect(window.localStorage.getItem(preferenceKey())).toBeNull();
    expect(state.rpc).not.toHaveBeenCalled();
    view.unmount(); setItem.mockRestore(); render(<QuarterlyUpdateWorkspace />); await referenceReady();
    expect(screen.queryByRole('status', { name: '原草稿快捷入口' })).not.toBeInTheDocument();
  });

  it('does not let a saved dismissal hide or enable edits to a quarantined malformed source', async () => {
    window.localStorage.setItem(preferenceKey(), JSON.stringify({ version: 1, disposition: 'ignored' }));
    state.draftRead.mockResolvedValue({ data: { ...legacyDraft().data, draft_data: { 'synthetic-a': null } }, error: null });
    render(<QuarterlyUpdateWorkspace />); await ready(); await screen.findAllByText(/云端草稿格式异常/);
    expect(screen.queryByRole('status', { name: '原草稿快捷入口' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '暂不使用' })).not.toBeInTheDocument();
    expect(quoteInputs().every((input) => input.readOnly)).toBe(true);
    openRecovery();
    expect(screen.getByText('格式异常的原始草稿（已隔离，未覆盖）')).toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
  });
});


describe('mobile history beside current-quarter entry', () => {
  const metric = { building_id: 'synthetic-a', record_year: 2025, record_quarter: 4, asking_rent: 300, management_fee: 30, face_rent: 285, rent_free_period: 3, vacant_area: 125, net_effective_rent: 261.25, vacancy_rate: 0.125, total_area: 1000 };
  function mobileCard() { return within(screen.getByRole('region', { name: 'Synthetic Tower A填报' })); }

  it('labels the actual reference period and aligns history before current input without filling or saving it', async () => {
    state.metrics = [metric];
    render(<QuarterlyUpdateWorkspace />); await ready();
    const mobile = mobileCard();
    expect(mobile.getByRole('columnheader', { name: /历史参考.*2025 Q4/ })).toBeInTheDocument();
    for (const [field, label, value] of [['qQuote', '报价', '300'], ['qProp', '物业费', '30'], ['qFace', '表面租金', '285'], ['qFree', '免租期', '3 个月'], ['qVacArea', '空置面积', '125 ㎡']]) {
      const reference = mobile.getByLabelText(new RegExp(`^${label}历史参考`));
      expect(reference).toHaveTextContent(value);
      const input = mobile.getByLabelText(new RegExp(`^${label} \\*$`));
      expect(input).toHaveValue(null);
      expect(input).toHaveAttribute('aria-describedby', reference.id);
      expect(input).toHaveAccessibleDescription(`历史${value}`);
      expect(reference.closest('td')?.cellIndex).toBe(1);
      expect(input.closest('td')?.cellIndex).toBe(2);
      expect(input.closest('tr')).toContainElement(reference);
      expect(input).toHaveAttribute('data-quarterly-field', field);
    }
    expect(mobile.getByLabelText('净有效租金对照')).toHaveTextContent('历史261.25');
    expect(mobile.getByLabelText('空置率对照')).toHaveTextContent('历史12.5%');
    expect(mobile.queryByText(/不参与本季度提交/)).not.toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('follows the desktop column order down the mobile rows, including ownership, area and calculated changes', async () => {
    state.metrics = [metric];
    render(<QuarterlyUpdateWorkspace />); await ready();
    const mobile = mobileCard();
    const mobileOrder = mobile.getAllByRole('rowheader').map((cell) => cell.textContent!.replace(/\s*\*/g, '').trim());
    const desktopHead = document.querySelector('.md\\:block thead')!.querySelectorAll('tr')[1];
    const desktopOrder = [...desktopHead.querySelectorAll('th')].slice(-10).map((cell) => cell.textContent);
    expect(mobileOrder).toEqual(desktopOrder);
    expect(mobileOrder).toEqual(['报价', '物业费', '表面租金', '免租期', '净有效租金', '租金变化', '空置面积', '面积变化', '空置率', '备注']);
    const card = screen.getByRole('region', { name: 'Synthetic Tower A填报' });
    expect([...card.querySelectorAll('[data-quarterly-field]')].map((input) => input.getAttribute('data-quarterly-field'))).toEqual(['qOwner', 'qPropMan', 'qQuote', 'qProp', 'qFace', 'qFree', 'qVacArea', 'qRemark']);
    const area = mobile.getByText('总面积');
    expect(mobile.getByLabelText('物业', { exact: true }).compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(area.compareDocumentPosition(mobile.getByLabelText(/^报价 \*$/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mobile.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['指标', '历史参考2025 Q4', '本季填写2026 Q4']);
  });

  it('preserves zero, formats area and decimals, and uses a dash for missing historical values', async () => {
    state.metrics = [{ ...metric, asking_rent: null, management_fee: 0, face_rent: '285.75', rent_free_period: 0, vacant_area: 12000, net_effective_rent: 0, vacancy_rate: 0 }];
    render(<QuarterlyUpdateWorkspace />); await ready();
    const mobile = mobileCard();
    expect(mobile.getByLabelText(/^报价历史参考/)).toHaveTextContent('历史—');
    expect(mobile.getByLabelText(/^物业费历史参考/)).toHaveTextContent('历史0');
    expect(mobile.getByLabelText(/^表面租金历史参考/)).toHaveTextContent('285.75');
    expect(mobile.getByLabelText(/^免租期历史参考/)).toHaveTextContent('0 个月');
    expect(mobile.getByLabelText(/^空置面积历史参考/)).toHaveTextContent('12,000 ㎡');
    expect(mobile.getByLabelText('净有效租金对照')).toHaveTextContent('历史0');
    expect(mobile.getByLabelText('空置率对照')).toHaveTextContent('历史0.0%');
  });

  it.each([0.125, 12.5])('uses the same historical vacancy display convention as desktop for %s', async (vacancy_rate) => {
    state.metrics = [{ ...metric, vacancy_rate }];
    render(<QuarterlyUpdateWorkspace />); await ready();
    expect(mobileCard().getByLabelText('空置率对照')).toHaveTextContent('历史12.5%');
  });

  it('shows a compact empty-history state without inventing a quarter or populating current inputs', async () => {
    state.metrics = [];
    render(<QuarterlyUpdateWorkspace />); await ready();
    const mobile = mobileCard();
    expect(mobile.getByText('暂无历史数据')).toBeInTheDocument();
    expect(mobile.queryByText(/参考 \d{4} Q\d/)).not.toBeInTheDocument();
    for (const label of ['报价', '物业费', '表面租金', '免租期', '空置面积']) expect(mobile.getByLabelText(new RegExp(`^${label}历史参考`))).toHaveTextContent('—');
    expect(quoteInputs().every((input) => input.value === '')).toBe(true);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('keeps live calculations separate from historical values and prioritizes numeric errors above missing fields', async () => {
    state.metrics = [metric];
    render(<QuarterlyUpdateWorkspace />); await ready();
    const mobile = mobileCard();
    fireEvent.change(mobile.getByLabelText(/^表面租金 \*$/), { target: { value: '360' } });
    fireEvent.change(mobile.getByLabelText(/^免租期 \*$/), { target: { value: '0' } });
    fireEvent.change(mobile.getByLabelText(/^空置面积 \*$/), { target: { value: '0' } });
    expect(mobile.getByLabelText('净有效租金对照')).toHaveTextContent('历史261.25360.00');
    expect(mobile.getByRole('status', { name: '租金变化' })).toHaveTextContent('+37.8%');
    expect(mobile.getByRole('status', { name: '面积变化' })).toHaveTextContent('-125 ㎡');
    expect(mobile.getByLabelText('空置率对照')).toHaveTextContent('历史12.5%0.0%');
    fireEvent.change(mobile.getByLabelText(/^免租期 \*$/), { target: { value: '37' } });
    expect(mobile.getByRole('alert')).toHaveTextContent('免租期不能超过36个月');
    expect(mobile.getByLabelText('净有效租金对照')).toHaveTextContent('历史261.25—');
    expect(mobile.getByLabelText(/^报价 \*$/)).toHaveValue(null);
  });
});

describe('mobile project navigation', () => {
  let originalBuildings: typeof state.buildings;
  beforeEach(() => {
    originalBuildings = state.buildings;
    state.buildings = [...originalBuildings,
      { id: 'synthetic-a2', name: 'Synthetic Tower A2', grade: 'A', submarket: 'CBD', total_area: 1200 },
      { id: 'synthetic-a3', name: 'Synthetic Tower A3', grade: 'A', submarket: 'CBD', total_area: 1500 },
    ];
  });
  afterEach(() => { state.buildings = originalBuildings; });
  const card = () => within(screen.getByLabelText('手机项目填写区'));

  it('shows one mobile project, supports direct selection and boundary buttons, and keeps every desktop row', async () => {
    render(<QuarterlyUpdateWorkspace />); await ready();
    const picker = screen.getByRole('combobox', { name: '选择项目' });
    expect(picker).toHaveValue('building:synthetic-a');
    expect(card().getAllByRole('region')).toHaveLength(1);
    expect(screen.getByLabelText('项目序号')).toHaveTextContent('1 / 3');
    expect(screen.getByRole('button', { name: '上一个' })).toBeDisabled();
    expect(document.querySelectorAll('.md\\:block tbody tr')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '下一个' }));
    expect(card().getByRole('region', { name: 'Synthetic Tower A2填报' })).toBeInTheDocument();
    expect(card().queryByRole('region', { name: 'Synthetic Tower A填报' })).not.toBeInTheDocument();
    fireEvent.change(picker, { target: { value: 'building:synthetic-a3' } });
    expect(screen.getByLabelText('项目序号')).toHaveTextContent('3 / 3');
    expect(screen.getByRole('button', { name: '下一个' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '上一个' }));
    expect(picker).toHaveValue('building:synthetic-a2');
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('preserves each project input and reference while resetting only the scroll position on navigation', async () => {
    state.metrics = [
      { building_id: 'synthetic-a', record_year: 2026, record_quarter: 3, asking_rent: 300 },
      { building_id: 'synthetic-a2', record_year: 2025, record_quarter: 4, asking_rent: 200 },
    ];
    render(<QuarterlyUpdateWorkspace />); await ready();
    fireEvent.change(card().getByLabelText(/^报价 \*$/), { target: { value: '310' } });
    const scroll = screen.getByLabelText('手机项目填写区'); scroll.scrollTop = 450;
    fireEvent.click(screen.getByRole('button', { name: '下一个' }));
    expect(scroll.scrollTop).toBe(0);
    expect(card().getByLabelText(/^报价 \*$/)).toHaveValue(null);
    expect(card().getByLabelText(/^报价历史参考/)).toHaveTextContent('200');
    expect(card().getByRole('columnheader', { name: /历史参考.*2025 Q4/ })).toBeInTheDocument();
    fireEvent.change(card().getByLabelText(/^报价 \*$/), { target: { value: '220' } });
    fireEvent.click(screen.getByRole('button', { name: '上一个' }));
    expect(card().getByLabelText(/^报价 \*$/)).toHaveValue(310);
    expect(card().getByLabelText(/^报价历史参考/)).toHaveTextContent('300');
    fireEvent.click(screen.getByRole('button', { name: '下一个' }));
    expect(card().getByLabelText(/^报价 \*$/)).toHaveValue(220);
  });

  it('remembers the selection per category and disables both buttons for a single project', async () => {
    render(<QuarterlyUpdateWorkspace />); await ready();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'building:synthetic-a3' } });
    fireEvent.click(screen.getByRole('button', { name: '乙级' }));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('building:synthetic-b'));
    expect(screen.getByLabelText('项目序号')).toHaveTextContent('1 / 1');
    expect(screen.getByRole('button', { name: '上一个' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下一个' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '甲级' }));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('building:synthetic-a3'));
  });

  it('shows an empty category without a stale project or navigation controls', async () => {
    state.buildings = state.buildings.filter((building) => building.grade !== 'B');
    render(<QuarterlyUpdateWorkspace />); await ready();
    fireEvent.click(screen.getByRole('button', { name: '乙级' }));
    await waitFor(() => expect(screen.getByText('Synthetic Person · 乙级')).toBeInTheDocument());
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(card().getByText('当前分类没有需要填报的项目。')).toBeInTheDocument();
    expect(card().queryByRole('region')).not.toBeInTheDocument();
  });

  it('submits filled projects across the category even when only one project is displayed', async () => {
    const row = { qQuote: '300', qProp: '30', qFace: '285', qFree: '3', qVacArea: '100' };
    state.draftRead.mockResolvedValue({ data: { ...draft('300').data, draft_data: { 'synthetic-a': row, 'synthetic-a2': row, 'synthetic-a3': row, __quarterly_meta__: { version: 2, year: 2026, quarter: 4, revision: 1 } } }, error: null });
    state.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === 'submit_quarterly_batch_v2'
      ? { data: [{ regular_count: 3, future_count: 0, submitted_at: '2026-10-08T00:00:00.000Z' }], error: null }
      : { data: [{ revision: Number(args.p_expected_revision ?? 0) + 1, updated_at: '2026-10-08T00:00:00.000Z' }], error: null });
    render(<QuarterlyUpdateWorkspace />); await ready();
    await waitFor(() => expect(card().getByLabelText(/^报价 \*$/)).toHaveValue(300));
    fireEvent.click(screen.getByRole('button', { name: '提交当前分类' }));
    await screen.findByText('提交成功');
    const submission = state.rpc.mock.calls.find(([name]) => name === 'submit_quarterly_batch_v2')?.[1];
    expect(submission.p_regular_rows.map((row: { building_id: string }) => row.building_id)).toEqual(['synthetic-a', 'synthetic-a2', 'synthetic-a3']);
  });
});


describe('desktop and mobile quarterly presentation parity', () => {
  it('shows the same precise reference and calculated results and suppresses invalid derivations on both layouts', async () => {
    state.metrics = [{ building_id: 'synthetic-a', record_year: 2025, record_quarter: 4, net_effective_rent: 250.125, face_rent: 285.75, vacant_area: 125, vacancy_rate: 0.125, total_area: 1000 }];
    render(<QuarterlyUpdateWorkspace />); await ready();
    const mobile = within(screen.getByRole('region', { name: 'Synthetic Tower A填报' }));
    fireEvent.change(mobile.getByLabelText(/^表面租金 \*$/), { target: { value: '285.75' } });
    fireEvent.change(mobile.getByLabelText(/^免租期 \*$/), { target: { value: '3' } });
    fireEvent.change(mobile.getByLabelText(/^空置面积 \*$/), { target: { value: '100' } });
    const desktop = document.querySelector('table.min-w-\\[1760px\\]')!;
    const row = [...desktop.querySelectorAll('tbody tr')].find((item) => item.textContent?.includes('Synthetic Tower A'))!;
    const cells = within(row as HTMLElement).getAllByRole('cell');
    expect(cells[9]).toHaveTextContent('250.13');
    expect(mobile.getByLabelText(/^净有效租金历史参考/)).toHaveTextContent('250.13');
    expect(cells[16]).toHaveTextContent('261.94');
    expect(mobile.getByRole('status', { name: '净有效租金' })).toHaveTextContent('261.94');
    expect(cells[17]).toHaveTextContent('+4.7%');
    expect(mobile.getByRole('status', { name: '租金变化' })).toHaveTextContent('+4.7%');
    expect(cells[19]).toHaveTextContent('-25');
    expect(mobile.getByRole('status', { name: '面积变化' })).toHaveTextContent('-25 ㎡');
    fireEvent.change(mobile.getByLabelText(/^免租期 \*$/), { target: { value: '37' } });
    expect(cells[16]).toHaveTextContent('—');
    expect(mobile.getByRole('status', { name: '净有效租金' })).toHaveTextContent('—');
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
