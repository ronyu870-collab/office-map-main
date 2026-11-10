import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoManager } from '../MemoManager';

const api = vi.hoisted(() => ({ listMemos: vi.fn(), getAllTags: vi.fn(), createMemo: vi.fn(), deleteMemo: vi.fn(), toggleMemoPin: vi.fn() }));
vi.mock('@/src/services/memoApi', () => api);

const row = (title: string) => ({ id: title, title, tags: [], is_pinned: false, updated_at: '2026-11-10T00:00:00Z', updated_by: 'fixture' });

beforeEach(() => vi.resetAllMocks());

it('keeps memo title search editable while the result list loads and returns', async () => {
  let resolveTags!: (tags: string[]) => void;
  let resolveOldList!: (items: ReturnType<typeof row>[]) => void;
  api.getAllTags.mockReturnValue(new Promise(resolve => { resolveTags = resolve; }));
  api.listMemos.mockImplementation(({ search }: { search?: string }) => {
    if (search === 'A') return new Promise(resolve => { resolveOldList = resolve; });
    if (search === 'Alpa') return Promise.resolve([]);
    return Promise.resolve([row('Alpha 备忘录')]);
  });
  render(<MemoManager adminEmail="admin@example.test" />);

  expect(await screen.findByText('Alpha 备忘录')).toBeVisible();
  expect(screen.queryByRole('button', { name: '合成标签' })).toBeNull();
  const search = screen.getByPlaceholderText<HTMLInputElement>('搜索标题...');
  search.focus();
  fireEvent.change(search, { target: { value: 'A' } });
  await waitFor(() => expect(api.listMemos).toHaveBeenCalledWith({ search: 'A', tag: undefined }, expect.any(AbortSignal)));
  const oldSignal = api.listMemos.mock.calls.at(-1)?.[1] as AbortSignal;
  expect(search).toHaveFocus();

  fireEvent.change(search, { target: { value: 'Alpa' } });
  expect(await screen.findByText('没有匹配的备忘录')).toBeVisible();
  expect(oldSignal.aborted).toBe(true);
  await act(async () => resolveOldList([row('旧搜索结果')]));
  expect(screen.queryByText('旧搜索结果')).toBeNull();
  expect(search).toHaveFocus();

  search.setSelectionRange(3, 3);
  fireEvent.change(search, { target: { value: 'Alpha', selectionStart: 4, selectionEnd: 4 } });
  expect(await screen.findByText('Alpha 备忘录')).toBeVisible();
  expect(search).toHaveFocus();
  expect(search.selectionStart).toBe(4);

  await act(async () => resolveTags(['合成标签']));
  expect(screen.getByRole('button', { name: '合成标签' })).toBeVisible();
  expect(api.getAllTags).toHaveBeenCalledTimes(1);
});

it('reports and retries list and tag failures independently', async () => {
  api.listMemos.mockRejectedValueOnce(new Error('list failed')).mockResolvedValueOnce([row('列表已恢复')]);
  api.getAllTags.mockRejectedValueOnce(new Error('tags failed')).mockResolvedValueOnce(['标签已恢复']);
  render(<MemoManager adminEmail="admin@example.test" />);

  expect(await screen.findByText('备忘录加载失败')).toBeVisible();
  expect(screen.queryByText('暂无备忘录')).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: '重试标签' }));
  expect(await screen.findByRole('button', { name: '标签已恢复' })).toBeVisible();
  expect(api.listMemos).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: '重试列表' }));
  expect(await screen.findByText('列表已恢复')).toBeVisible();
  expect(api.getAllTags).toHaveBeenCalledTimes(2);
});
