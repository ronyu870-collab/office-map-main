'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Lock, CheckCircle, AlertCircle } from 'lucide-react';

import { clearSessionCache, getSessionFast } from '@/src/services/Auth';
import { supabase } from '@/src/services/supabaseClient';

export default function SettingsPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [passwordChangeRequired, setPasswordChangeRequired] = React.useState(false);
  const [message, setMessage] = React.useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const isLoadingUser = !userEmail;

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await getSessionFast(); // 使用快速获取方法
        if (cancelled) return;
        if (!session) { router.replace('/login'); return; }
        setUserEmail(session.user.email ?? '');
        setDisplayName(session.displayName ?? '');
        setPasswordChangeRequired(Boolean(session.user.app_metadata?.must_change_password));
      } catch {
        if (!cancelled) router.replace('/login');
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('登录状态已失效，请重新登录');
      const response = await fetch('/api/auth/complete-password-change', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ password: newPassword }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '密码修改失败，请稍后重试');
      await supabase.auth.refreshSession();
      clearSessionCache();
      setMessage({ type: 'success', text: '密码修改成功，下次请使用新密码登录。' });
      setNewPassword('');
      setConfirmPassword('');
      if (passwordChangeRequired) {
        setPasswordChangeRequired(false);
        router.replace('/');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '密码修改失败，请稍后重试';
      setMessage({ type: 'error', text: errorMessage });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 text-zinc-900">
      <header className="shrink-0 border-b border-zinc-200/80 bg-[#003e7e]">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <span className="text-sm font-semibold tracking-tight text-white">设置</span>
          {!passwordChangeRequired && (
            <Link href="/" className="flex items-center gap-1.5 text-[12px] text-white/70 transition hover:text-white">
              <ArrowLeft size={14} strokeWidth={1.5} />
              返回主页
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 overflow-y-auto px-4 py-10 sm:px-6">
        {isLoadingUser ? (
          // ✅ 性能优化：使用骨架屏替代全屏加载器
          <div className="rounded-xl border border-zinc-200/60 bg-white p-7 shadow-sm">
            <div className="mb-6 flex items-center gap-3">
              <div className="h-9 w-9 animate-pulse rounded-lg bg-zinc-200" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 animate-pulse rounded bg-zinc-200" />
                <div className="h-3 w-48 animate-pulse rounded bg-zinc-200" />
              </div>
            </div>
            <div className="space-y-4">
              <div className="h-10 animate-pulse rounded-lg bg-zinc-200" />
              <div className="h-10 animate-pulse rounded-lg bg-zinc-200" />
              <div className="h-10 animate-pulse rounded-lg bg-zinc-200" />
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-200/60 bg-white p-7 shadow-sm">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200/60 bg-zinc-50">
                <Lock size={16} strokeWidth={1.5} className="text-zinc-500" />
              </div>
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-zinc-900">修改登录密码</h2>
                <p className="text-[12px] text-zinc-400">{displayName || userEmail}</p>
              </div>
            </div>
            {passwordChangeRequired && (
              <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-700">
                首次登录需先修改临时密码。
              </div>
            )}
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-zinc-600">新密码</label>
                <input
                  type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少 10 位，包含字母和数字"
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm outline-none transition focus:border-[#003e7e] focus:bg-white focus:ring-2 focus:ring-[#003e7e]/10"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-zinc-600">确认新密码</label>
                <input
                  type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="请再次输入新密码"
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm outline-none transition focus:border-[#003e7e] focus:bg-white focus:ring-2 focus:ring-[#003e7e]/10"
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
              <button
                type="submit" disabled={submitting}
                className="w-full rounded-lg bg-[#003e7e] py-2.5 text-sm font-semibold text-white transition hover:bg-[#002b5e] disabled:opacity-60"
              >
                {submitting ? '保存中…' : '确认修改'}
              </button>
            </form>
            <p className="mt-5 text-center text-[11px] text-zinc-400">
              Supabase Auth 强哈希加密 · 管理员亦无法查看明文密码
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
