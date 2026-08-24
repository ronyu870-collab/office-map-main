import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getSessionFast: vi.fn(),
  clearSessionCache: vi.fn(),
}));

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => routerMocks,
}));

vi.mock('@/src/services/Auth', () => ({
  getSessionFast: authMocks.getSessionFast,
  clearSessionCache: authMocks.clearSessionCache,
}));

vi.mock('@/src/services/SessionManager', () => ({
  SessionManager: class {
    start() {}
    stop() {}
    reset() {}
  },
}));

vi.mock('@/src/services/trustedDevice', () => ({
  isTrustedDevice: () => false,
  getTrustedDeviceRemainingMs: () => null,
}));

vi.mock('@/src/services/supabaseClient', () => ({
  supabase: {
    auth: {
      signOut: vi.fn(),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));

import { SessionProvider, useAppSession } from '@/src/components/SessionProvider';

function SessionConsumer({ label }: { label: string }) {
  const { session, status } = useAppSession();
  return <div>{label}:{status}:{session?.displayName ?? 'none'}</div>;
}

describe('SessionProvider shared session contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getSessionFast.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'broker@example.com',
        app_metadata: {},
        user_metadata: {},
      },
      session: {
        access_token: 'token',
        user: { id: 'user-1', email: 'broker@example.com' },
      },
      role: 'editor',
      displayName: 'Broker User',
      sessionId: 'session-1',
    });
  });

  it('resolves auth once for multiple workspace consumers', async () => {
    render(
      <SessionProvider>
        <SessionConsumer label="home" />
        <SessionConsumer label="workspace" />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('home:authenticated:Broker User')).toBeInTheDocument();
      expect(screen.getByText('workspace:authenticated:Broker User')).toBeInTheDocument();
    });

    expect(authMocks.getSessionFast).toHaveBeenCalledTimes(1);
  });
});
