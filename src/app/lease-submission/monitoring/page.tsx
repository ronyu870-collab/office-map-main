'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Users, Home, ChevronRight } from 'lucide-react';

import { getSessionFast } from '@/src/services/Auth';
import { isUserAdmin } from '@/src/utils/accessControl';
import { ComponentErrorBoundary } from '@/src/components/ErrorBoundary/ComponentErrorBoundary';
import { TeamSubmissionMonitor } from '../components/TeamSubmissionMonitor';
import { MaskedText } from '@/src/components/demo';
import { isDemoMode } from '@/src/config/demoMode';

/**
 * 团队租赁成交填报监控看板（独立页面）
 *
 * 权限：仅限 admin
 * 数据范围：2026-04-23 至今（由 getAllSubmissions 保证）
 */
export default function TeamMonitoringPage() {
  const router = useRouter();
  const [ready, setReady] = React.useState(false);
  const [userRole, setUserRole] = React.useState<string>('');
  const [userName, setUserName] = React.useState<string>('');

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
        setUserName(session.displayName ?? '');

        const isDemo = isDemoMode(session.user?.email);
        if (!isUserAdmin(role) && !isDemo) {
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
      <div className="flex h-screen h-[100dvh] flex-col overflow-hidden bg-[#f3f5f7] text-zinc-900">
        <div className="flex flex-1 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-200 border-t-[#003e7e]" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f5f7] text-zinc-900">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-14 max-w-[1500px] flex-wrap items-center gap-3 px-3 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[#003e7e]/8 text-[#003e7e]">
              <Users size={16} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[13px] font-semibold tracking-[0.06em] text-zinc-900">租赁成交填报 · 团队监控</h1>
              <p className="mt-0.5 truncate text-[10px] text-zinc-400">查看团队填报进度与成交明细</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/lease-submission" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 text-[10px] font-semibold text-zinc-600 transition hover:bg-zinc-50">
              <ArrowLeft size={12} /> 返回填报页
            </Link>
            <Link href="/" className="hidden h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 text-[10px] font-semibold text-zinc-600 transition hover:bg-zinc-50 sm:inline-flex">
              <Home size={12} /> 主页
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1500px] px-3 py-4 sm:px-5 sm:py-5">
        <nav className="mb-4 flex items-center gap-1.5 text-[10px] text-zinc-400" aria-label="当前位置">
          <Link href="/" className="transition hover:text-zinc-700">首页</Link>
          <ChevronRight size={11} />
          <Link href="/lease-submission" className="transition hover:text-zinc-700">租赁成交填报</Link>
          <ChevronRight size={11} />
          <span className="font-medium text-zinc-600">团队监控</span>
        </nav>

        <div className="mb-4 flex flex-col gap-1 border-b border-zinc-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">团队成交填报进度</h2>
            <p className="mt-1 text-[11px] text-zinc-500">当前用户：<MaskedText>{userName || '管理者'}</MaskedText> · 点击成员姓名可下钻查看成交明细</p>
          </div>
          <p className="text-[10px] text-zinc-400">统计范围自 2026 年 5 月 4 日起</p>
        </div>

        <ComponentErrorBoundary componentName="团队提交监控">
          <TeamSubmissionMonitor userRole={userRole} />
        </ComponentErrorBoundary>
      </main>
    </div>
  );
}
