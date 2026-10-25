'use client';

import * as React from 'react';
import { GRID_DRAFT_PREFIX } from '@/src/components/admin/grid/useGridRecovery';
import { AdminEditProtection, useAdminEditProtection } from '@/src/components/admin/AdminEditProtection';
import { useRouter } from 'next/navigation';
import { getSession, signOut } from '@/src/services/Auth';
import { isDemoMode } from '@/src/config/demoMode';
import { useImpersonation } from '@/src/contexts/ImpersonationContext';
import { canAccessAdminConsole } from '@/src/utils/adminAccess';
import { AppHeader, Button, LoadingState } from '@/src/components/ui';

function AdminGuardLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--cd-color-canvas)] px-6">
      <LoadingState label="正在校验管理权限…" rows={0} className="w-full max-w-sm" />
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminEditProtection><ProtectedAdminLayout>{children}</ProtectedAdminLayout></AdminEditProtection>;
}

function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const { requestNavigation } = useAdminEditProtection();
  const router = useRouter();
  const { isImpersonating } = useImpersonation();
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
          isDemo: isDemoMode(session?.user?.email),
          impersonationActive: isImpersonating,
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
  }, [isImpersonating, router]);

  async function handleLogout() {
    try {
      try {
      const session = await getSession();
      if (session?.user?.id) {
        const prefix = `${GRID_DRAFT_PREFIX}${session.user.id}:`;
        for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix)) sessionStorage.removeItem(key);
      }
      } catch { /* Storage availability must not prevent sign-out. */ }
      await signOut();
    } finally {
      window.location.href = '/login';
    }
  }

  if (!ready || !allowed) return <AdminGuardLoading />;

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--cd-color-canvas)] text-[var(--cd-color-text-primary)]">
      <header className="z-[var(--cd-z-sticky)] shrink-0 border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
        <AppHeader
          title="系统管理"
          homeHref="/"
          actions={<Button variant="ghost" size="sm" onClick={() => { void requestNavigation(() => { void handleLogout(); }); }}>退出登录</Button>}
        />
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
