import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { AuditLogPage } from './AuditLogPage';

const fixture = vi.hoisted(() => ({ objectQueries: [] as string[] }));
vi.mock('@/src/components/demo', () => ({ MaskedText: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./AuthAuditLogPanel', () => ({ AuthAuditLogPanel: () => null }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { from(table: string) {
  let head = false;
  let objectQuery = '';
  const query: Record<string, unknown> = {
    select(_fields: string, options?: { head?: boolean }) { head = Boolean(options?.head); return query; },
    ilike(field: string, value: string) {
      if (field === 'target_name') objectQuery = value.slice(1, -1);
      return query;
    },
    then(resolve: (value: unknown) => unknown) {
      const rows = ['Alpha 东楼', 'Alpha 西楼', 'Alps 楼'].map((target_name, index) => ({
        id: index + 1, user_id: 'synthetic-admin', actor_kind: 'user', actor_name: '测试管理员',
        action_type: 'BUILDING_PHOTO_IMPORT', target_name, created_at: '2026-11-05T10:00:00Z',
        details: { photo_count: 1 },
      })).filter(row => row.target_name.includes(objectQuery));
      if (table === 'audit_logs' && !head) fixture.objectQueries.push(objectQuery);
      return Promise.resolve(table === 'user_roles'
        ? { data: [], error: null }
        : { data: head ? null : rows, count: rows.length, error: null }).then(resolve);
    },
  };
  for (const method of ['eq', 'in', 'neq', 'gte', 'order', 'range', 'or']) query[method] = () => query;
  return query;
} } }));

beforeEach(() => { fixture.objectQueries = []; });

test('coalesces rapid search edits into one query refresh', async () => {
  render(<AuditLogPage />);
  await screen.findByText('Alpha 东楼');
  fixture.objectQueries.length = 0;
  const input = screen.getByPlaceholderText('搜索对象 / 文件名') as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: 'A' } });
  fireEvent.change(input, { target: { value: 'Al' } });
  fireEvent.change(input, { target: { value: 'Alpha' } });
  await waitFor(() => expect(fixture.objectQueries).toContain('Alpha'));
  expect(fixture.objectQueries.filter(Boolean)).toEqual(['Alpha']);
  expect(input).toHaveFocus();
});

test('keeps the audit object filter focused while translated photo rows refresh and the query is edited', async () => {
  render(<AuditLogPage />);
  await screen.findByText('Alpha 东楼');
  expect(screen.getAllByText('导入了楼宇图片（1 张）')).toHaveLength(3);
  const input = screen.getByPlaceholderText('搜索对象 / 文件名') as HTMLInputElement;
  input.focus();

  fireEvent.change(input, { target: { value: 'A', selectionStart: 1, selectionEnd: 1 } });
  await waitFor(() => expect(fixture.objectQueries).toContain('A'));
  await screen.findByText('Alpha 东楼');
  expect(screen.getByPlaceholderText('搜索对象 / 文件名')).toBe(input);
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(1);

  fireEvent.change(input, { target: { value: 'Alpa', selectionStart: 4, selectionEnd: 4 } });
  await screen.findByText('没有符合条件的日志');
  expect(input).toHaveFocus();
  input.setSelectionRange(3, 3);
  fireEvent.change(input, { target: { value: 'Alpha', selectionStart: 4, selectionEnd: 4 } });
  await screen.findByText('Alpha 东楼');
  expect(screen.getByText('Alpha 西楼')).toBeInTheDocument();
  expect(screen.queryByText('Alps 楼')).not.toBeInTheDocument();
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(4);

  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'Alpha 东', selectionStart: 7, selectionEnd: 7 } });
  fireEvent.compositionEnd(input, { data: '东' });
  await waitFor(() => expect(screen.queryByText('Alpha 西楼')).not.toBeInTheDocument());
  expect(screen.getByText('Alpha 东楼')).toBeInTheDocument();
  expect(input).toHaveFocus();
  expect(input).toHaveValue('Alpha 东');

  fireEvent.change(input, { target: { value: '', selectionStart: 0, selectionEnd: 0 } });
  await screen.findByText('Alps 楼');
  expect(input).toHaveFocus();
  expect(screen.getByPlaceholderText('搜索对象 / 文件名')).toBe(input);
  expect(screen.getAllByText('导入了楼宇图片（1 张）')).toHaveLength(3);
});
