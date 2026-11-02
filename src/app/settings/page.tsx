'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Lock, CheckCircle, AlertCircle } from 'lucide-react';

import { useAppSession } from '@/src/components/SessionProvider';
import { completePasswordChange, discardPasswordChangeSession, PasswordChangedSessionError } from '@/src/services/passwordChange';
import { AppHeader, Button, Input, LoadingState, Panel } from '@/src/components/ui';

export default function SettingsPage() {
  const router = useRouter();
  const { session: appSession, status, refreshSession } = useAppSession();
  const userEmail = appSession?.user.email ?? '';
  const displayName = appSession?.displayName ?? '';
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const passwordChangeRequired = Boolean(appSession?.user.app_metadata?.must_change_password);
  const [message, setMessage] = React.useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const isLoadingUser = status !== 'authenticated' || !userEmail;

  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (newPassword.length < 10) { setMessage({ type: 'error', text: '密码长度不能少于 10 位' }); return; }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setMessage({ type: 'error', text: '密码必须同时包含字母和数字' });
      return;
    }
    if (newPassword !== confirmPassword) { setMessage({ type: 'error', text: '两次输入的密码不一致' }); return; }
    setSubmitting(true);
    try {
      const nextSession = await completePasswordChange(newPassword);
      const resolved = await refreshSession();
      if (!resolved || resolved.user.id !== nextSession.user.id || resolved.user.app_metadata?.must_change_password !== false) {
        await discardPasswordChangeSession().catch(() => undefined);
        throw new PasswordChangedSessionError();
      }
      setNewPassword('');
      setConfirmPassword('');
      router.replace('/');
    } catch (err: unknown) {
      if (err instanceof PasswordChangedSessionError) {
        setNewPassword('');
        setConfirmPassword('');
        router.replace('/login');
        return;
      }
      const errorMessage = err instanceof Error ? err.message : '密码修改失败，请稍后重试';
      setMessage({ type: 'error', text: errorMessage });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--cd-color-canvas)] text-[var(--cd-color-text-primary)]">
      <header className="shrink-0 border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
        <div className="mx-auto w-full max-w-3xl">
          <AppHeader title="设置" homeHref={passwordChangeRequired ? undefined : '/'} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 overflow-y-auto px-4 py-8 sm:px-6">
        {isLoadingUser ? (
          <Panel><LoadingState label="正在加载账户设置" /></Panel>
        ) : (
          <Panel className="p-6">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]">
                <Lock size={16} strokeWidth={1.5} className="text-[var(--cd-color-text-secondary)]" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[var(--cd-color-text-primary)]">修改登录密码</h2>
                <p className="text-xs text-[var(--cd-color-text-muted)]">{displayName || userEmail}</p>
              </div>
            </div>
            {passwordChangeRequired && (
              <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-700">
                首次登录需先修改临时密码。
              </div>
            )}
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div>
                <label htmlFor="new-password" className="mb-1.5 block text-xs font-medium text-[var(--cd-color-text-secondary)]">新密码</label>
                <Input id="new-password"
                  type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少 10 位，包含字母和数字"
                  required
                />
              </div>
              <div>
                <label htmlFor="confirm-password" className="mb-1.5 block text-xs font-medium text-[var(--cd-color-text-secondary)]">确认新密码</label>
                <Input id="confirm-password"
                  type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="请再次输入新密码"
                  required
                />
              </div>
              {message && (
                <div className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[12px] ${
                  message.type === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-600'
                }`}>
                  {message.type === 'success'
                    ? <CheckCircle size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" />
                    : <AlertCircle size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" />}
                  <span>{message.text}</span>
                </div>
              )}
              <Button
                type="submit" disabled={submitting}
                className="w-full"
              >
                {submitting ? '保存中…' : '确认修改'}
              </Button>
            </form>
          </Panel>
        )}
      </main>
    </div>
  );
}
