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

function setSession(role: 'viewer' | 'editor' | 'admin') {
  state.session = {
    user: { email: `${role}@colliers.com` },
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
    const settings = screen.getByRole('menuitem', { name: '设置' });
    const admin = screen.getByRole('menuitem', { name: '系统管理' });

    await waitFor(() => expect(settings).toHaveFocus());
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(admin).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: '账户操作' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('prevents a disabled workspace from navigating and audits the blocked activation', () => {
    setSession('viewer');
    render(<HomeWorkspace />);

    const lease = screen.getByRole('link', { name: '租赁成交填报 - 当前角色无权访问' });
    expect(lease).toHaveAttribute('aria-disabled', 'true');
    expect(fireEvent.click(lease)).toBe(false);
    expect(state.logAction).toHaveBeenCalledWith('viewer@colliers.com', 'ACCESS_DENIED', {
      module: 'lease-submission',
      blocked: true,
      reason: 'restricted_module',
    });
  });

  it('does not expose the admin entry while impersonating', () => {
    state.impersonating = true;
    render(<HomeWorkspace />);

    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
    expect(screen.queryByRole('menuitem', { name: '系统管理' })).not.toBeInTheDocument();
  });
});
