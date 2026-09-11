import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  appSession: {
    status: 'loading' as 'loading' | 'authenticated' | 'unauthenticated',
    session: null as null | { user: { email?: string } },
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mocks.replace,
    back: vi.fn(),
  }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/src/components/SessionProvider', () => ({
  useAppSession: () => mocks.appSession,
}));

vi.mock('@/src/components/OSSManager', () => ({
  OSSManager: ({ userEmail }: { userEmail: string }) => (
    <div data-testid="oss-manager" data-user-email={userEmail}>资料库管理器</div>
  ),
}));

import OSSPage from '@/src/app/oss/page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.appSession.status = 'loading';
  mocks.appSession.session = null;
});

describe('Research Library page', () => {
  it('renders immediately from the shared authenticated session', () => {
    mocks.appSession.status = 'authenticated';
    mocks.appSession.session = { user: { email: 'analyst@colliers.com' } };

    render(<OSSPage />);

    const manager = screen.getByTestId('oss-manager');
    expect(manager).toHaveAttribute('data-user-email', 'analyst@colliers.com');
    expect(screen.getByRole('heading', { name: '研究资料库' })).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated users to login and never renders the library', async () => {
    mocks.appSession.status = 'unauthenticated';
    mocks.appSession.session = null;

    render(<OSSPage />);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByTestId('oss-manager')).not.toBeInTheDocument();
  });

  it('keeps the loading shell while the shared session is unresolved', () => {
    render(<OSSPage />);

    expect(screen.queryByTestId('oss-manager')).not.toBeInTheDocument();
    expect(screen.getByText('正在加载研究资料库')).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('keeps the workspace return navigation available', () => {
    mocks.appSession.status = 'authenticated';
    mocks.appSession.session = { user: { email: 'research@colliers.com' } };

    render(<OSSPage />);

    expect(screen.getByTestId('oss-manager')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '主页' })).toHaveAttribute('href', '/');
  });
});
