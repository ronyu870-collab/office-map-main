import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableConfig, DictBundle } from '@/src/components/admin/types';

const dicts: DictBundle = {};
const records = [
  { id: 'one', name: '合成甲座' },
  { id: 'two', name: '合成乙座' },
];
const config: TableConfig = {
  table: 'synthetic_focus_records',
  label: '合成查询',
  hideAdd: true, hideUpload: true, hideTemplate: true,
  cols: [
    { key: 'id', label: 'ID', type: 'uuid', hidden: true, readOnly: true },
    { key: 'name', label: '项目', type: 'text' },
  ],
  customFetch: async () => records,
};
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@/src/components/demo', () => ({
  MaskedCell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('@/src/services/Auth', () => ({ getSession: async () => null }));
import { GenericTablePanel } from '@/src/components/admin/GenericTablePanel';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

describe('generic data table search input', () => {
  it('retains generic table search focus and caret across result changes', async () => {
    render(<GenericTablePanel config={config} dicts={dicts} />);
    await waitFor(() => expect(screen.getByText('2 条记录')).toBeInTheDocument());
    const input = screen.getByPlaceholderText('搜索...') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: '甲' } });
    input.setSelectionRange(1, 1);
    await waitFor(() => expect(screen.getByText('1 条记录')).toBeInTheDocument());
    expect(screen.getByText('合成甲座')).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(1);
    fireEvent.change(input, { target: { value: '乙' } });
    input.setSelectionRange(1, 1);
    await waitFor(() => expect(screen.getByText('合成乙座')).toBeInTheDocument());
    expect(screen.queryByText('合成甲座')).toBeNull();
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(1);
  });
});
