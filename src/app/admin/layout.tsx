'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSession, getSessionFast, signOut } from '@/src/services/Auth';
import { isDemoMode } from '@/src/config/demoMode';

function AdminGuardLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
        <p className="mt-4 text-xs tracking-wide text-zinc-500">正在校验管理员权限…</p>
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
        // 模拟模式下允许访问管理后台
        const impState = typeof window !== 'undefined' ? sessionStorage.getItem('__impersonation_state') : null;
        if (impState) {
          if (!cancelled) {
            setAllowed(true);
            setReady(true);
          }
          return;
        }

        const session = await getSessionFast(); // 使用快速获取方法
        if (cancelled) return;

        const isDemo = isDemoMode(session?.user?.email);
        if (!session || (session.role !== 'admin' && !isDemo)) {
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

  if (!ready || !allowed) {
    return <AdminGuardLoading />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 text-zinc-900">
      <header className="shrink-0 border-b border-zinc-200/80 bg-[#003e7e]">
        <div className="mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tracking-tight text-white">管理后台</span>
            <span className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-medium text-white/60">Admin Console</span>
          </div>
          <div className="flex items-center gap-1 text-[12px]">
            <Link href="/admin" className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-white/70 transition hover:bg-white/10 hover:text-white">
              总览
            </Link>
            <Link href="/admin/display-overrides" className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-white/70 transition hover:bg-white/10 hover:text-white">
              显示覆盖
            </Link>
            <Link href="/" className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-white/70 transition hover:bg-white/10 hover:text-white">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
              返回首页
            </Link>
            <button type="button" onClick={handleLogout} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-white/70 transition hover:bg-white/10 hover:text-white">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              退出登录
            </button>
          </div>
        </div>
      </header>

      {/* 内容区：全宽 */}
      <div className="flex w-full h-full flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}