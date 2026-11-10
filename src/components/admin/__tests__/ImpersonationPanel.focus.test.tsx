import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ImpersonationPanel } from '../ImpersonationPanel';

const { loadUsers } = vi.hoisted(() => ({ loadUsers: vi.fn() }));
vi.mock('@/src/services/supabaseClient', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'self' } } }) },
    from: () => ({ select: () => ({ order: loadUsers }) }),
  },
}));
vi.mock('@/src/contexts/ImpersonationContext', () => ({ useImpersonation: () => ({ startImpersonation: vi.fn() }) }));

it('keeps the user simulation search focused while the list loads and is narrowed', async () => {
  const user = (id: string, name: string) => ({ user_id: id, chinese_name: name, email: `${id}@example.test`, role: 'viewer' });
  let finish!: (result: { data: ReturnType<typeof user>[] }) => void;
  loadUsers.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  render(<ImpersonationPanel />);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: '陈', selectionStart: 1, selectionEnd: 1 } });
  await act(async () => { finish({ data: [user('self', '陈管理员'), user('a', '陈明'), user('b', '陈丽'), user('c', '李佳')] }); });
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
