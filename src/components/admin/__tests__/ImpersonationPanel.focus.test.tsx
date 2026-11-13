import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ImpersonationPanel } from '../ImpersonationPanel';

const { loadUsers, start, readAuth } = vi.hoisted(() => ({ loadUsers: vi.fn(), start: vi.fn(), readAuth: vi.fn() }));
vi.mock('@/src/services/supabaseClient', () => ({
  supabase: {
    auth: { getUser: readAuth },
    from: () => ({
      select: () => ({
        neq: (_column: string, excluded: string) => ({
          order: () => ({ order: () => ({ range: (offset: number) => ({ abortSignal: (signal: AbortSignal) => loadUsers(offset, excluded, signal) }) }) }),
        }),
      }),
    }),
  },
}));
vi.mock('@/src/contexts/ImpersonationContext', () => ({ useImpersonation: () => ({ startImpersonation: start }) }));

const user = (id: string, name: string) => ({ user_id: id, chinese_name: name, email: `${id}@example.test`, role: 'viewer' });
beforeEach(() => { loadUsers.mockReset(); start.mockReset(); readAuth.mockReset(); });

it('keeps the user simulation search focused while the list loads and is narrowed', async () => {
  let finish!: (result: { data: ReturnType<typeof user>[]; count: number }) => void;
  loadUsers.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  render(<ImpersonationPanel operatorUserId="self" />);
  const input = screen.getByRole('searchbox') as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: '陈', selectionStart: 1, selectionEnd: 1 } });
  await act(async () => { finish({ data: [user('self', '陈管理员'), user('a', '陈明'), user('b', '陈丽'), user('c', '李佳')], count: 4 }); });
  expect(screen.getByText('陈明')).toBeInTheDocument();
  expect(screen.getByText('陈丽')).toBeInTheDocument();
  expect(screen.queryByText('李佳')).not.toBeInTheDocument();
  expect(screen.queryByText('陈管理员')).not.toBeInTheDocument();
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(1);
  fireEvent.change(input, { target: { value: '陈明', selectionStart: 2, selectionEnd: 2 } });
  expect(screen.getByText('陈明')).toBeInTheDocument();
  expect(screen.queryByText('陈丽')).not.toBeInTheDocument();
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(2);
});

it('distinguishes a failed page from no matches and recovers the complete directory without rereading Auth', async () => {
  loadUsers
    .mockResolvedValueOnce({ data: [user('a', '陈明')], count: 2, error: null })
    .mockResolvedValueOnce({ data: null, count: null, error: { message: 'offline' } })
    .mockResolvedValueOnce({ data: [user('a', '陈明')], count: 2, error: null })
    .mockResolvedValueOnce({ data: [user('b', '陈丽')], count: null, error: null });
  render(<ImpersonationPanel operatorUserId="self" />);
  const input = screen.getByRole('searchbox');
  fireEvent.change(input, { target: { value: '陈丽' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('用户目录读取失败');
  expect(screen.queryByText('没有找到匹配的用户')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试目录' }));
  expect(await screen.findByText('陈丽')).toBeInTheDocument();
  expect(input).toHaveValue('陈丽');
  expect(loadUsers.mock.calls.map(([offset, self]) => [offset, self])).toEqual([[0, 'self'], [1, 'self'], [0, 'self'], [1, 'self']]);
  expect(readAuth).not.toHaveBeenCalled();
});
