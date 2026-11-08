import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = [
  { id: 'one', name: '合成甲座', building_id: 'b1', record_year: 2026, record_quarter: 3 },
  { id: 'two', name: '合成乙座', building_id: 'b2', record_year: 2026, record_quarter: 3 },
];
vi.mock('@/src/services/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const query: Record<string, any> = {};
      for (const name of ['select', 'eq', 'limit', 'order']) query[name] = () => query;
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
        data: table === 'project_ledger' ? rows : table === 'buildings' ? rows : [],
        error: null,
      }));
      return query;
    },
  },
}));
vi.mock('@/src/components/demo', () => ({
  MaskedCell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('@/src/services/Auth', () => ({ getSession: async () => null }));
import { DatabaseManager } from '@/src/components/DatabaseManager';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

describe('legacy database ledger search focus', () => {
  it('retains the database ledger search focus and caret as rows are filtered', async () => {
    render(<DatabaseManager />);
    await waitFor(() => expect(screen.getByText('2 条记录')).toBeInTheDocument());
    const input = screen.getByPlaceholderText('搜索...') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: '甲' } });
    input.setSelectionRange(1, 1);
    await waitFor(() => expect(screen.getByText('1 条记录')).toBeInTheDocument());
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(1);
    fireEvent.change(input, { target: { value: '乙' } });
    input.setSelectionRange(1, 1);
    await waitFor(() => expect(screen.getByText('1 条记录')).toBeInTheDocument());
    expect(input).toHaveFocus();
    expect(input.value).toBe('乙');
    expect(input.selectionStart).toBe(1);
    expect(screen.getByText('合成乙座')).toBeInTheDocument();
    expect(screen.queryByText('合成甲座')).toBeNull();
  });
});
