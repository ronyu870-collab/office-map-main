import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthSessionResult } from '@/src/services/Auth';

const state = vi.hoisted(() => ({
  getSessionFast: vi.fn(), clearSessionCache: vi.fn(),
  callback: null as null | ((event: string) => void),
  push: vi.fn(), replace: vi.fn(), pathname: '/settings',
  signOut: vi.fn(async () => undefined),
  idleLogout: null as null | (() => Promise<void>),
  trustedMs: null as number | null,
}));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname, useRouter: () => state }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: state.getSessionFast, clearSessionCache: state.clearSessionCache }));
vi.mock('@/src/services/SessionManager', () => ({
  SessionManager: class {
    constructor({ onLogout }: { onLogout: () => Promise<void> }) { state.idleLogout = onLogout; }
    start() {} stop() {} reset() {}
  },
}));
vi.mock('@/src/services/trustedDevice', () => ({ isTrustedDevice: () => state.trustedMs !== null, getTrustedDeviceRemainingMs: () => state.trustedMs }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { auth: {
  signOut: state.signOut,
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
beforeEach(() => { vi.clearAllMocks(); state.callback = null; state.pathname = '/settings'; state.idleLogout = null; state.trustedMs = null; });
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

it.each([
  ['/occupier-insights', false],
  ['/', true],
  ['/map', true],
])('clears an ended session and only redirects protected path %s', async (pathname, redirects) => {
  state.pathname = pathname;
  state.getSessionFast.mockResolvedValueOnce(session(false));
  render(<SessionProvider><Consumer /></SessionProvider>);
  await screen.findByText('authenticated:false');
  await act(async () => { state.callback?.('SIGNED_OUT'); });
  expect(screen.getByText('unauthenticated:undefined')).toBeInTheDocument();
  if (redirects) expect(state.push).toHaveBeenCalledWith('/login');
  else expect(state.push).not.toHaveBeenCalled();
});

it('keeps the report open after inactivity clears an active session', async () => {
  state.pathname = '/occupier-insights';
  state.getSessionFast.mockResolvedValueOnce({ ...session(false), session: { access_token: 'synthetic' } });
  render(<SessionProvider><Consumer /></SessionProvider>);
  await screen.findByText('authenticated:false');
  expect(state.idleLogout).toBeTypeOf('function');
  await act(async () => { await state.idleLogout?.(); });
  expect(state.signOut).toHaveBeenCalledTimes(1);
  expect(screen.getByText('unauthenticated:undefined')).toBeInTheDocument();
  expect(state.push).not.toHaveBeenCalled();
});

it('keeps the report open after a trusted session expires', async () => {
  state.pathname = '/occupier-insights';
  state.trustedMs = 50;
  state.getSessionFast.mockResolvedValueOnce({ ...session(false), session: { access_token: 'synthetic' } });
  vi.useFakeTimers();
  try {
    render(<SessionProvider><Consumer /></SessionProvider>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('authenticated:false')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(state.signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByText('unauthenticated:undefined')).toBeInTheDocument();
    expect(state.push).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
