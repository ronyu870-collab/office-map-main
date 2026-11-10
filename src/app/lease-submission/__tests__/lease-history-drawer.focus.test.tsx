import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: {
  from(table: string) {
    if (table === 'user_roles') return { select: async () => ({ data: [], error: null }) };
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => fixture.load() };
    return query;
  },
} }));

import { LeaseTransactionHistoryDrawer } from '../components/LeaseTransactionHistoryDrawer';

afterEach(cleanup);

it('keeps lease-change search editable while records arrive and the caret moves within the keyword', async () => {
  let finish!: (result: unknown) => void;
  fixture.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<LeaseTransactionHistoryDrawer open onClose={() => {}} />);
  const input = screen.getByPlaceholderText('搜索企业 / 楼宇') as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: 'A', selectionStart: 1, selectionEnd: 1 } });
  await act(async () => finish({ data: [{ id: 1, target_name: 'Alpha Tower' }, { id: 2, target_name: 'Beta Plaza' }], error: null }));
  expect(input).toHaveFocus();
  expect(screen.getByText('Alpha Tower')).toBeInTheDocument();
  fireEvent.change(input, { target: { value: 'Al', selectionStart: 2, selectionEnd: 2 } });
  expect(screen.queryByText('Beta Plaza')).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: 'Axpha', selectionStart: 2, selectionEnd: 2 } });
  expect(screen.getByText('暂无符合条件的变更记录')).toBeInTheDocument();
  fireEvent.change(input, { target: { value: 'Alpha', selectionStart: 2, selectionEnd: 2 } });
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(2);
  expect(screen.getByText('Alpha Tower')).toBeInTheDocument();
});
