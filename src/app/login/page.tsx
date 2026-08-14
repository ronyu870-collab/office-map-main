'use client';

import * as React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, Lock, Mail, Phone } from 'lucide-react';

import { getSessionFast, signInWithPassword } from '@/src/services/Auth';
import { logActionImmediate } from '@/src/utils/audit';
import { perfStart, perfEnd, perfMark } from '@/src/utils/performanceLogger';
import { setTrustedDevice } from '@/src/services/trustedDevice';
import { COLLIERS_LOGO_DATA_URI } from '@/src/constants/brandAssets';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [trustDevice, setTrustDevice] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await getSessionFast();
        if (!cancelled && session) {
          router.replace(session.user.app_metadata?.must_change_password ? '/settings?required=1' : '/');
        }
      } catch { /* stay */ }
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{11}$/.test(phone.trim())) {
      setError('请输入有效的 11 位手机号码');
      return;
    }

    perfStart('登录-总耗时');
    setSubmitting(true);

    try {
      perfStart('登录-验证凭据');
      setTrustedDevice(trustDevice);
      const result = await signInWithPassword({ email: email.trim(), password, phone: phone.trim() });
      perfEnd('登录-验证凭据');

      perfStart('登录-记录日志');
      void logActionImmediate(email.trim(), 'LOGIN', { status: 'success', platform: 'web', trusted_device: trustDevice });
      perfEnd('登录-记录日志');

      perfEnd('登录-总耗时');
      perfMark('登录-开始客户端跳转');
      router.replace(result.user.app_metadata?.must_change_password ? '/settings?required=1' : '/');
    } catch (err) {
      perfEnd('登录-总耗时');
      setError(err instanceof Error ? err.message : '登录失败，请检查邮箱与密码');
      void logActionImmediate(email.trim(), 'LOGIN_FAILED', { error: err instanceof Error ? err.message : '未知错误' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-x-hidden bg-[#f3f6fa] px-4 py-10">
      <div className="pointer-events-none absolute -left-32 -top-40 h-96 w-96 rounded-full bg-[#003e7e]/[0.035]" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-56 -right-32 h-[28rem] w-[28rem] rounded-full bg-[#28a9df]/[0.04]" aria-hidden="true" />

      <div className="relative w-full max-w-[430px]">
        <div className="mb-6 flex items-center justify-center gap-4 text-left">
          <Image
            src={COLLIERS_LOGO_DATA_URI}
            alt="Colliers 高力国际"
            width={592}
            height={337}
            priority
            className="h-auto w-[112px] shrink-0"
          />
          <div className="border-l border-zinc-200 pl-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#003e7e]/70">COLLIERS DATA</p>
            <h1 className="mt-1.5 text-[25px] font-semibold tracking-[-0.02em] text-zinc-900">登录系统</h1>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200/70 bg-white p-7 shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:p-8">
          <form className="space-y-5" onSubmit={handleSubmit} aria-busy={submitting}>
            <div>
              <label htmlFor="email" className="mb-2 block text-[13px] font-medium text-zinc-700">企业邮箱</label>
              <div className="relative">
                <Mail size={15} strokeWidth={1.5} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@colliers.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50/70 pl-10 pr-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 hover:border-zinc-300 focus:border-[#003e7e] focus:bg-white focus-visible:ring-2 focus-visible:ring-[#003e7e]/15"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="phone" className="mb-2 block text-[13px] font-medium text-zinc-700">手机号</label>
              <div className="relative">
                <Phone size={15} strokeWidth={1.5} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="请输入 11 位手机号"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50/70 pl-10 pr-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 hover:border-zinc-300 focus:border-[#003e7e] focus:bg-white focus-visible:ring-2 focus-visible:ring-[#003e7e]/15"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-[13px] font-medium text-zinc-700">密码</label>
              <div className="relative">
                <Lock size={15} strokeWidth={1.5} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50/70 pl-10 pr-11 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 hover:border-zinc-300 focus:border-[#003e7e] focus:bg-white focus-visible:ring-2 focus-visible:ring-[#003e7e]/15"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(prev => !prev)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/20"
                >
                  {showPassword ? <EyeOff size={16} strokeWidth={1.5} /> : <Eye size={16} strokeWidth={1.5} />}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-0.5">
              <input
                id="trust-device"
                name="trust-device"
                type="checkbox"
                checked={trustDevice}
                onChange={event => setTrustDevice(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-zinc-300 text-[#003e7e] focus:ring-[#003e7e]/20"
              />
              <label htmlFor="trust-device" className="cursor-pointer text-[12px] text-zinc-500">信任此设备 14 天</label>
            </div>

            {error && (
              <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3.5 py-3 text-[13px] leading-5 text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#003e7e] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#002b5e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? '登录中…' : <>登录系统 <ArrowRight size={15} strokeWidth={1.5} /></>}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-[11px] text-zinc-400">高力国际内部系统 · 仅限授权用户访问</p>
      </div>
    </div>
  );
}
