'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { getSessionFast } from '@/src/services/Auth';
import { isUserAdmin } from '@/src/utils/accessControl';
import { ComponentErrorBoundary } from '@/src/components/ErrorBoundary/ComponentErrorBoundary';
import { TeamSubmissionMonitor } from '../components/TeamSubmissionMonitor';
import { AppHeader, LoadingState } from '@/src/components/ui';

/**
 * 团队租赁成交填报监控看板（独立页面）
 *
 * 权限：仅限 admin
 * 数据范围：2026-04-23 至今（由 getAllSubmissions 保证）
 *
 * 页面结构：
 * - 面包屑导航
 * - 统计概览区：TeamSubmissionMonitor（含本周统计 + 全量明细下钻）
 */
export default function TeamMonitoringPage() {
  const router = useRouter();
  const [ready, setReady] = React.useState(false);
  const [userRole, setUserRole] = React.useState<string>('');

  React.useEffect(() => {
    setReady(true);

    let cancelled = false;
    void (async () => {
      try {
        const session = await getSessionFast();
        if (cancelled) return;

        if (!session) {
          router.replace('/login');
          return;
        }

        const role = session.role ?? '';
        setUserRole(role);

        if (!isUserAdmin(role)) {
          router.replace('/');
          return;
        }
      } catch (e) {
        console.error('Failed to check session', e);
        if (!cancelled) router.replace('/login');
      }
    })();

    return () => { cancelled = true; };
  }, [router]);

  if (!ready || !userRole) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--cd-color-workspace)] p-4"><LoadingState label="正在进入团队监控" rows={0} /></div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--cd-color-workspace)] text-[var(--cd-color-text-primary)]">
      <header className="sticky top-0 z-[var(--cd-z-sticky)] border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
        <AppHeader
          title="租赁成交团队监控"
          homeHref="/"
          actions={<Link href="/lease-submission" className="inline-flex h-8 items-center gap-1 rounded-[var(--cd-radius-md)] px-2 text-[var(--cd-font-size-sm)] font-medium text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-brand)]"><ArrowLeft size={13} />返回填报</Link>}
        />
      </header>

      <main className="mx-auto w-full max-w-[1500px] p-3 sm:p-5">
        <ComponentErrorBoundary componentName="团队提交监控">
          <TeamSubmissionMonitor userRole={userRole} />
        </ComponentErrorBoundary>
      </main>
    </div>
  );
}
