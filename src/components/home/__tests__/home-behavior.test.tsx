import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  logAction: vi.fn(),
  logActionImmediate: vi.fn(),
  signOut: vi.fn(),
  session: null as null | {
    user: { email: string };
    role: 'viewer' | 'editor' | 'admin';
    displayName: string;
  },
  status: 'authenticated' as 'loading' | 'authenticated' | 'unauthenticated',
  impersonating: false,
  earlyNavigation: false,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: state.routerReplace }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: React.ReactNode; prefetch?: boolean }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({ priority: _priority, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} />
  ),
}));

vi.mock('@/src/components/SessionProvider', () => ({
  useCanStartHomeNavigation: () => state.earlyNavigation,
  useAppSession: () => ({
    session: state.session,
    status: state.status,
    refreshSession: vi.fn(),
  }),
}));

vi.mock('@/src/contexts/ImpersonationContext', () => ({
  useImpersonation: () => ({ isImpersonating: state.impersonating }),
}));

vi.mock('@/src/config/demoMode', () => ({ isDemoMode: () => false }));
vi.mock('@/src/components/CommunicationBoard', () => ({ CommunicationBoard: () => <div>communication</div> }));
vi.mock('@/src/components/NoticeBanner', () => ({ NoticeBanner: () => <div>notice</div> }));
vi.mock('@/src/services/Auth', () => ({ signOut: state.signOut }));
vi.mock('@/src/utils/audit', () => ({
  logAction: state.logAction,
  logActionImmediate: state.logActionImmediate,
}));

import { HomeWorkspace } from '@/src/components/home/HomeWorkspace';

function setSession(role: 'viewer' | 'editor' | 'admin', email = `${role}@colliers.com`) {
  state.session = {
    user: { email },
    role,
    displayName: `${role} user`,
  };
}

describe('Home workspace behavior', () => {
  beforeEach(() => {
    state.routerReplace.mockReset();
    state.logAction.mockReset();
    state.logActionImmediate.mockReset();
    state.signOut.mockReset();
    state.status = 'authenticated';
    state.impersonating = false;
    state.earlyNavigation = false;
    setSession('admin');
  });

  afterEach(() => cleanup());

  it('makes just the map link actionable during profile recovery and keeps its keyboard focus when the profile arrives', () => {
    state.status = 'loading';
    state.session = null;
    const { rerender } = render(<HomeWorkspace />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    state.earlyNavigation = true;
    rerender(<HomeWorkspace />);
    const map = screen.getByRole('link', { name: '北京办公楼市场地图' });
    map.focus();
    expect(map).toHaveAttribute('href', '/map');
    expect(fireEvent.click(map)).toBe(true);
    expect(screen.getAllByRole('link')).toEqual([map]);
    expect(screen.queryByRole('button', { name: '用户菜单' })).not.toBeInTheDocument();

    setSession('viewer');
    state.status = 'authenticated';
    rerender(<HomeWorkspace />);
    expect(screen.getByRole('link', { name: '北京办公楼市场地图' })).toBe(map);
    expect(map).toHaveFocus();
    expect(screen.getByRole('link', { name: '租赁成交填报' })).toBeInTheDocument();
  });

  it.each(['admin', 'editor', 'viewer'] as const)('keeps the new query unavailable for %s without replacing existing navigation', (role) => {
    setSession(role);
    render(<HomeWorkspace />);
    const query = screen.getByRole('textbox', { name: 'Colliers AI' });
    expect(query).toBeDisabled();
    expect(query).toHaveValue('');
    expect(query).toHaveAttribute('placeholder', 'AI 助手尚未开放');
    expect(screen.getByRole('button', { name: '发送问题' })).toBeDisabled();
    expect(screen.getByRole('link', { name: '北京办公楼市场地图' })).toHaveAttribute('href', '/map');
    expect(screen.getByRole('link', { name: '季度数据填报' })).toHaveAttribute('href', '/update');
    const existingAI = screen.queryByRole('link', { name: '业务智能 Intelligence' });
    if (role === 'admin') expect(existingAI).toHaveAttribute('href', '/intelligence');
    else expect(existingAI).not.toBeInTheDocument();
  });

  it('implements the user-menu keyboard contract and returns focus on Escape', async () => {
    render(<HomeWorkspace />);

    const trigger = screen.getByRole('button', { name: '用户菜单' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const menu = await screen.findByRole('menu', { name: '账户操作' });
    const settings = screen.getByRole('menuitem', { name: '修改密码' });
    const admin = screen.getByRole('menuitem', { name: '系统管理' });

    await waitFor(() => expect(settings).toHaveFocus());
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(admin).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: '账户操作' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('lets a viewer enter the same business read workspaces as an editor', () => {
    setSession('viewer');
    render(<HomeWorkspace />);

    const lease = screen.getByRole('link', { name: '租赁成交填报' });
    expect(lease).not.toHaveAttribute('aria-disabled');
    expect(fireEvent.click(lease)).toBe(true);
    expect(state.logAction).not.toHaveBeenCalledWith(
      'viewer@colliers.com',
      'ACCESS_DENIED',
      expect.anything(),
    );
  });

  it.each([
    ['viewer', 'viewer@colliers.com'],
    ['editor', 'tony.yan@colliers.com'],
  ] as const)('shows only the three shared business entries to a %s', (role, email) => {
    setSession(role, email);
    render(<HomeWorkspace />);

    const navigation = within(screen.getByRole('navigation', { name: '业务入口' }));
    expect(navigation.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '/map', '/lease-submission', '/update', '/oss',
    ]);
    expect(navigation.queryByText('仅管理员可见')).not.toBeInTheDocument();
  });

  it('shows all five business entries in order and identifies the two administrator entries', () => {
    render(<HomeWorkspace />);

    const navigation = within(screen.getByRole('navigation', { name: '业务入口' }));
    expect(navigation.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '/map', '/lease-submission', '/update', '/oss', '/quarterly-research', '/occupier-insights',
    ]);
    expect(navigation.getAllByText('仅管理员可见')).toHaveLength(2);
    for (const name of ['北京写字楼季度研究', '企业选址洞察报告']) {
      const link = navigation.getByRole('link', { name });
      expect(link).toHaveAccessibleDescription('仅管理员可见');
      expect(fireEvent.click(link)).toBe(true);
    }
  });

  it('does not expose the admin entry while impersonating', () => {
    state.impersonating = true;
    render(<HomeWorkspace />);

    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
    expect(screen.queryByRole('menuitem', { name: '系统管理' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '北京写字楼季度研究' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '企业选址洞察报告' })).not.toBeInTheDocument();
  });
});
