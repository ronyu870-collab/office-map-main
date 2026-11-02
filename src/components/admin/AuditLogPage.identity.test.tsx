import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { AuditLogPage } from './AuditLogPage';

const fixture = vi.hoisted(() => ({ directoryError: false, filters: [] as string[] }));
vi.mock('@/src/components/demo', () => ({ MaskedText: ({children}: {children: React.ReactNode}) => children }));
vi.mock('./AuthAuditLogPanel', () => ({ AuthAuditLogPanel: () => null }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { from(table: string) {
  let head = false;
  const query: Record<string, any> = {
    select(_fields: string, options?: {head?: boolean}) { head = Boolean(options?.head); return query; },
    or(filter: string) { fixture.filters.push(filter); return query; },
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve(table === 'user_roles'
        ? {data: fixture.directoryError ? null : [], error: fixture.directoryError ? {message: 'offline'} : null}
        : {data: head ? null : [
          {id: 7471, user_id: 'codex', action_type: 'SALES_MATERIAL_IMPORT', created_at: '2026-10-31T10:52:55Z', target_name: '2026-10-31原页补核', details: {batch: 'fixture-batch', material_count: 2, parameter_and_note_count: 8}},
          {id: 7472, user_id: 'removed-user', actor_kind: 'user', actor_name: '历史操作人', action_type: 'EXPORT_DATA', created_at: '2026-10-31T10:53:55Z', details: {}},
          {id: 7473, user_id: 'unregistered-tool', actor_kind: 'unknown', action_type: 'EXPORT_DATA', created_at: '2026-10-31T10:54:55Z', details: {}},
        ], count: 3, error: null}).then(resolve);
    },
  };
  for (const method of ['eq','in','neq','gte','order','range','ilike']) query[method] = () => query;
  return query;
} } }));

beforeEach(() => { fixture.directoryError = false; fixture.filters = []; });

test('legacy Codex imports show executor, business action and raw evidence', async () => {
  render(<AuditLogPage/>);
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
