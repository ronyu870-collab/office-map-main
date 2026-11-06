import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: state.routerReplace }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: React.ReactNode }) => (
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
    setSession('admin');
  });

  afterEach(() => cleanup());

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

  it('hides the occupier report card from users outside its audience', () => {
    setSession('viewer');
    render(<HomeWorkspace />);

    expect(screen.queryByRole('link', { name: '企业选址洞察报告' })).not.toBeInTheDocument();
    const lease = screen.getByRole('link', { name: '租赁成交填报' });
    expect(Array.from(lease.parentElement!.children).map(link => link.getAttribute('href'))).toEqual([
      '/update', '/lease-submission', '/oss',
    ]);
  });

  it('shows the occupier report card to the named report owner', () => {
    setSession('editor', 'tony.yan@colliers.com');
    render(<HomeWorkspace />);

    const report = screen.getByRole('link', { name: '企业选址洞察报告' });
    expect(Array.from(report.parentElement!.children).map(link => link.getAttribute('href'))).toEqual([
      '/update', '/lease-submission', '/oss', '/occupier-insights',
    ]);
    expect(report).toHaveTextContent('专题');
    expect(report).toHaveAttribute('href', '/occupier-insights');
    expect(fireEvent.click(report)).toBe(true);
  });

  it('shows the occupier report card to administrators', () => {
    render(<HomeWorkspace />);

    expect(screen.getByRole('link', { name: '企业选址洞察报告' })).toHaveAttribute('href', '/occupier-insights');
  });

  it('does not expose the admin entry while impersonating', () => {
    state.impersonating = true;
    render(<HomeWorkspace />);

    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
    expect(screen.queryByRole('menuitem', { name: '系统管理' })).not.toBeInTheDocument();
  });
});
