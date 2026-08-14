'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, AlertCircle, Plus, Building2, Calendar, FileText, Edit2, ArrowRight, Maximize2, Minimize2, Gift, X } from 'lucide-react';

import { getSessionFast } from '@/src/services/Auth';
import { logAction } from '@/src/utils/audit';
import { getWeeklyProgress, getMySubmissions, getAllSubmissions, getAllBrokers } from '@/src/services/leaseTransactionSubmitService';
import { isUserAdmin } from '@/src/utils/accessControl';
import { MaskedCell } from '@/src/components/demo';
import { isDemoMode } from '@/src/config/demoMode';
import { ComponentErrorBoundary } from '@/src/components/ErrorBoundary/ComponentErrorBoundary';
import { retryAsync } from '@/src/utils/retryAsync';
import { LeaseTransactionForm } from './components/LeaseTransactionForm';
import { SubmissionDetailTable } from './components/SubmissionDetailTable';
import type { WeeklyProgress, LeaseTransaction } from '@/src/types/lease-transaction';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '网络请求失败，请稍后重试';
}

function DataLoadError({ title, message, onRetry }: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center shadow-sm" role="alert">
      <AlertCircle className="mx-auto text-rose-600" size={24} aria-hidden="true" />
      <h3 className="mt-3 text-sm font-semibold text-rose-800">{title}</h3>
      <p className="mt-1 text-xs text-rose-700">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-lg bg-rose-700 px-4 py-2 text-xs font-medium text-white transition hover:bg-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
      >
        重新加载
      </button>
    </div>
  );
}

// ==========================================
// 周进度卡片组件
// ==========================================
interface WeeklyProgressCardProps {
  progress: WeeklyProgress | null;
  isLoading: boolean;
  onSubmitClick: () => void;
}

function WeeklyProgressCard({ progress, isLoading, onSubmitClick }: WeeklyProgressCardProps) {
  if (isLoading) {
    return (
      <div className="animate-pulse rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
        <div className="mb-3 h-4 w-32 rounded bg-zinc-100"></div>
        <div className="mb-3 h-8 w-24 rounded bg-zinc-100"></div>
        <div className="h-3 w-48 rounded bg-zinc-50"></div>
      </div>
    );
  }

  const isComplete = progress && progress.submittedCount >= progress.targetCount;
  const percentage = progress?.percentage ?? 0;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-white p-5 shadow-sm transition-[border-color,box-shadow,background-color] ${
        isComplete
          ? 'border-emerald-200'
          : 'border-amber-200'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1 ${isComplete ? 'bg-emerald-500' : 'bg-amber-500'}`}
      />
      {/* 标题行 */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isComplete ? (
            <CheckCircle2 aria-hidden="true" className="text-emerald-600" size={18} />
          ) : (
            <AlertCircle aria-hidden="true" className="text-amber-600" size={18} />
          )}
          <span className="text-sm font-semibold text-gray-700">每周填报任务</span>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            isComplete
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-700'
          }`}
        >
          {isComplete ? '已达标' : '进行中'}
        </span>
      </div>

      {/* 进度数字 */}
      <div className="mb-2 pl-1">
        <div className="flex items-baseline gap-2">
          <span
            className={`text-2xl font-bold tabular-nums ${
              isComplete ? 'text-emerald-600' : 'text-amber-600'
            }`}
          >
            {progress?.submittedCount ?? 0}
          </span>
          <span className="text-base font-medium text-gray-400">/</span>
          <span className="text-base font-medium tabular-nums text-gray-500">{progress?.targetCount ?? 2}</span>
          <span className="text-sm text-gray-500 ml-1">条</span>
        </div>
      </div>

      {/* 进度条 */}
      <div className="mb-3" role="progressbar" aria-label="每周填报完成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, percentage)}>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-full rounded-full transition-[width,background-color] duration-500 ${
              isComplete ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
            style={{ width: `${Math.min(100, percentage)}%` }}
          />
        </div>
      </div>

      {/* 提示文案与按钮 */}
      <div className="flex items-center justify-between">
        <p className={`text-xs ${isComplete ? 'text-emerald-700' : 'text-amber-700'}`}>
          {isComplete ? (
            <>本周任务已达标！可继续提交</>
          ) : (
            <>还需填报 <strong>{(progress?.targetCount ?? 2) - (progress?.submittedCount ?? 0)}</strong> 条即可达标</>
          )}
        </p>

        {/* 🔥 立即填报按钮 - 始终显示，达标后样式变为次级按钮 */}
        <button
          onClick={onSubmitClick}
          className={`flex touch-manipulation items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-[background-color,border-color,box-shadow,transform] hover:shadow-md active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30 ${
            isComplete
              ? 'bg-white border border-emerald-600 text-emerald-700 hover:bg-emerald-50'
              : 'bg-[#003e7e] text-white hover:bg-[#002b5e]'
          }`}
        >
          <Plus aria-hidden="true" size={14} />
          {isComplete ? '继续填报' : '立即填报'}
        </button>
      </div>
    </div>
  );
}

// ==========================================
// 提交历史表格组件
// ==========================================
interface SubmissionHistoryTableProps {
  submissions: LeaseTransaction[];
  isLoading: boolean;
  onEdit: (record: LeaseTransaction) => void;
  onTransfer: (record: LeaseTransaction) => void;
  userName: string;
}

function SubmissionHistoryTable({ submissions, isLoading, onEdit, onTransfer, userName }: SubmissionHistoryTableProps) {
  // 分页状态
  const [currentPage, setCurrentPage] = React.useState(1);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const pageSize = 10;

  // Escape 键退出全屏
  React.useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);
  const totalPages = Math.ceil((submissions?.length ?? 0) / pageSize);

  // 当前页数据
  const currentData = React.useMemo(() => {
    if (!submissions) return [];
    const start = (currentPage - 1) * pageSize;
    return submissions.slice(start, start + pageSize);
  }, [submissions, currentPage]);

  // 格式化日期
  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '-';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  // 格式化数字
  const formatNumber = (val: number | null | undefined, unit?: string) => {
    if (val === null || val === undefined) return '-';
    return `${val.toLocaleString('zh-CN')}${unit ?? ''}`;
  };

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm">
        <div className="border-b border-zinc-100 p-4 sm:p-5">
          <div className="h-5 w-32 animate-pulse rounded bg-zinc-100"></div>
        </div>
        <div className="p-8 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-[#003e7e]"></div>
          <p className="mt-3 text-sm text-gray-500">加载中…</p>
        </div>
      </div>
    );
  }

  if (!submissions || submissions.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-100 p-4 sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="h-7 w-1 shrink-0 rounded-full bg-[#003e7e]" aria-hidden="true" />
            <h3 className="truncate text-base font-semibold text-gray-900">我的提交历史 — {userName || '用户'}</h3>
          </div>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            aria-label={isFullscreen ? '退出全屏' : '全屏显示提交历史'}
            className="flex shrink-0 touch-manipulation items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30"
            title={isFullscreen ? '退出全屏' : '全屏显示'}
          >
            {isFullscreen ? <Minimize2 aria-hidden="true" size={14} /> : <Maximize2 aria-hidden="true" size={14} />}
            {isFullscreen ? '退出全屏' : '全屏显示'}
          </button>
        </div>
        <div className="p-10 text-center sm:p-12">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-50">
            <FileText aria-hidden="true" className="text-gray-300" size={24} />
          </div>
          <p className="text-sm text-gray-500">暂无提交记录</p>
          <p className="text-xs text-gray-400 mt-1">完成填报后，记录将显示在这里</p>
        </div>
      </div>
    );
  }

  const containerClass = isFullscreen
    ? 'fixed inset-0 z-50 overflow-auto bg-[#f5f7fb] p-4 sm:p-6'
    : 'overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm';

  return (
    <div className={containerClass}>
      {/* 表头 */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-zinc-100 bg-white/95 p-4 backdrop-blur sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-7 w-1 shrink-0 rounded-full bg-[#003e7e]" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-gray-900">我的提交历史 — {userName || '用户'}</h3>
            <span className="text-xs text-gray-500">共 {submissions.length} 条记录</span>
          </div>
        </div>
        <button
          onClick={() => setIsFullscreen(!isFullscreen)}
          aria-label={isFullscreen ? '退出全屏' : '全屏显示提交历史'}
          className="flex shrink-0 touch-manipulation items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30"
          title={isFullscreen ? '退出全屏' : '全屏显示'}
        >
          {isFullscreen ? <Minimize2 aria-hidden="true" size={14} /> : <Maximize2 aria-hidden="true" size={14} />}
          {isFullscreen ? '退出全屏' : '全屏显示'}
        </button>
      </div>

      {/* 表格 */}
      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full" aria-label="我的提交历史">
          <thead>
            <tr className="border-b border-gray-100 bg-zinc-50/70">
              <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">公司</th>
              <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">新租楼宇</th>
              <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">成交面积</th>
              <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">有效租金</th>
              <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">成交季度</th>
              <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">提交时间</th>
              <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody>
            {currentData.map((item, idx) => {
              const isLastRow = idx === currentData.length - 1;
              return (
                <tr
                  key={item.id ?? idx}
                  className={`hover:bg-gray-50/50 transition-colors ${
                    !isLastRow ? 'border-b border-gray-100' : ''
                  }`}
                >
                  <td className="px-6 py-4">
                    <span className="font-medium text-gray-900"><MaskedCell masked>{item.company || '-'}</MaskedCell></span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Building2 aria-hidden="true" size={14} className="text-gray-400" />
                      <span className="text-gray-700"><MaskedCell masked>{item.new_building || '-'}</MaskedCell></span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-gray-700">
                    {formatNumber(item.area_sqm, ' ㎡')}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-gray-700">
                    {formatNumber(item.effective_rent, ' 元')}
                  </td>
                  <td className="px-6 py-4 text-center text-gray-600">
                    <div className="flex items-center justify-center gap-1">
                      <Calendar aria-hidden="true" size={12} className="text-gray-400" />
                      {item.transaction_quarter || '-'}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center text-gray-500 text-xs">
                    {formatDate(item.created_at)}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => onEdit(item)}
                        className="inline-flex touch-manipulation items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[#003e7e] transition-colors hover:bg-[#003e7e]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30"
                        title="编辑此记录"
                      >
                        <Edit2 size={14} />
                        编辑
                      </button>
                      <button
                        onClick={() => onTransfer(item)}
                        className="inline-flex touch-manipulation items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                        title="赠与其他用户"
                      >
                        赠与
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50/60 px-4 py-3 sm:px-6 sm:py-4">
          <p className="text-xs text-gray-500">
            第 {currentPage} / {totalPages} 页
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="touch-manipulation rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              上一页
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="touch-manipulation rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 主页面组件 - 沉浸式填报体验
// ==========================================
export default function LeaseSubmissionPage() {
  const router = useRouter();
  const [ready, setReady] = React.useState(false);
  const [userId, setUserId] = React.useState<string | null>(null);
  const [userName, setUserName] = React.useState<string>('');
  const [userRole, setUserRole] = React.useState<string>('');
  const [userEmail, setUserEmail] = React.useState<string>('');

  // 数据状态
  const [weeklyProgress, setWeeklyProgress] = React.useState<WeeklyProgress | null>(null);
  const [submissions, setSubmissions] = React.useState<LeaseTransaction[]>([]);
  const [allTeamSubmissions, setAllTeamSubmissions] = React.useState<LeaseTransaction[]>([]);
  const [isLoadingProgress, setIsLoadingProgress] = React.useState(true);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = React.useState(true);
  const [isLoadingTeamSubmissions, setIsLoadingTeamSubmissions] = React.useState(true);
  const [progressError, setProgressError] = React.useState<string | null>(null);
  const [submissionsError, setSubmissionsError] = React.useState<string | null>(null);
  const [teamSubmissionsError, setTeamSubmissionsError] = React.useState<string | null>(null);
  
  // 表单状态
  const [showForm, setShowForm] = React.useState(false);
  const [editingRecord, setEditingRecord] = React.useState<LeaseTransaction | null>(null);

  // 赠与状态
  const [transferringRecord, setTransferringRecord] = React.useState<LeaseTransaction | null>(null);
  const [brokers, setBrokers] = React.useState<Array<{ user_id: string; name: string }>>([]);
  const [selectedBrokerId, setSelectedBrokerId] = React.useState('');
  const [isTransferring, setIsTransferring] = React.useState(false);

  const loadDashboardData = React.useCallback(async (
    uid: string,
    role: string,
    isCancelled: () => boolean = () => false,
  ) => {
    setIsLoadingProgress(true);
    setIsLoadingSubmissions(true);
    setIsLoadingTeamSubmissions(true);
    setProgressError(null);
    setSubmissionsError(null);
    setTeamSubmissionsError(null);

    const results = await Promise.allSettled([
      retryAsync(() => getWeeklyProgress(uid), { attempts: 3, baseDelayMs: 250 }),
      retryAsync(() => getMySubmissions(uid), { attempts: 3, baseDelayMs: 250 }),
      retryAsync(() => getAllSubmissions(role), { attempts: 3, baseDelayMs: 250 }),
    ]);
    if (isCancelled()) return;

    const [progressResult, submissionsResult, teamResult] = results;
    if (progressResult.status === 'fulfilled') setWeeklyProgress(progressResult.value);
    else setProgressError(getErrorMessage(progressResult.reason));

    if (submissionsResult.status === 'fulfilled') setSubmissions(submissionsResult.value);
    else setSubmissionsError(getErrorMessage(submissionsResult.reason));

    if (teamResult.status === 'fulfilled') setAllTeamSubmissions(teamResult.value);
    else setTeamSubmissionsError(getErrorMessage(teamResult.reason));

    setIsLoadingProgress(false);
    setIsLoadingSubmissions(false);
    setIsLoadingTeamSubmissions(false);
  }, []);

  // 鉴权 + 并行获取所有数据（原来 4 个串行 useEffect 合并为 1 个）
  React.useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setReady(true);
    });

    void (async () => {
      try {
        // 1. 鉴权
        const session = await getSessionFast();
        if (cancelled) return;
        if (!session) {
          router.replace('/login');
          return;
        }
        const uid = session.user?.id ?? null;
        const role = session.role ?? '';
        setUserId(uid);
        setUserName(session.displayName ?? '');
        setUserRole(role);
        setUserEmail(session.user?.email ?? '');

        // 2. 鉴权通过后，并行获取 3 个数据源；短暂失败会有限重试。
        if (uid && role) {
          await loadDashboardData(uid, role, () => cancelled);
        }
      } catch (e) {
        console.error('Failed to check session', e);
        if (!cancelled) router.replace('/login');
      }
    })();
    return () => { cancelled = true; };
  }, [loadDashboardData, router]);

  // 处理填报按钮点击
  const handleSubmitClick = () => {
    setEditingRecord(null);
    setShowForm(true);
    getSessionFast().then(s => logAction(s?.user?.email || '未知用户', 'OPEN_LEASE_FORM', { mode: 'new' })).catch(() => {});
  };

  // 处理编辑按钮点击
  const handleEditClick = (record: LeaseTransaction) => {
    setEditingRecord(record);
    setShowForm(true);
    getSessionFast().then(s => logAction(s?.user?.email || '未知用户', 'OPEN_LEASE_FORM', { mode: 'edit', recordId: record.id })).catch(() => {});
  };

  // 处理赠与按钮点击
  const handleTransferClick = async (record: LeaseTransaction) => {
    setTransferringRecord(record);
    setSelectedBrokerId('');
    if (brokers.length === 0) {
      try {
        const list = await getAllBrokers();
        setBrokers(list);
      } catch (e) {
        console.error('获取用户列表失败', e);
      }
    }
  };

  // 执行赠与
  const handleTransferConfirm = async () => {
    if (!transferringRecord || !selectedBrokerId) return;
    const targetBroker = brokers.find(b => b.user_id === selectedBrokerId);
    if (!targetBroker) return;

    setIsTransferring(true);
    try {
      const session = await getSessionFast();
      const accessToken = session?.session?.access_token;
      if (!accessToken) {
        alert('登录状态异常，请重新登录');
        return;
      }

      const res = await fetch('/api/admin/transfer-submission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          submissionId: transferringRecord.id,
          targetUserId: targetBroker.user_id,
          targetUserName: targetBroker.name,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        logAction(session.user?.email || '未知用户', 'TRANSFER_SUBMISSION', {
          recordId: transferringRecord.id,
          targetUserId: targetBroker.user_id,
          targetUserName: targetBroker.name,
        });
        setTransferringRecord(null);
        refreshData();
      } else {
        alert(data.error || '赠与失败');
      }
    } catch {
      alert('赠与操作失败，请重试');
    } finally {
      setIsTransferring(false);
    }
  };
  
  // 刷新数据（并行获取，任一失败不影响其他）
  const refreshData = React.useCallback(async () => {
    if (!userId || !userRole) return;
    await loadDashboardData(userId, userRole);
  }, [loadDashboardData, userId, userRole]);

  // Loading 状态
  if (!ready) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-[#f5f7fb] text-zinc-900" aria-busy="true">
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f5f7fb] text-zinc-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[700] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-[#003e7e] focus:shadow-lg"
      >
        跳转到主要内容
      </a>

      {/* 页面 Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="h-8 w-1 shrink-0 rounded-full bg-[#003e7e]" aria-hidden="true" />
            <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">租赁成交填报</h1>
          </div>
          
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            {/* 高管专属：团队监控入口 */}
            {(isUserAdmin(userRole) || isDemoMode(userEmail)) && (
              <Link
                href="/lease-submission/monitoring"
                className="group flex min-w-0 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-xs font-medium text-gray-700 transition-[background-color,border-color,color] hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30 sm:px-4 sm:text-sm"
              >
                <span className="max-w-[108px] truncate sm:max-w-none">查看团队提交记录</span>
                <ArrowRight aria-hidden="true" size={16} className="text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-600" />
              </Link>
            )}
            
            <Link
              href="/"
              className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-gray-500 transition-colors hover:bg-zinc-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30"
            >
              <ArrowLeft aria-hidden="true" size={16} />
              返回主页
            </Link>
          </div>
        </div>
      </header>

      {/* 主体内容 - 居中卡片布局 */}
      <main id="main-content" className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-7">
        <div className="space-y-5">
        {/* 周进度卡片 */}
        <section aria-label="每周填报任务">
          {progressError ? (
            <DataLoadError title="每周进度加载失败" message={progressError} onRetry={() => { void refreshData(); }} />
          ) : (
            <WeeklyProgressCard
              progress={weeklyProgress}
              isLoading={isLoadingProgress}
              onSubmitClick={handleSubmitClick}
            />
          )}
        </section>

        {/* 提交历史表格 */}
        <section aria-label="我的提交历史">
          {submissionsError ? (
            <DataLoadError title="提交历史加载失败" message={submissionsError} onRetry={() => { void refreshData(); }} />
          ) : (
            <ComponentErrorBoundary componentName="提交历史">
              <SubmissionHistoryTable
                submissions={submissions}
                isLoading={isLoadingSubmissions}
                onEdit={handleEditClick}
                onTransfer={handleTransferClick}
                userName={userName}
              />
            </ComponentErrorBoundary>
          )}
        </section>

        {/* 团队成交汇总（所有人可见） */}
        <section aria-label="团队成交汇总">
          {isLoadingTeamSubmissions ? (
            <div className="rounded-2xl border border-zinc-200/80 bg-white p-8 shadow-sm">
              <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-[#003e7e]"></div>
                <p className="ml-3 text-sm text-gray-500">加载团队数据中…</p>
              </div>
            </div>
          ) : teamSubmissionsError ? (
            <DataLoadError title="团队成交加载失败" message={teamSubmissionsError} onRetry={() => { void refreshData(); }} />
          ) : (
            <ComponentErrorBoundary componentName="团队成交汇总">
              <SubmissionDetailTable
                submissions={allTeamSubmissions}
                title="团队成交汇总"
                highlightUserId={userId}
                canManageTeamRecords={isUserAdmin(userRole)}
                onEdit={handleEditClick}
              />
            </ComponentErrorBoundary>
          )}
        </section>
        </div>
      </main>
      
      {/* 填报表单抽屉 */}
      <LeaseTransactionForm
        isOpen={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingRecord(null);
        }}
        onSubmitSuccess={refreshData}
        userId={userId || ''}
        userName={userName}
        mode={editingRecord ? 'edit' : 'create'}
        initialData={editingRecord || undefined}
      />

      {/* 赠与弹窗 */}
      {transferringRecord && (
        <div
          className="fixed inset-0 z-[600] flex items-center justify-center bg-zinc-950/45 p-4 backdrop-blur-[2px]"
          onClick={() => setTransferringRecord(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl sm:p-6"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-dialog-title"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 id="transfer-dialog-title" className="flex items-center gap-2 text-base font-semibold text-gray-900">
                <Gift aria-hidden="true" size={18} className="text-emerald-600" />
                赠与记录
              </h3>
              <button
                onClick={() => setTransferringRecord(null)}
                aria-label="关闭赠与记录弹窗"
                className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <div className="mb-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
              <p><span className="text-gray-400">企业：</span>{transferringRecord.company || '-'}</p>
              <p><span className="text-gray-400">楼宇：</span>{transferringRecord.new_building || '-'}</p>
              <p><span className="text-gray-400">面积：</span>{transferringRecord.area_sqm ? `${transferringRecord.area_sqm}㎡` : '-'}</p>
            </div>

            <label htmlFor="transfer-target-broker" className="mb-2 block text-xs font-medium text-gray-500">选择受赠人</label>
            <select
              id="transfer-target-broker"
              name="targetBrokerId"
              value={selectedBrokerId}
              onChange={e => setSelectedBrokerId(e.target.value)}
              autoComplete="off"
              className="mb-4 min-h-10 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="">请选择…</option>
              {brokers.map(b => (
                <option key={b.user_id} value={b.user_id}>{b.name}</option>
              ))}
            </select>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setTransferringRecord(null)}
                className="touch-manipulation rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30"
              >
                取消
              </button>
              <button
                onClick={handleTransferConfirm}
                disabled={!selectedBrokerId || isTransferring}
                className="touch-manipulation rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isTransferring ? '处理中…' : '确认赠与'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
