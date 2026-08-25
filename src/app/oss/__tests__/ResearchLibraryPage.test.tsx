import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  getSessionFast: vi.fn(),
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

vi.mock('@/src/services/Auth', () => ({
  getSessionFast: mocks.getSessionFast,
}));

vi.mock('@/src/components/OSSManager', () => ({
  OSSManager: ({ userEmail }: { userEmail: string }) => (
    <div data-testid="oss-manager" data-user-email={userEmail}>Research Library Manager</div>
  ),
}));

import OSSPage from '@/src/app/oss/page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Research Library page', () => {
  it('renders the library only after a valid session resolves', async () => {
    mocks.getSessionFast.mockResolvedValueOnce({
      user: { email: 'analyst@colliers.com' },
      displayName: 'Analyst',
      role: 'viewer',
    });

    render(<OSSPage />);

    const manager = await screen.findByTestId('oss-manager');
    expect(manager).toHaveAttribute('data-user-email', 'analyst@colliers.com');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated users to login and never renders the library', async () => {
    mocks.getSessionFast.mockResolvedValueOnce(null);

    render(<OSSPage />);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByTestId('oss-manager')).not.toBeInTheDocument();
  });

  it('redirects to login when session resolution fails', async () => {
    mocks.getSessionFast.mockRejectedValueOnce(new Error('session unavailable'));

    render(<OSSPage />);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByTestId('oss-manager')).not.toBeInTheDocument();
  });

  it('keeps the workspace return navigation available', async () => {
    mocks.getSessionFast.mockResolvedValueOnce({
      user: { email: 'research@colliers.com' },
      displayName: 'Research',
      role: 'viewer',
    });

    render(<OSSPage />);

    await screen.findByTestId('oss-manager');
    expect(screen.getByRole('link', { name: /返回工作区/ })).toHaveAttribute('href', '/');
  });
});
