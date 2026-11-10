import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { AuditLogPage } from './AuditLogPage';

const fixture = vi.hoisted(() => ({
  objectQueries: [] as string[], countQueries: [] as string[],
  holdRows: null as null | { term: string; until: Promise<void> }, rowSignals: new Map<string, AbortSignal>(),
}));
vi.mock('@/src/components/demo', () => ({ MaskedText: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./AuthAuditLogPanel', () => ({ AuthAuditLogPanel: () => null }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { from(table: string) {
  let head = false;
  let objectQuery = '';
  let signal: AbortSignal | undefined;
  const query: Record<string, unknown> = {
    select(_fields: string, options?: { head?: boolean }) { head = Boolean(options?.head); return query; },
    ilike(field: string, value: string) {
      if (field === 'target_name') objectQuery = value.slice(1, -1);
      return query;
    },
    abortSignal(next: AbortSignal) { signal = next; return query; },
    then(resolve: (value: unknown) => unknown) {
      const rows = ['Alpha 东楼', 'Alpha 西楼', 'Alps 楼'].map((target_name, index) => ({
        id: index + 1, user_id: 'synthetic-admin', actor_kind: 'user', actor_name: '测试管理员',
        action_type: 'BUILDING_PHOTO_IMPORT', target_name, created_at: '2026-11-05T10:00:00Z',
        details: { photo_count: 1 },
      })).filter(row => row.target_name.includes(objectQuery));
      if (table === 'audit_logs') {
        if (head) fixture.countQueries.push(objectQuery);
        else {
          fixture.objectQueries.push(objectQuery);
          if (signal) fixture.rowSignals.set(objectQuery, signal);
        }
      }
      const wait = table === 'audit_logs' && !head && fixture.holdRows?.term === objectQuery ? fixture.holdRows.until : Promise.resolve();
      return wait.then(() => table === 'user_roles'
        ? { data: [], error: null }
        : { data: head ? null : rows, count: rows.length, error: null }).then(resolve);
    },
  };
  for (const method of ['eq', 'in', 'neq', 'gte', 'order', 'range', 'or']) query[method] = () => query;
  return query;
} } }));

beforeEach(() => { fixture.objectQueries = []; fixture.countQueries = []; fixture.holdRows = null; fixture.rowSignals.clear(); });

test('coalesces rapid audit search edits and does not issue table reads during Chinese composition', async () => {
  render(<AuditLogPage />);
  await screen.findByText('Alpha 东楼');
  const input = screen.getByPlaceholderText('搜索对象 / 文件名');
  input.focus();
  const baselineCount = fixture.countQueries.length;
  const baselineRows = fixture.objectQueries.length;
  for (const text of ['A', 'Al', 'Alp']) {
    await act(async () => { fireEvent.change(input, { target: { value: text } }); });
  }
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'Alpha d' } });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 320)); });
  expect(fixture.objectQueries.length).toBe(baselineRows);
  expect(fixture.countQueries.length).toBe(baselineCount);
  fireEvent.change(input, { target: { value: 'Alpha 东' } });
  fireEvent.compositionEnd(input, { data: '东' });
  await waitFor(() => expect(fixture.objectQueries.slice(baselineRows)).toEqual(['Alpha 东']));
  expect(fixture.countQueries.slice(baselineCount)).toEqual(Array(6).fill('Alpha 东'));
  expect(await screen.findByText('Alpha 东楼')).toBeInTheDocument();
  expect(screen.queryByText('Alpha 西楼')).not.toBeInTheDocument();
  expect(input).toHaveFocus();
});

test('cancels the previous audit rows request and discards a late response after a newer filter settles', async () => {
  let release!: () => void;
  fixture.holdRows = { term: 'Alps', until: new Promise<void>(resolve => { release = resolve; }) };
  render(<AuditLogPage />);
  await screen.findByText('Alpha 东楼');
  const input = screen.getByPlaceholderText('搜索对象 / 文件名');
  fireEvent.change(input, { target: { value: 'Alps' } });
  await waitFor(() => expect(fixture.objectQueries).toContain('Alps'));
  fireEvent.change(input, { target: { value: 'Alpha' } });
  await waitFor(() => expect(fixture.objectQueries).toContain('Alpha'));
  await screen.findByText('Alpha 西楼');
  await act(async () => release());
  expect(fixture.rowSignals.get('Alps')?.aborted).toBe(true);
  expect(screen.getByText('Alpha 东楼')).toBeInTheDocument();
  expect(screen.queryByText('Alps 楼')).not.toBeInTheDocument();
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
