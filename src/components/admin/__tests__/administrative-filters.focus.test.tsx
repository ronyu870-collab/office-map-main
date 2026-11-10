import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]>, issues: vi.fn() }));
vi.mock('@/src/components/admin/AdminSidebar', () => ({ AdminSidebar: () => null }));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('@/src/services/feedbackAdminApi', async (load) => ({ ...await load<object>(), getAdminFeedbackIssues: mocks.issues }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } }, error: null }) },
  from(table: string) {
    const result = Promise.resolve({ data: mocks.rows[table] ?? [], error: null });
    const query = { select: () => query, eq: () => query, in: () => query, order: () => query, then: result.then.bind(result) };
    return query;
  },
} }));

import DisplayOverridesPage from '@/src/app/admin/display-overrides/page';
import { ChangelogManager } from '@/src/components/ChangelogManager';
import IssueManager from '../IssueManager';
import { UserManager } from '../UserManager';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function enter(input: HTMLInputElement, value: string, caret = value.length) {
  fireEvent.change(input, { target: { value, selectionStart: caret, selectionEnd: caret } });
  expect(input).toHaveValue(value);
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(caret);
}

it('keeps the display-rule search focused while filtering and correcting a term', async () => {
  const date = '2026-10-01T00:00:00Z';
  mocks.rows = {
    buildings: [{ id: 'a', name: 'Alpha Tower' }, { id: 'b', name: 'Beta Plaza' }],
    building_display_overrides: ['a', 'b'].map(id => ({ id, building_id: id, field_name: 'grade', display_label: '等级', display_value: '甲级', created_at: date })),
  };
  render(<DisplayOverridesPage />);
  await screen.findByText('Alpha Tower');
  const input = screen.getByPlaceholderText('搜索楼宇名称、字段、标签或值') as HTMLInputElement;
  input.focus();
  enter(input, 'A');
  enter(input, 'Al');
  expect(screen.queryByText('Beta Plaza')).not.toBeInTheDocument();
  enter(input, 'Axpha', 2);
  expect(screen.getByText('暂无覆盖规则')).toBeInTheDocument();
  enter(input, 'Alpha', 2);
  expect(screen.getByText('Alpha Tower')).toBeInTheDocument();
});

it('keeps the update module filter focused when switching between populated and empty results', async () => {
  mocks.rows = { changelog: [
    { id: 'm', title: 'Map fixture', status: 'planned', module: 'map', category: 'feature' },
    { id: 'd', title: 'Database fixture', status: 'planned', module: 'database', category: 'feature' },
  ] };
  render(<ChangelogManager />);
  await screen.findByText('Map fixture');
  const moduleFilter = screen.getByRole('option', { name: /地图系统/ }).closest('select')!;
  moduleFilter.focus();
  fireEvent.change(moduleFilter, { target: { value: 'map' } });
  expect(moduleFilter).toHaveFocus();
  expect(screen.queryByText('Database fixture')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /已上线/ }));
  expect(screen.getByText('无匹配记录，尝试调整筛选条件')).toBeInTheDocument();
  expect(moduleFilter).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /即将更新/ }));
  fireEvent.change(moduleFilter, { target: { value: 'all' } });
  expect(moduleFilter).toHaveFocus();
  expect(screen.getByText('Database fixture')).toBeInTheDocument();
});

it('continues editing feedback search after a delayed list and while a source filter is active', async () => {
  let finish!: (rows: unknown[]) => void;
  mocks.issues.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<IssueManager adminEmail="fixture@example.test" />);
  const input = screen.getByPlaceholderText('搜索反馈') as HTMLInputElement;
  fireEvent.change(screen.getByRole('combobox', { name: '' }), { target: { value: 'user_feedback' } });
  input.focus();
  enter(input, 'A');
  const row = (id: string, title: string, source: string) => ({ id, title, source, status: 'open', description: '', created_by: 'Fixture', created_at: '2026-10-01T00:00:00Z' });
  await act(async () => finish([row('a', 'Alpha feedback', 'user_feedback'), row('b', 'Beta feedback', 'user_feedback'), row('c', 'Alpha internal', 'admin')]));
  expect(input).toHaveFocus();
  enter(input, 'Al');
  expect(screen.queryByText('Beta feedback')).not.toBeInTheDocument();
  enter(input, 'Axpha', 2);
  expect(screen.queryByText('Alpha feedback')).not.toBeInTheDocument();
  enter(input, 'Alpha', 2);
  expect(screen.getByText('Alpha feedback')).toBeInTheDocument();
  expect(screen.queryByText('Alpha internal')).not.toBeInTheDocument();
});

it('keeps user-directory search focused across a delayed response and a mid-word correction', async () => {
  let finish!: (response: Response) => void;
  let finishCounts!: (response: Response) => void;
  const fetchUsers = vi.fn((path: string) => new Promise<Response>(resolve => {
    if (path.endsWith('view=assignments')) finishCounts = resolve;
    else finish = resolve;
  }));
  vi.stubGlobal('fetch', fetchUsers);
  render(<UserManager />);
  const input = screen.getByPlaceholderText('搜索姓名、邮箱、电话或角色') as HTMLInputElement;
  input.focus();
  enter(input, 'A');
  await waitFor(() => expect(fetchUsers).toHaveBeenCalledTimes(2));
  await act(async () => {
    finish(new Response(JSON.stringify({ users: [
      { user_id: 'a', chinese_name: 'Alpha User', email: 'a@example.test', role: 'viewer' },
      { user_id: 'b', chinese_name: 'Beta User', email: 'b@example.test', role: 'viewer' },
    ] })));
  });
  expect(input).toHaveFocus();
  enter(input, 'Al');
  expect(screen.queryByText('Beta User')).not.toBeInTheDocument();
  enter(input, 'Axpha', 2);
  expect(screen.getByText('没有找到匹配的用户')).toBeInTheDocument();
  enter(input, 'Alpha', 2);
  expect(screen.getByText('Alpha User')).toBeInTheDocument();
  expect(screen.getByText('统计加载中…')).toBeVisible();
  expect(screen.queryByText('0 个存量')).toBeNull();
  await act(async () => {
    finishCounts(new Response(JSON.stringify({ assignments: [{ user_id: 'a', stock_assignment_count: 3, future_assignment_count: 4 }] })));
  });
  expect(screen.getByText('3 个存量')).toBeVisible();
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(2);
});

it('retries failed assignment counts without rereading the directory or discarding a profile edit', async () => {
  const directory = vi.fn(() => new Response(JSON.stringify({ users: [
    { user_id: 'a', chinese_name: 'Alpha User', email: 'a@example.test', role: 'editor', disabled: true, phone: '13000000000' },
  ] })));
  let finishCounts!: (response: Response) => void;
  const counts = vi.fn()
    .mockImplementationOnce(() => new Response('{}', { status: 500 }))
    .mockImplementationOnce(() => new Promise(resolve => { finishCounts = resolve; }));
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('view=assignments') ? counts() : directory()));
  render(<UserManager />);

  expect(await screen.findByText('已停用')).toBeVisible();
  expect(await screen.findByText('任务统计加载失败')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '重试统计' }));
  await waitFor(() => expect(counts).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: '管理' }));
  const name = screen.getByLabelText('中文名');
  fireEvent.change(name, { target: { value: '保留草稿' } });
  await act(async () => finishCounts(new Response(JSON.stringify({ assignments: [{ user_id: 'a', stock_assignment_count: 8, future_assignment_count: 0 }] }))));
  expect(await screen.findByText('8 个存量')).toBeInTheDocument();
  expect(name).toHaveValue('保留草稿');
  expect(directory).toHaveBeenCalledOnce();
  expect(counts).toHaveBeenCalledTimes(2);
});

it('checks the saved role from the directory even while old assignment counts are still pending', async () => {
  let role = 'editor';
  const pendingCounts: Array<{ signal: AbortSignal | null | undefined; resolve: (response: Response) => void }> = [];
  const changes = vi.fn();
  const fetchUsers = vi.fn(async (path: string, init: RequestInit) => {
    if (init.method === 'PATCH') {
      const payload = JSON.parse(String(init.body));
      changes(payload);
      role = payload.role;
      return new Response('{}');
    }
    if (path.endsWith('view=assignments')) {
      return new Promise<Response>(resolve => pendingCounts.push({ signal: init.signal, resolve }));
    }
    return new Response(JSON.stringify({ users: [
      { user_id: 'a', chinese_name: 'Alpha User', email: 'a@example.test', role, disabled: false, phone: '13000000000' },
    ] }));
  });
  vi.stubGlobal('fetch', fetchUsers);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  try {
    render(<UserManager />);
    fireEvent.click(await screen.findByRole('button', { name: '管理' }));
    fireEvent.change(screen.getByLabelText('角色'), { target: { value: 'user' } });
    fireEvent.click(screen.getByRole('button', { name: /保存并设为/ }));

    expect(await screen.findByText('用户资料和角色已更新')).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledOnce();
    expect(changes).toHaveBeenCalledWith(expect.objectContaining({ action: 'update_profile', userId: 'a', expectedRole: 'editor', role: 'user' }));
    expect(fetchUsers.mock.calls.filter(([path]) => path.endsWith('view=directory'))).toHaveLength(2);
    expect(pendingCounts).toHaveLength(2);
    expect(pendingCounts[0].signal?.aborted).toBe(true);
    await act(async () => pendingCounts[0].resolve(new Response(JSON.stringify({ assignments: [{ user_id: 'a', stock_assignment_count: 99, future_assignment_count: 0 }] }))));
    expect(screen.queryByText('99 个存量')).toBeNull();
    await act(async () => pendingCounts[1].resolve(new Response(JSON.stringify({ assignments: [{ user_id: 'a', stock_assignment_count: 2, future_assignment_count: 0 }] }))));
    expect(screen.getByText('2 个存量')).toBeInTheDocument();
  } finally {
    confirm.mockRestore();
  }
});
