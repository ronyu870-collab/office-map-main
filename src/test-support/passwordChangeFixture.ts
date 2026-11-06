import type { Session, User } from '@supabase/supabase-js';

// Synthetic Auth/PostgREST boundary for the real SDK and application routes.
// Admin password updates revoke all sessions, matching Supabase Auth's
// UpdatePassword(tx, nil). No production account or network is used.
export function createPasswordChangeFixture() {
  const userId = '11111111-1111-4111-8111-111111111111';
  const email = 'fixture@example.invalid';
  const phone = '13000000000';
  const temporaryPassword = 'Temporary1234';
  const newPassword = 'ChangedPassword1234';
  let password = temporaryPassword;
  let required = true;
  let sequence = 0;
  let customSessionId: string | null = 'fixture-device-session';
  let metadata: Record<string, unknown> = { session_id: customSessionId };
  const validSessions = new Map<string, Session>();
  const audits: Record<string, unknown>[] = [];
  const requests: string[] = [];
  const faults = { signIn: false, profile: false, logout: false, save: false, returnRequired: false };
  const currentUser = (): User => ({
    id: userId, email, aud: 'authenticated', role: 'authenticated',
    app_metadata: { must_change_password: required }, user_metadata: { ...metadata },
    created_at: '2026-01-01T00:00:00Z',
  });
  const issueSession = (expiresIn = 3600): Session => {
    sequence += 1;
    const session: Session = {
      access_token: `fixture-access-${sequence}`, refresh_token: `fixture-refresh-${sequence}`,
      token_type: 'bearer', expires_in: expiresIn,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn, user: currentUser(),
    };
    validSessions.set(session.access_token, session);
    return session;
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  const unauthorized = () => json({ code: 'session_not_found', message: 'Session not found' }, 403);

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    requests.push(`${request.method} ${url.pathname}${url.search}`);
    const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    const active = validSessions.get(bearer);
    if (url.pathname === '/auth/v1/token') {
      const body = await request.json();
      if (url.searchParams.get('grant_type') === 'password') {
        if (faults.signIn) return json({ code: 'unexpected_failure', message: 'Synthetic sign-in unavailable' }, 500);
        if (body.email !== email || body.password !== password) {
          return json({ code: 'invalid_credentials', message: 'Invalid login credentials' }, 400);
        }
        return json(issueSession());
      }
      const session = [...validSessions.values()].find(value => value.refresh_token === body.refresh_token);
      if (!session) return json({ code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' }, 400);
      return json(issueSession());
    }
    if (url.pathname === `/auth/v1/admin/users/${userId}` && request.method === 'PUT') {
      if (bearer !== 'synthetic-service-key') return unauthorized();
      if (faults.save) return json({ code: 'validation_failed', message: 'Synthetic password update rejected' }, 422);
      const body = await request.json();
      password = body.password;
      required = faults.returnRequired || Boolean(body.app_metadata?.must_change_password);
      validSessions.clear();
      return json(currentUser());
    }
    if (url.pathname === '/auth/v1/user') {
      if (!active) return unauthorized();
      if (request.method === 'PUT') metadata = { ...metadata, ...(await request.json()).data };
      return json(currentUser());
    }
    if (url.pathname === '/auth/v1/logout') {
      if (faults.logout) return json({ code: 'unexpected_failure', message: 'Synthetic logout unavailable' }, 500);
      if (!active) return unauthorized();
      validSessions.clear();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/rest/v1/user_roles') {
      if (faults.profile) return json({ code: 'XX000', message: 'Synthetic profile unavailable' }, 500);
      if (request.method === 'PATCH') {
        customSessionId = (await request.json()).session_id;
        return new Response(null, { status: 204 });
      }
      return json({ user_id: userId, email, role: 'editor', full_name: 'Fixture User', chinese_name: '测试用户', session_id: customSessionId, phone });
    }
    if (url.pathname === '/rest/v1/audit_logs' && request.method === 'POST') {
      const body = await request.json();
      audits.push(...(Array.isArray(body) ? body : [body]));
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected fixture request blocked: ${request.method} ${url.pathname}`);
  }
  return {
    userId, email, phone, temporaryPassword, newPassword, issueSession, handle, faults, requests, audits,
    get required() { return required; },
    setRequired(value: boolean) { required = value; },
    get sessionCount() { return validSessions.size; },
    get customSessionId() { return customSessionId; },
  };
}
