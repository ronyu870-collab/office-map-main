import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ id: '11111111-1111-4111-8111-111111111111', role: 'admin', token: 'synthetic-token' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => ({ status: 'authenticated', session: { user: { id: state.id }, session: { user: { id: state.id }, access_token: state.token }, role: state.role } }) }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: state.id }, access_token: state.token } } }) } } }));
vi.mock('@/src/components/layout', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/src/components/ui', () => ({ AppHeader: () => <div>Pitch Studio</div>, Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} /> }));
import { PitchWorkspace } from './PitchWorkspace';
const asset = { id: '22222222-2222-4222-8222-222222222222', names: { zh: '测试素材' }, state: 'draft', current_version: 1, is_test_data: true };
describe('Pitch workspace continuous editing', () => {
  beforeEach(() => {
    state.role = 'admin';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const action = new URL(url, 'http://localhost').searchParams.get('action');
      const body = action === 'catalog' ? { scopes: [{ organizationId: 'test', region: 'test', city: 'test', businessLine: 'test', canGenerate: true, canMaintain: true, canAdmin: true, canClientExport: false, canExternalAi: false }], categories: [], templates: [], themes: [] } : { items: action === 'list_assets' ? [asset] : [], next: null };
      return { ok: true, json: async () => body };
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it('keeps project name focused through continuous typing and cursor edits', async () => {
    const user = userEvent.setup(); render(<PitchWorkspace />);
    const input = await screen.findByLabelText('项目名称');
    await user.clear(input); await user.type(input, 'Alpha Beta 2026');
    expect(input).toHaveFocus(); expect(screen.getByLabelText('项目名称')).toBe(input);
    const field = input as HTMLInputElement; field.setSelectionRange(6, 10);
    fireEvent.change(field, { target: { value: 'Alpha 修改 2026' } });
    fireEvent.compositionStart(field); fireEvent.change(field, { target: { value: 'Alpha 修改中文 2026' } }); fireEvent.compositionEnd(field);
    expect(field).toHaveFocus(); expect(field.value).toBe('Alpha 修改中文 2026'); expect(screen.getByLabelText('项目名称')).toBe(field);
    await user.selectOptions(screen.getByLabelText('内容素材'), asset.id); await user.click(field); await user.type(field, ' XYZ'); expect(field).toHaveFocus(); expect(field.value).toContain('XYZ');
  });
  it('keeps category fields focused while editing and switching static filters', async () => {
    const user = userEvent.setup(); render(<PitchWorkspace />); await screen.findByLabelText('项目名称');
    await user.click(screen.getByRole('button', { name: '管理中心' }));
    const name = screen.getByLabelText('分类名称'), code = screen.getByLabelText('稳定标识');
    await user.type(name, 'Team 2026'); expect(name).toHaveFocus(); expect(screen.getByLabelText('分类名称')).toBe(name);
    await user.type(code, 'team-2026'); expect(code).toHaveFocus(); expect(screen.getByLabelText('稳定标识')).toBe(code);
    await user.clear(code); await user.type(code, 'new-team'); expect(code).toHaveFocus(); expect(code).toHaveValue('new-team');
    await user.click(screen.getByRole('button', { name: '快速生成' })); expect(await screen.findByLabelText('项目名称')).toBeInTheDocument();
  });
});
