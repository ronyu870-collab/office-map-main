'use client';

import * as React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, Lock, Mail, Phone } from 'lucide-react';

import { getSessionFast, signInWithPassword } from '@/src/services/Auth';
import { logActionImmediate } from '@/src/utils/audit';
import { perfStart, perfEnd, perfMark } from '@/src/utils/performanceLogger';
import { setTrustedDevice } from '@/src/services/trustedDevice';
import { hasPasswordChangeNotice, setPasswordChangeNotice } from '@/src/services/passwordChangeNotice';
import { Button, IconButton, Input } from '@/src/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [trustDevice, setTrustDevice] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [passwordChanged, setPasswordChanged] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await getSessionFast();
        if (cancelled) return;
        setPasswordChanged(hasPasswordChangeNotice());
        if (session) {
          router.replace(session.user.app_metadata?.must_change_password ? '/settings?required=1' : '/');
        }
      } catch {
        if (!cancelled) setPasswordChanged(hasPasswordChangeNotice());
      }
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
      setPasswordChangeNotice(false);
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
    <main className="flex min-h-screen items-center justify-center bg-[var(--cd-color-workspace)] px-4 py-8">
      <div className="w-full max-w-[400px]">
        <div className="mb-5 flex items-center justify-center gap-4 text-left">
          <Image
            src="/colliers-logo.png"
            unoptimized
            alt="Colliers 高力国际"
            width={592}
            height={337}
            priority
            className="h-auto w-[104px] shrink-0"
          />
          <div className="border-l border-[var(--cd-color-border)] pl-4">
            <p className="text-[var(--cd-font-size-xs)] text-[var(--cd-color-text-secondary)]">北京办公楼市场数据平台</p>
            <h1 className="mt-1 text-[var(--cd-font-size-xl)] font-semibold text-[var(--cd-color-text-primary)]">登录</h1>
          </div>
        </div>

        <div className="rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-6 shadow-[var(--cd-shadow-sm)] sm:p-7">
          <form className="space-y-4" onSubmit={handleSubmit} aria-busy={submitting}>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-[var(--cd-font-size-sm)] font-medium text-[var(--cd-color-text-secondary)]">企业邮箱</label>
              <div className="relative">
                <Mail size={15} strokeWidth={1.5} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--cd-color-text-muted)]" aria-hidden="true" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@colliers.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="phone" className="mb-1.5 block text-[var(--cd-font-size-sm)] font-medium text-[var(--cd-color-text-secondary)]">手机号</label>
              <div className="relative">
                <Phone size={15} strokeWidth={1.5} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--cd-color-text-muted)]" aria-hidden="true" />
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="请输入 11 位手机号"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-[var(--cd-font-size-sm)] font-medium text-[var(--cd-color-text-secondary)]">密码</label>
              <div className="relative">
                <Lock size={15} strokeWidth={1.5} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--cd-color-text-muted)]" aria-hidden="true" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="pl-9 pr-10"
                  required
                />
                <IconButton
                  onClick={() => setShowPassword(prev => !prev)}
                  label={showPassword ? '隐藏密码' : '显示密码'}
                  variant="ghost"
                  size="sm"
                  className="absolute right-0.5 top-1/2 -translate-y-1/2"
                >
                  {showPassword ? <EyeOff size={16} strokeWidth={1.5} /> : <Eye size={16} strokeWidth={1.5} />}
                </IconButton>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-0.5">
              <input
                id="trust-device"
                name="trust-device"
                type="checkbox"
                checked={trustDevice}
                onChange={event => setTrustDevice(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-[var(--cd-color-border-strong)] accent-[var(--cd-color-brand)] focus:ring-[var(--cd-color-focus)]"
              />
              <label htmlFor="trust-device" className="cursor-pointer text-[var(--cd-font-size-xs)] text-[var(--cd-color-text-secondary)]">信任此设备 14 天</label>
            </div>

            {passwordChanged && (
              <p role="status" className="text-[var(--cd-font-size-sm)] text-[var(--cd-color-text-secondary)]">
                密码已修改，请使用新密码重新登录。
              </p>
            )}

            {error && (
              <div role="alert" className="rounded-[var(--cd-radius-md)] border border-[color:rgb(201_54_43_/_0.15)] bg-[var(--cd-color-danger-soft)] px-3 py-2.5 text-[var(--cd-font-size-sm)] text-[var(--cd-color-danger)]">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="mt-1 w-full"
            >
              {submitting ? '登录中…' : <>登录 <ArrowRight size={15} strokeWidth={1.5} /></>}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-[var(--cd-font-size-xs)] text-[var(--cd-color-text-muted)]">高力国际内部系统 · 仅限授权用户访问</p>
      </div>
    </main>
  );
}
