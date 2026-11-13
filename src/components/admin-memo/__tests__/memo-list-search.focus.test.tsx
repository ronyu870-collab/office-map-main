import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoManager } from '../MemoManager';

vi.mock('@/src/services/memoApi', () => ({
  listMemos: async ({ search = '' }: { search?: string } = {}) =>
    ['North memo', 'West memo'].filter(title => title.toLowerCase().includes(search)).map((title, i) => ({
      id: String(i), title, tags: [], is_pinned: false, updated_at: '2026-11-11', updated_by: 'synthetic',
    })),
  getAllTags: async () => [],
  createMemo: vi.fn(),
  deleteMemo: vi.fn(),
  toggleMemoPin: vi.fn(),
}));
vi.mock('../MemoEditor', () => ({ MemoEditor: () => null }));

afterEach(cleanup);

it('preserves memo search focus and caret after debounced results refresh', async () => {
  const user = userEvent.setup();
  render(<MemoManager adminEmail="synthetic@example.test" />);
  expect(await screen.findByText('West memo')).toBeVisible();
  const input = screen.getByPlaceholderText<HTMLInputElement>('搜索标题...');
  await user.click(input);
  await user.keyboard('n');
  await waitFor(() => expect(screen.queryByText('West memo')).not.toBeInTheDocument());
  expect(await screen.findByText('North memo')).toBeVisible();
  expect(input).toHaveFocus();
  await user.keyboard('rth');
  expect(await screen.findByText('没有匹配的备忘录')).toBeVisible();
  expect(input).toHaveFocus();
  await user.keyboard('{Home}{ArrowRight}o');
  expect(await screen.findByText('North memo')).toBeVisible();
  expect(screen.queryByText('West memo')).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText('搜索标题...')).toBe(input);
  expect(input).toHaveValue('north');
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(2);
});
