import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { AuditLogPage } from './AuditLogPage';

const fixture = vi.hoisted(() => ({ directoryError: false, withAdmin: false, filters: [] as string[] }));
vi.mock('@/src/components/demo', () => ({ MaskedText: ({children}: {children: React.ReactNode}) => children }));
vi.mock('./AuthAuditLogPanel', () => ({ AuthAuditLogPanel: () => null }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { from(table: string) {
  let head = false;
  let selectedUsers: string[] | undefined;
  const excludedUsers = new Set<string>();
  const query: Record<string, unknown> = {
    select(_fields: string, options?: {head?: boolean}) { head = Boolean(options?.head); return query; },
    or(filter: string) { fixture.filters.push(filter); return query; },
    neq(field: string, value: string) { if (field === 'user_id') excludedUsers.add(value); return query; },
    in(field: string, values: string[]) { if (field === 'user_id') selectedUsers = values; return query; },
    then(resolve: (value: unknown) => unknown) {
      const rows = [
        {id: 7471, user_id: 'codex', action_type: 'SALES_MATERIAL_IMPORT', created_at: '2026-10-31T10:52:55Z', target_name: '2026-10-31原页补核', details: {batch: 'fixture-batch', material_count: 2, parameter_and_note_count: 8}},
        {id: 7472, user_id: 'removed-user', actor_kind: 'user', actor_name: '历史操作人', action_type: 'EXPORT_DATA', created_at: '2026-10-31T10:53:55Z', details: {}},
        {id: 7473, user_id: 'unregistered-tool', actor_kind: 'unknown', action_type: 'EXPORT_DATA', created_at: '2026-10-31T10:54:55Z', details: {}},
        ...(fixture.withAdmin ? [
          {id: 7474, user_id: 'admin@example.test', actor_kind: 'user', actor_name: '测试管理员', action_type: 'SALES_MATERIAL_IMPORT', created_at: '2026-10-31T10:55:55Z', details: {executor: 'codex'}},
          {id: 7475, user_id: 'system', action_type: 'EXPORT_DATA', created_at: '2026-10-31T10:56:55Z', details: {}},
        ] : []),
      ].filter(row => !excludedUsers.has(row.user_id) && (!selectedUsers || selectedUsers.includes(row.user_id)));
      const directory = fixture.withAdmin ? [
        {user_id: 'admin-uuid', email: 'admin@example.test', chinese_name: '测试管理员', role: 'admin'},
      ] : [];
      return Promise.resolve(table === 'user_roles'
        ? {data: fixture.directoryError ? null : directory, error: fixture.directoryError ? {message: 'offline'} : null}
        : {data: head ? null : rows, count: rows.length, error: null}).then(resolve);
    },
  };
  for (const method of ['eq','gte','order','range','ilike','abortSignal']) query[method] = () => query;
  return query;
} } }));

beforeEach(() => { fixture.directoryError = false; fixture.withAdmin = false; fixture.filters = []; });

test('legacy Codex imports show executor, business action and raw evidence', async () => {
  render(<AuditLogPage/>);
  fireEvent.click(screen.getByRole('button', {name: '排除 Codex'}));
  const actor = await screen.findByText('Codex（工具执行）');
  expect(screen.getAllByText('资料导入').length).toBeGreaterThan(0);
  expect(screen.getByText('导入了项目资料（2 份资料、8 条参数与说明）')).toBeInTheDocument();
  expect(screen.queryByText('未匹配用户')).not.toBeInTheDocument();
  fireEvent.click(actor.closest('button')!);
  expect(screen.getByText('导入批次')).toBeInTheDocument();
  expect(screen.getByText(/"user_id": "codex"/)).toBeInTheDocument();
});

test('missing directory is explicit and persisted identity remains readable', async () => {
  fixture.directoryError = true;
  render(<AuditLogPage/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('用户目录暂时无法加载');
  expect(await screen.findByText('历史操作人')).toBeInTheDocument();
  expect(screen.getByText('身份待核验')).toBeInTheDocument();
  await waitFor(() => expect(fixture.filters.some(filter => filter.includes('actor_kind.eq.unknown'))).toBe(true));
});

test('Codex is excluded by default while admin exclusion is opt-in, and clearing restores both defaults', async () => {
  fixture.withAdmin = true;
  render(<AuditLogPage/>);
  const codex = screen.getByRole('button', {name: '排除 Codex'});
  const admins = screen.getByRole('button', {name: '排除管理员'});
  const history = screen.getByText('历史总量').parentElement;
  const current = screen.getByText('当前筛选').parentElement;

  await screen.findByText('4 条');
  expect(codex).toHaveAttribute('aria-pressed', 'true');
  expect(admins).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByRole('button', {name: '清除筛选'})).not.toBeInTheDocument();
  expect(screen.queryByText('Codex（工具执行）')).not.toBeInTheDocument();
  expect(screen.getByText('系统任务')).toBeInTheDocument();
  expect(screen.getByText('身份待核验')).toBeInTheDocument();
  expect(screen.getByText('测试管理员')).toBeInTheDocument();
  expect(screen.getByRole('tab', {name: /^业务活动\s*4$/})).toBeInTheDocument();
  expect(current).toHaveTextContent('4');
  expect(history).toHaveTextContent('5');

  fireEvent.click(codex);
  await screen.findByText('5 条');
  expect(codex).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByText('Codex（工具执行）')).toBeInTheDocument();

  fireEvent.click(codex);
  await screen.findByText('4 条');
  fireEvent.click(admins);
  await screen.findByText('3 条');
  expect(screen.queryByText('测试管理员')).not.toBeInTheDocument();
  expect(screen.queryByText('Codex（工具执行）')).not.toBeInTheDocument();

  fireEvent.change(screen.getByDisplayValue('全部人员'), {target: {value: 'admin-uuid'}});
  await screen.findByText('1 条');
  expect(codex).toBeDisabled();
  expect(admins).toBeDisabled();
  expect(screen.getByText('测试管理员')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', {name: '清除筛选'}));
  await screen.findByText('4 条');
  expect(codex).toBeEnabled();
  expect(codex).toHaveAttribute('aria-pressed', 'true');
  expect(admins).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByText('Codex（工具执行）')).not.toBeInTheDocument();
  expect(screen.getByText('测试管理员')).toBeInTheDocument();
});
