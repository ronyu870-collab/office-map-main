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

  // 鉴权检查
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

        // 权限校验：admin、demo 可以访问
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

  // 加载中（鉴权未完成）
  if (!ready || !userRole) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-zinc-900">
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-zinc-900">
      {/* ── Header ── */}
      <header className="border-b border-gray-200/60 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Users size={20} className="text-[#003e7e]" />
            <h1 className="text-xl font-medium text-gray-900">团队提交监控</h1>
            <span className="rounded border border-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500">
              Team Monitoring
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/lease-submission"
              className="flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-gray-700"
            >
              <ArrowLeft size={16} />
              返回填报页
            </Link>
            <Link
              href="/"
              className="flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-gray-700"
            >
              <Home size={16} />
              主页
            </Link>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="mx-auto w-full max-w-7xl px-6 py-8">
        {/* 面包屑导航 */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/" className="transition hover:text-gray-700">
            首页
          </Link>
          <ChevronRight size={14} />
          <Link href="/lease-submission" className="transition hover:text-gray-700">
            租赁成交填报
          </Link>
          <ChevronRight size={14} />
          <span className="font-medium text-gray-900">团队监控</span>
        </nav>

        {/* 欢迎语 */}
        <div className="mb-8">
          <h2 className="text-2xl font-medium text-gray-900">
            欢迎，<MaskedText>{userName || '管理者'}</MaskedText>
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            实时监控团队填报进度 · 点击姓名可过滤查看该员工的成交明细
          </p>
        </div>

        {/* 统计概览 + 明细下钻（全部由 TeamSubmissionMonitor 承载） */}
        <ComponentErrorBoundary componentName="团队提交监控">
          <TeamSubmissionMonitor userRole={userRole} />
        </ComponentErrorBoundary>
      </main>
    </div>
  );
}
