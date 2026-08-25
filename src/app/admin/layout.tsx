'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSession, signOut } from '@/src/services/Auth';
import { isDemoMode } from '@/src/config/demoMode';
import { canAccessAdminConsole } from '@/src/utils/adminAccess';

function AdminGuardLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--cd-color-canvas)]">
      <div className="w-full max-w-sm px-6 text-center" role="status" aria-live="polite">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[var(--cd-color-brand)] border-t-transparent" />
        <p className="mt-3 text-xs font-medium text-[var(--cd-color-text-muted)]">正在校验管理权限…</p>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = React.useState(false);
  const [allowed, setAllowed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        // Admin 必须始终基于真实 Supabase 会话判断。getSessionFast 会在模拟模式下
        // 返回合成用户身份，不能用于管理后台授权。
        const session = await getSession();
        if (cancelled) return;

        const permitted = Boolean(session) && canAccessAdminConsole({
          role: session?.role,
          email: session?.user?.email,
          isDemo: isDemoMode(session?.user?.email),
        });

        if (!permitted) {
          router.replace('/');
          return;
        }

        setAllowed(true);
        setReady(true);
      } catch {
        if (!cancelled) router.replace('/');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleLogout() {
    try {
      await signOut();
    } finally {
      window.location.href = '/login';
    }
  }

  if (!ready || !allowed) return <AdminGuardLoading />;

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--cd-color-canvas)] text-[var(--cd-color-text-primary)]">
      <header className="z-40 shrink-0 border-b border-[#163a5f] bg-[#003e7e] text-white">
        <div className="flex h-12 items-center justify-between gap-3 px-3 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-sm font-semibold tracking-tight">系统管理</span>
              <span className="hidden text-[10px] font-medium uppercase tracking-[0.12em] text-white/55 sm:inline">数据管理后台</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-xs">
            <Link href="/" className="rounded-md px-2.5 py-1.5 text-white/75 transition hover:bg-white/10 hover:text-white">
              返回工作区
            </Link>
            <button type="button" onClick={handleLogout} className="rounded-md px-2.5 py-1.5 text-white/75 transition hover:bg-white/10 hover:text-white">
              退出
            </button>
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
