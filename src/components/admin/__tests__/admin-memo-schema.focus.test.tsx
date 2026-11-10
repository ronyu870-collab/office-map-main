import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MarkdownPreview } from '@/src/components/admin-memo/MarkdownPreview';
import { MemoList } from '@/src/components/admin-memo/MemoList';
import SchemaMap from '../SchemaMap';

afterEach(cleanup);

it('keeps memo title search editable while the result list loads and returns', async () => {
  const onSearch = vi.fn();
  const props = {
    tags: [], selectedId: null, selectedTag: null, onSearch,
    onSelect: vi.fn(), onCreate: vi.fn(), onDelete: vi.fn(), onTogglePin: vi.fn(), onTagFilter: vi.fn(),
  };
  const { rerender } = render(<MemoList {...props} memos={[]} loading={false} />);
  const input = screen.getByPlaceholderText('搜索标题...') as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: '周报表' } });
  await waitFor(() => expect(onSearch).toHaveBeenCalledWith('周报表'));
  rerender(<MemoList {...props} memos={[]} loading />);
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: '周报', selectionStart: 1, selectionEnd: 1 } });
  await waitFor(() => expect(onSearch).toHaveBeenLastCalledWith('周报'));
  rerender(<MemoList {...props} loading={false} memos={[{ id: 'demo', title: '周报', tags: [], is_pinned: false, updated_at: '2026-11-10T00:00:00Z', updated_by: 'demo' }]} />);
  expect(screen.getByText('周报')).toBeInTheDocument();
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(1);
});

it('supports keyboard focus in a memo preview and keeps the internal links intact', async () => {
  const user = userEvent.setup();
  render(<MarkdownPreview content={'[数据入口](/admin?section=schema)\n\n[回到首页](/)'} />);
  const schema = screen.getByRole('link', { name: /数据入口/ });
  const home = screen.getByRole('link', { name: /回到首页/ });
  await user.tab();
  expect(schema).toHaveFocus();
  expect(schema).toHaveAttribute('href', '/admin?section=schema');
  await user.tab();
  expect(home).toHaveFocus();
  expect(home).toHaveAttribute('href', '/');
});

it('keeps schema search and its caret while a corrected table name becomes selectable', async () => {
  render(<SchemaMap />);
  const input = screen.getByPlaceholderText('搜索表名或字段...') as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: 'buildnigs' } });
  await screen.findByText('未找到匹配的表或字段');
  expect(screen.queryByRole('button', { name: /楼宇基础信息/ })).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: 'buildings', selectionStart: 6, selectionEnd: 6 } });
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(6);
  expect(screen.getByRole('button', { name: /楼宇基础信息/ })).toBeInTheDocument();
});
