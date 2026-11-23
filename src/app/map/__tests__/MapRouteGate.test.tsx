import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionMocks = vi.hoisted(() => ({
  status: 'loading' as 'loading' | 'authenticated' | 'unauthenticated',
  userId: 'user-1', role: 'admin', sessionId: 'session-1', targetUserId: null as string | null,
  mount: vi.fn(), dispose: vi.fn(),
}));

const routerMocks = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => routerMocks,
}));

vi.mock('next/dynamic', () => ({
  default: () => function MockMapClient() {
    React.useEffect(() => { sessionMocks.mount(); return () => sessionMocks.dispose(); }, []);
    return <div data-testid="map-client">Map Client</div>;
  },
}));

vi.mock('@/src/components/SessionProvider', () => ({
  useAppSession: () => ({
    session: sessionMocks.status === 'authenticated' ? { user: { id: sessionMocks.userId }, role: sessionMocks.role, sessionId: sessionMocks.sessionId } : null,
    status: sessionMocks.status,
    refreshSession: vi.fn(),
  }),
}));

vi.mock('@/src/contexts/ImpersonationContext', () => ({ useImpersonation: () => ({ targetUserId: sessionMocks.targetUserId }) }));

import { MapRouteGate } from '@/src/app/map/MapRouteGate';

describe('MapRouteGate', () => {
  beforeEach(() => {
    sessionMocks.status = 'loading';
    sessionMocks.userId = 'user-1'; sessionMocks.role = 'admin'; sessionMocks.sessionId = 'session-1'; sessionMocks.targetUserId = null;
    sessionMocks.mount.mockClear(); sessionMocks.dispose.mockClear();
    routerMocks.replace.mockReset();
  });

  it('does not mount the heavy map client while the shared session is unresolved', () => {
    render(<MapRouteGate />);

    expect(screen.queryByTestId('map-client')).not.toBeInTheDocument();
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });

  it('mounts the map client only after authentication succeeds', () => {
    sessionMocks.status = 'authenticated';
    render(<MapRouteGate />);

    expect(screen.getByTestId('map-client')).toBeInTheDocument();
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });

  it('keeps the map unmounted and redirects unauthenticated sessions', async () => {
    sessionMocks.status = 'unauthenticated';
    render(<MapRouteGate />);

    expect(screen.queryByTestId('map-client')).not.toBeInTheDocument();
    await waitFor(() => expect(routerMocks.replace).toHaveBeenCalledWith('/login'));
  });
});

it.each(['userId', 'role', 'sessionId', 'targetUserId'] as const)('disposes the old reading workspace when %s changes', field => {
  sessionMocks.userId = 'user-1'; sessionMocks.role = 'admin'; sessionMocks.sessionId = 'session-1'; sessionMocks.targetUserId = null;
  sessionMocks.mount.mockClear(); sessionMocks.dispose.mockClear();
  sessionMocks.status = 'authenticated';
  const view = render(<MapRouteGate />);
  expect(sessionMocks.mount).toHaveBeenCalledOnce();
  view.rerender(<MapRouteGate />);
  expect(sessionMocks.dispose).not.toHaveBeenCalled();
  sessionMocks[field] = field === 'role' ? 'viewer' : 'different-identity';
  view.rerender(<MapRouteGate />);
  expect(sessionMocks.dispose).toHaveBeenCalledOnce();
  expect(sessionMocks.mount).toHaveBeenCalledTimes(2);
});
