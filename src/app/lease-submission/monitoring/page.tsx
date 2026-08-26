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
 *
 * 页面结构：
 * - 面包屑导航
 * - 统计概览区：TeamSubmissionMonitor（含本周统计 + 全量明细下钻）
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
      <div className="flex h-screen items-center justify-center bg-[#eef2f6] p-4 text-slate-900">
        <div className="rounded-lg border border-[#d9e0e8] bg-white px-5 py-4 text-center shadow-[0_2px_8px_rgba(23,32,51,0.06)]">
          <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-[#003e7e]" />
          <div className="mt-2 text-[11px] font-medium text-slate-500">正在进入团队监控…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eef2f6] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-[#f8fafc]/95 backdrop-blur-xl">
        <div className="mx-auto flex min-h-[58px] max-w-[1500px] items-center justify-between gap-3 px-3 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#003e7e] text-white shadow-sm"><Users size={15} /></div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[13px] font-semibold text-slate-900">租赁成交团队监控</h1>
                <span className="hidden rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-medium text-slate-400 sm:inline-flex">管理视图</span>
              </div>
              <p className="mt-0.5 truncate text-[10px] text-slate-400">团队周度填报进度与成交明细</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/lease-submission" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-medium text-slate-600 transition hover:border-[#003e7e]/25 hover:text-[#003e7e]"><ArrowLeft size={13} /> 返回填报</Link>
            <Link href="/" className="hidden h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-medium text-slate-600 transition hover:border-[#003e7e]/25 hover:text-[#003e7e] sm:inline-flex"><Home size={13} /> 主页</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1500px] p-3 sm:p-5">
        <nav className="mb-3 flex items-center gap-1.5 text-[10px] text-slate-400" aria-label="当前位置">
          <Link href="/" className="transition hover:text-[#003e7e]">首页</Link>
          <ChevronRight size={12} />
          <Link href="/lease-submission" className="transition hover:text-[#003e7e]">租赁成交填报</Link>
          <ChevronRight size={12} />
          <span className="font-medium text-slate-600">团队监控</span>
        </nav>

        <div className="mb-4 rounded-lg border border-[#d9e0e8] bg-white px-4 py-3 shadow-[0_1px_3px_rgba(23,32,51,0.03)] sm:px-5">
          <h2 className="text-sm font-semibold text-slate-900">团队填报概览</h2>
          <p className="mt-1 text-[11px] text-slate-500">当前管理员：<MaskedText>{userName || '管理者'}</MaskedText> · 点击成员姓名可筛选查看对应成交明细。</p>
        </div>

        <ComponentErrorBoundary componentName="团队提交监控">
          <TeamSubmissionMonitor userRole={userRole} />
        </ComponentErrorBoundary>
      </main>
    </div>
  );
}
