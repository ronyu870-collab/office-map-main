import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DisplayOverridesPage from '@/src/app/admin/display-overrides/page';
import { UserManager } from '../UserManager';

const names = ['Aster North', 'Aster South', 'Birch'];
vi.mock('../AdminSidebar', () => ({ AdminSidebar: () => null }));
vi.mock('@/src/services/supabaseClient', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic' } }, error: null }) },
    from(table: string) {
      const data = table === 'buildings'
        ? names.map((name, i) => ({ id: String(i), name }))
        : names.map((_, i) => ({ id: `rule-${i}`, building_id: String(i), field_name: 'submarket', display_label: '子市场', display_value: `示例 ${i}`, created_at: '2026-11-11' }));
      const query = {
        select: () => query,
        order: () => query,
        eq: () => query,
        in: () => query,
        then: (done: (result: { data: typeof data; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(done),
      };
      return query;
    },
  },
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function exerciseSearch(placeholder: string) {
  const user = userEvent.setup();
  expect(await screen.findByText('Birch')).toBeVisible();
  const input = screen.getByPlaceholderText<HTMLInputElement>(placeholder);
  await user.click(input);
  await user.keyboard('n');
  // Initial input narrows the results while preserving the editable node.
  expect(screen.getByText('Aster North')).toBeVisible();
  expect(screen.queryByText('Aster South')).not.toBeInTheDocument();
  expect(screen.queryByText('Birch')).not.toBeInTheDocument();
  expect(input).toHaveFocus();
  await user.keyboard('rth');
  expect(screen.queryByText('Aster North')).not.toBeInTheDocument();
  expect(input).toHaveFocus();
  await user.keyboard('{Home}{ArrowRight}o');
  expect(screen.getByPlaceholderText(placeholder)).toBe(input);
  expect(input).toHaveValue('north');
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(2);
  expect(screen.getByText('Aster North')).toBeVisible();
  expect(screen.queryByText('Aster South')).not.toBeInTheDocument();
  expect(screen.queryByText('Birch')).not.toBeInTheDocument();
}

describe('admin pages using the shared dialog', () => {
  it('retains focus and caret across display override filter results', async () => {
    render(<DisplayOverridesPage />);
    await exerciseSearch('搜索楼宇名称、字段、标签或值');
  });

  it('retains focus and caret across user filter results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      users: names.map((name, i) => ({
        user_id: String(i), full_name: name, role: 'user', stock_assignment_count: 0, future_assignment_count: 0,
      })),
    })));
    render(<UserManager />);
    await exerciseSearch('搜索姓名、邮箱、电话或角色');
  });
});
