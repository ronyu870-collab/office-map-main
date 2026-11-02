import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPasswordChangeFixture } from '@/src/test-support/passwordChangeFixture';

const navigation = vi.hoisted(() => ({ path: '/settings', replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.path, useRouter: () => navigation }));
vi.mock('@/src/services/SessionManager', () => ({ SessionManager: class { start() {} stop() {} reset() {} } }));
vi.mock('@/src/components/SessionWarningBanner', () => ({ SessionWarningBanner: () => null }));

let client: SupabaseClient;
let fixture: ReturnType<typeof createPasswordChangeFixture>;
let App: () => React.JSX.Element;

beforeEach(async () => {
  vi.resetModules();
  navigation.path = '/settings'; navigation.replace.mockReset(); navigation.push.mockReset();
  localStorage.clear(); sessionStorage.clear();
  fixture = createPasswordChangeFixture();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.supabase.invalid');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic-publishable');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic-service-key');
  const { POST } = await import('@/src/app/api/auth/complete-password-change/route');
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const request = input instanceof Request ? input : new Request(new URL(url, 'https://application.invalid'), init);
    if (request.url === 'https://application.invalid/api/auth/complete-password-change') return POST(request as never);
    if (new URL(request.url).origin !== 'https://fixture.supabase.invalid') throw new Error('External network blocked');
    return fixture.handle(request);
  });
  client = (await import('@/src/services/supabaseClient')).getSupabaseClient();
  await client.auth.stopAutoRefresh();
  const { default: Settings } = await import('@/src/app/settings/page');
  const { SessionProvider, useAppSession } = await import('@/src/components/SessionProvider');
  function Snapshot() {
    const { session, status } = useAppSession();
    return <output data-testid="session">{status}:{String(session?.user.app_metadata?.must_change_password)}</output>;
  }
  App = function TestApp() {
    return <SessionProvider><Snapshot /><Settings /></SessionProvider>;
  };
});

afterEach(async () => {
  cleanup();
  await client?.auth.stopAutoRefresh();
  // Close the real SDK's browser event channel so one case cannot affect another.
  (client?.auth as unknown as { broadcastChannel?: BroadcastChannel }).broadcastChannel?.close();
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

async function seed(trusted: boolean, expiresIn = 3600) {
  const { setTrustedDevice, deviceAwareAuthStorage } = await import('@/src/services/trustedDevice');
  setTrustedDevice(trusted);
  const session = fixture.issueSession(expiresIn);
  deviceAwareAuthStorage.setItem('sb-fixture-auth-token', JSON.stringify(session));
  const { clearSessionCache } = await import('@/src/services/Auth'); clearSessionCache();
  return session;
}
async function submit() {
  await screen.findByLabelText('新密码');
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: fixture.newPassword } });
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: fixture.newPassword } });
  fireEvent.click(screen.getByRole('button', { name: '确认修改' }));
}

describe('password change through actual page, route, SDK, storage and session provider', () => {
  it.each([
    { trusted: false, required: true }, { trusted: true, required: true },
    { trusted: false, required: false }, { trusted: true, required: false },
  ])('returns home, survives same-browser reload and logout/new-password login (%j)', async ({ trusted, required }) => {
    fixture.setRequired(required);
    const previous = await seed(trusted);
    const view = render(<App />);
    await submit();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'));
    await act(async () => { navigation.path = '/'; view.rerender(<App />); });
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('authenticated:false'));
    expect(navigation.replace).not.toHaveBeenCalledWith('/settings?required=1');
    const changed = (await client.auth.getSession()).data.session;
    expect(changed?.access_token).not.toBe(previous.access_token);
    expect(changed?.user.app_metadata.must_change_password).toBe(false);
    expect(fixture.required).toBe(false);
    expect(fixture.audits.filter(row => row.action_type === 'CHANGE_PASSWORD')).toHaveLength(1);
    expect(fixture.customSessionId).toBe('fixture-device-session');
    expect(fixture.requests.filter(url => url.includes('grant_type=refresh_token'))).toHaveLength(0);

    // Remount with browser storage preserved, including a fresh Auth module cache.
    view.unmount();
    const auth = await import('@/src/services/Auth'); auth.clearSessionCache();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('authenticated:false'));
    expect(navigation.replace).not.toHaveBeenCalledWith('/settings?required=1');

    await act(async () => { await auth.signOut(); });
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(sessionStorage.getItem('__auth_session_cache')).toBeNull();
    await expect(auth.signInWithPassword({ email: fixture.email, password: fixture.temporaryPassword, phone: fixture.phone })).rejects.toThrow('登录失败');
    await expect(auth.signInWithPassword({ email: fixture.email, password: fixture.newPassword, phone: '13999999999' })).rejects.toThrow('邮箱、手机号或密码不匹配');
    await act(async () => { await auth.signInWithPassword({ email: fixture.email, password: fixture.newPassword, phone: fixture.phone }); });
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('authenticated:false'));
    expect((await auth.getSessionFast())?.user.app_metadata.must_change_password).toBe(false);
  });

  it('refreshes an expired access token before saving, then replaces the revoked session', async () => {
    await seed(false, -1);
    render(<App />); await submit();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'));
    expect((await client.auth.getSession()).data.session?.user.app_metadata.must_change_password).toBe(false);
  });

  it('preserves the server impersonation guard before modifying any password', async () => {
    await seed(false);
    sessionStorage.setItem('__impersonation_state', JSON.stringify({ targetUserId: '22222222-2222-4222-8222-222222222222' }));
    render(<App />); await submit();
    await screen.findByText('用户模拟状态无效，请退出模拟后重试');
    expect(fixture.required).toBe(true);
    expect(fixture.audits).toHaveLength(0);
    expect(fixture.requests.some(value => value.startsWith('PUT /auth/v1/admin/users/'))).toBe(false);
  });

  it('distinguishes a saved password from failed reauthentication and clears only auth state', async () => {
    await seed(true); fixture.faults.signIn = true; fixture.faults.logout = true;
    sessionStorage.setItem('quarterly-draft-sentinel', 'keep');
    const view = render(<App />); await submit();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/login'));
    expect(fixture.required).toBe(false);
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(sessionStorage.getItem('__auth_session_cache')).toBeNull();
    expect(sessionStorage.getItem('quarterly-draft-sentinel')).toBe('keep');
    expect((await import('@/src/services/passwordChangeNotice')).hasPasswordChangeNotice()).toBe(true);
    expect(navigation.replace).not.toHaveBeenCalledWith('/');
    view.unmount();
  });

  it('stays on settings if the server rejects the password update', async () => {
    const old = await seed(false); fixture.faults.save = true;
    render(<App />); await submit();
    await screen.findByText(/密码修改失败/);
    expect(fixture.required).toBe(true);
    expect((await client.auth.getSession()).data.session?.access_token).toBe(old.access_token);
    expect(fixture.audits).toHaveLength(0);
    expect(navigation.replace).not.toHaveBeenCalledWith('/');
  });

  it('does not accept a replacement session that still requires a password change', async () => {
    await seed(false); fixture.faults.returnRequired = true;
    render(<App />); await submit();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/login'));
    expect(navigation.replace).not.toHaveBeenCalledWith('/');
    expect((await client.auth.getSession()).data.session).toBeNull();
  });
});
