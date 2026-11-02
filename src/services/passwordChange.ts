import type { Session } from '@supabase/supabase-js';
import { clearSessionCache } from './Auth';
import { withImpersonationHeaders } from './impersonationHeaders';
import { supabase } from './supabaseClient';
import { setPasswordChangeNotice } from './passwordChangeNotice';

export class PasswordChangedSessionError extends Error {
  constructor() {
    super('密码已修改，请使用新密码重新登录。');
    this.name = 'PasswordChangedSessionError';
  }
}

/** Discard authentication only; preserve business drafts and device preferences. */
export async function discardPasswordChangeSession(): Promise<void> {
  setPasswordChangeNotice(true);
  clearSessionCache();
  try {
    // The old session may already have been revoked by the password update.
    // The SDK clears local storage even when the logout endpoint rejects it.
    await supabase.auth.signOut({ scope: 'local' });
  } finally {
    clearSessionCache();
  }
}

/** Continue an already authenticated account operation, without changing login's phone check. */
export async function completePasswordChange(password: string): Promise<Session> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token || !session.user.email) {
    throw new Error('登录状态已失效，请重新登录');
  }

  const response = await fetch('/api/auth/complete-password-change', {
    method: 'POST',
    headers: withImpersonationHeaders({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    }),
    body: JSON.stringify({ password }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || '密码修改失败，请稍后重试');

  // Admin password updates revoke the previous refresh token. Establish a new
  // session with the saved password instead of refreshing the revoked session.
  clearSessionCache();
  try {
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password,
    });
    if (
      signInError || !data.session || !data.user ||
      data.user.id !== session.user.id || data.session.user.id !== session.user.id ||
      data.session.user.app_metadata?.must_change_password !== false
    ) {
      throw new PasswordChangedSessionError();
    }
    return data.session;
  } catch {
    // Saving succeeded. Recovery must not ask the user to change the password
    // again or leave a revoked session able to redirect them back to settings.
    await discardPasswordChangeSession().catch(() => undefined);
    throw new PasswordChangedSessionError();
  }
}
