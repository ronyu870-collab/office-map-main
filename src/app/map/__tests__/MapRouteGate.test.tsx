import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionMocks = vi.hoisted(() => ({
  status: 'loading' as 'loading' | 'authenticated' | 'unauthenticated',
}));

const routerMocks = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => routerMocks,
}));

vi.mock('next/dynamic', () => ({
  default: () => function MockMapClient() {
    return <div data-testid="map-client">Map Client</div>;
  },
}));

vi.mock('@/src/components/SessionProvider', () => ({
  useAppSession: () => ({
    session: sessionMocks.status === 'authenticated' ? { user: { id: 'user-1' } } : null,
    status: sessionMocks.status,
    refreshSession: vi.fn(),
  }),
}));

import { MapRouteGate } from '@/src/app/map/MapRouteGate';

describe('MapRouteGate', () => {
  beforeEach(() => {
    sessionMocks.status = 'loading';
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
