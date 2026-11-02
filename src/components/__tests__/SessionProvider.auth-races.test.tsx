import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthSessionResult } from '@/src/services/Auth';

const state = vi.hoisted(() => ({
  getSessionFast: vi.fn(), clearSessionCache: vi.fn(),
  callback: null as null | ((event: string) => void),
  push: vi.fn(), replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/settings', useRouter: () => state }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: state.getSessionFast, clearSessionCache: state.clearSessionCache }));
vi.mock('@/src/services/SessionManager', () => ({ SessionManager: class { start() {} stop() {} reset() {} } }));
vi.mock('@/src/services/trustedDevice', () => ({ isTrustedDevice: () => false, getTrustedDeviceRemainingMs: () => null }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { auth: {
  onAuthStateChange(callback: (event: string) => void) {
    state.callback = callback; return { data: { subscription: { unsubscribe() {} } } };
  },
} } }));
import { SessionProvider, useAppSession } from '@/src/components/SessionProvider';

const session = (required: boolean) => ({ user: { app_metadata: { must_change_password: required } } }) as unknown as AuthSessionResult;
function deferred() {
  let resolve!: (value: AuthSessionResult | null) => void;
  const promise = new Promise<AuthSessionResult | null>(done => { resolve = done; });
  return { promise, resolve };
}
function Consumer() {
  const { session: current, status, refreshSession } = useAppSession();
  return <><output>{status}:{String(current?.user.app_metadata?.must_change_password)}</output><button onClick={() => void refreshSession()}>刷新会话</button></>;
}
beforeEach(() => { vi.clearAllMocks(); state.callback = null; });
afterEach(cleanup);

it('a forced post-change refresh supersedes an older in-flight session read', async () => {
  const old = deferred();
  state.getSessionFast.mockReturnValueOnce(old.promise).mockResolvedValueOnce(session(false));
  render(<SessionProvider><Consumer /></SessionProvider>);
  fireEvent.click(screen.getByRole('button', { name: '刷新会话' }));
  await screen.findByText('authenticated:false');
  await act(async () => { old.resolve(session(true)); });
  expect(screen.getByText('authenticated:false')).toBeInTheDocument();
  expect(state.getSessionFast).toHaveBeenCalledTimes(2);
});

it('a late authenticated response cannot restore a signed-out session', async () => {
  const old = deferred(); state.getSessionFast.mockReturnValueOnce(old.promise);
  render(<SessionProvider><Consumer /></SessionProvider>);
  await act(async () => { state.callback?.('SIGNED_OUT'); });
  await act(async () => { old.resolve(session(true)); });
  await waitFor(() => expect(screen.getByText('unauthenticated:undefined')).toBeInTheDocument());
});

it('a new sign-in is not held behind an older profile request', async () => {
  const old = deferred();
  state.getSessionFast.mockReturnValueOnce(old.promise).mockResolvedValueOnce(session(false));
  render(<SessionProvider><Consumer /></SessionProvider>);
  await act(async () => { state.callback?.('SIGNED_IN'); });
  await screen.findByText('authenticated:false');
  await act(async () => { old.resolve(session(true)); });
  expect(screen.getByText('authenticated:false')).toBeInTheDocument();
});
