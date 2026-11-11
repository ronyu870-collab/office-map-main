'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { formatLeaseRent } from '@/src/utils/formatLeaseRent';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, CheckCircle2, CircleAlert, Edit2, Gift, Plus, RotateCcw } from 'lucide-react';

import { getSessionFast } from '@/src/services/Auth';
import { getAllBrokers, getAllSubmissions, getMySubmissions, getWeeklyProgress } from '@/src/services/leaseTransactionSubmitService';
import { logAction } from '@/src/utils/audit';
import { withImpersonationHeaders } from '@/src/services/impersonationHeaders';
import { canViewLeaseTeamSubmissions, canWriteBusinessData, isUserAdmin } from '@/src/utils/accessControl';
import { retryAsync } from '@/src/utils/retryAsync';
import { MaskedCell } from '@/src/components/demo';
import { ValidationMessage } from '@/src/components/data-entry/ValidationMessage';
import { SubmissionDetailTable } from './components/SubmissionDetailTable';
import { BuildingDealsDrawer } from './components/BuildingDealsDrawer';
import type { LeaseTransaction, WeeklyProgress } from '@/src/types/lease-transaction';
import { AppHeader, Badge, Button, Dialog, LoadingState } from '@/src/components/ui';

const LeaseTransactionForm = dynamic(
  () => import('./components/LeaseTransactionForm').then((module) => module.LeaseTransactionForm),
  {
    ssr: false,
    loading: () => <div role="status" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"><LoadingState label="正在打开成交表单" rows={0} /></div>,
  },
);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '网络请求失败，请稍后重试';
}

function usePersonalRead<T>(read: (userId: string) => Promise<T>) {
  const [state, setState] = React.useState<{ userId: string; data: T | null; pending: boolean; error: string | null }>({
    userId: '', data: null, pending: true, error: null,
  });
  const generation = React.useRef(0);
  React.useEffect(() => () => { generation.current += 1; }, []);

  const load = React.useCallback(async (userId: string) => {
    if (!userId) return;
    const request = ++generation.current;
    setState(previous => ({ userId, data: previous.userId === userId ? previous.data : null, pending: true, error: null }));
    try {
      const data = await retryAsync(() => read(userId), { attempts: 3, baseDelayMs: 250, shouldRetry: () => request === generation.current });
      if (request === generation.current) setState({ userId, data, pending: false, error: null });
    } catch (error) {
      if (request === generation.current) setState(previous => ({ ...previous, pending: false, error: errorMessage(error) }));
    }
  }, [read]);

  return { ...state, load };
}

interface HistoryProps {
  items: LeaseTransaction[] | null;
  pending: boolean;
  userName: string;
  canWrite: boolean;
  onEdit: (record: LeaseTransaction) => void;
  onTransfer: (record: LeaseTransaction) => void;
}

function MySubmissionTable({ items, pending, userName, canWrite, onEdit, onTransfer }: HistoryProps) {
  const [page, setPage] = React.useState(1);
  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil((items?.length ?? 0) / pageSize));
  const current = React.useMemo(() => items?.slice((page - 1) * pageSize, page * pageSize) ?? [], [items, page]);

  React.useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  return (
    <section className="overflow-hidden rounded-lg border border-[#d9e0e8] bg-white shadow-[0_1px_3px_rgba(23,32,51,0.04)]" aria-label="我的提交记录" aria-busy={pending}>
      <div className={`flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5 ${items?.length ? 'border-b border-slate-200/80' : ''}`}>
        <div>
          <h2 className="text-[13px] font-semibold text-slate-900">我的提交记录</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">{userName || '用户'}{items ? ` · 共 ${items.length} 条成交记录` : ''}</p>
        </div>
        {items?.length === 0 && <p className="text-xs text-slate-500">暂无提交记录</p>}
        {totalPages > 1 && (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">上一页</button>
            <span className="min-w-9 text-center tabular-nums">{page}/{totalPages}</span>
            <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages} className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">下一页</button>
          </div>
        )}
      </div>
      {!items ? (
        <div className="px-4 py-4 text-xs text-slate-500">{pending ? '正在加载提交记录…' : '暂时无法显示提交记录'}</div>
      ) : items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[11px]">
            <thead className="bg-slate-50/90 text-[10px] text-slate-500">
              <tr>{['公司','楼宇','面积 (㎡)','净有效租金','成交年份','成交季度','提交日期','操作'].map((label, index) => <th key={label} className={`border-b border-slate-200 px-3 py-2.5 font-semibold ${index >= 2 && index <= 3 ? 'text-right' : index >= 4 ? 'text-center' : 'text-left'}`}>{label}</th>)}</tr>
            </thead>
            <tbody>{current.map((item, index) => (
              <tr key={item.id ?? index} className="border-b border-slate-100 last:border-0 transition-colors hover:bg-slate-50/70">
                <td className="max-w-48 truncate px-3 py-2.5 font-medium text-slate-900"><MaskedCell masked>{item.company || '-'}</MaskedCell></td>
                <td className="max-w-48 truncate px-3 py-2.5 text-slate-600"><MaskedCell masked>{item.new_building || '-'}</MaskedCell></td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{item.area_sqm?.toLocaleString('zh-CN') ?? '-'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-medium text-[#003e7e]">{formatLeaseRent(item.effective_rent)}</td>
                <td className="px-3 py-2.5 text-center tabular-nums text-slate-600">{item.transaction_year || '-'}</td>
                <td className="px-3 py-2.5 text-center text-slate-600">{item.transaction_quarter || '-'}</td>
                <td className="px-3 py-2.5 text-center text-slate-400">{item.created_at ? new Date(item.created_at).toLocaleDateString('zh-CN') : '-'}</td>
                <td className="px-3 py-2.5 text-center">
                  {canWrite ? (
                    <div className="inline-flex gap-1.5">
                      <button type="button" onClick={() => onEdit(item)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-[#003e7e] transition hover:border-[#003e7e]/25 hover:bg-[#003e7e]/5"><Edit2 size={11} /> 编辑</button>
                      <button type="button" onClick={() => onTransfer(item)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-emerald-700 transition hover:border-emerald-200 hover:bg-emerald-50"><Gift size={11} /> 转交</button>
                    </div>
                  ) : <span className="text-[10px] font-medium text-slate-400">只读</span>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function LeaseSubmissionPage() {
  const router = useRouter();
  const [ready, setReady] = React.useState(false);
  const [userId, setUserId] = React.useState('');
  const [userName, setUserName] = React.useState('');
  const [userRole, setUserRole] = React.useState('');
  const { data: progress, pending: progressPending, error: progressError, load: loadProgress } = usePersonalRead<WeeklyProgress>(getWeeklyProgress);
  const { data: submissions, pending: submissionsPending, error: submissionsError, load: loadSubmissions } = usePersonalRead<LeaseTransaction[]>(getMySubmissions);
  const [teamSubmissions, setTeamSubmissions] = React.useState<LeaseTransaction[]>([]);
  const [teamAccessEnabled, setTeamAccessEnabled] = React.useState(false);
  const [teamLoading, setTeamLoading] = React.useState(false);
  const [teamError, setTeamError] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);
  const [editingRecord, setEditingRecord] = React.useState<LeaseTransaction | null>(null);
  const [lastSubmissionAt, setLastSubmissionAt] = React.useState<Date | null>(null);
  const [transferringRecord, setTransferringRecord] = React.useState<LeaseTransaction | null>(null);
  const [brokers, setBrokers] = React.useState<Array<{ user_id: string; name: string }>>([]);
  const [selectedBrokerId, setSelectedBrokerId] = React.useState('');
  const [transferring, setTransferring] = React.useState(false);
  const [transferError, setTransferError] = React.useState<string | null>(null);
  const [buildingSelection, setBuildingSelection] = React.useState<{ record: LeaseTransaction; trigger: HTMLButtonElement } | null>(null);
  const canWrite = canWriteBusinessData(userRole);
  const coreLoading = progressPending || submissionsPending;

  const loadCoreData = React.useCallback(async (uid: string) => {
    await Promise.all([loadProgress(uid), loadSubmissions(uid)]);
  }, [loadProgress, loadSubmissions]);

  const loadTeamData = React.useCallback(async (role: string) => {
    setTeamError(null);

    if (!canViewLeaseTeamSubmissions(role)) {
      setTeamLoading(false);
      setTeamAccessEnabled(false);
      setTeamSubmissions([]);
      return;
    }

    setTeamLoading(true);
    setTeamAccessEnabled(true);

    try {
      const nextTeamSubmissions = await retryAsync(() => getAllSubmissions(role), { attempts: 1 });
      setTeamSubmissions(nextTeamSubmissions);
    } catch (teamLoadError) {
      setTeamAccessEnabled(true);
      setTeamError(errorMessage(teamLoadError));
    } finally {
      setTeamLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await getSessionFast();
        if (cancelled) return;
        if (!session?.user?.id) { router.replace('/login'); return; }
        const uid = session.user.id;
        const role = session.role ?? '';
        setUserId(uid);
        setUserName(session.displayName ?? '');
        setUserRole(role);
        setReady(true);
        void loadTeamData(role);
        await loadCoreData(uid);
      } catch (error) {
        console.error('Lease workspace session load failed', error);
        if (!cancelled) router.replace('/login');
      }
    })();
    return () => { cancelled = true; };
  }, [loadCoreData, loadTeamData, router]);

  const refreshData = React.useCallback(async () => {
    if (!userId) return;
    setLastSubmissionAt(new Date());
    void loadTeamData(userRole);
    await loadCoreData(userId);
  }, [loadCoreData, loadTeamData, userId, userRole]);

  const openCreate = () => {
    if (!canWrite) return;
    setEditingRecord(null);
    setShowForm(true);
    void getSessionFast().then((session) => logAction(session?.user?.email || '未知用户', 'OPEN_LEASE_FORM', { mode: 'new' })).catch(() => {});
  };

  const openEdit = (record: LeaseTransaction) => {
    if (!canWrite) return;
    setEditingRecord(record);
    setShowForm(true);
    void getSessionFast().then((session) => logAction(session?.user?.email || '未知用户', 'OPEN_LEASE_FORM', { mode: 'edit', recordId: record.id })).catch(() => {});
  };

  const openTransfer = async (record: LeaseTransaction) => {
    if (!canWrite) return;
    setTransferringRecord(record);
    setSelectedBrokerId('');
    setTransferError(null);
    if (brokers.length === 0) {
      try { setBrokers(await getAllBrokers()); } catch (error) { setTransferError(errorMessage(error)); }
    }
  };

  const confirmTransfer = async () => {
    if (!canWrite || !transferringRecord || !selectedBrokerId) return;
    const target = brokers.find((broker) => broker.user_id === selectedBrokerId);
    if (!target) return;
    setTransferring(true);
    setTransferError(null);
    try {
      const session = await getSessionFast();
      const token = session?.session?.access_token;
      if (!token) throw new Error('登录状态异常，请重新登录');
      const response = await fetch('/api/admin/transfer-submission', {
        method: 'POST',
        headers: withImpersonationHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
        body: JSON.stringify({ submissionId: transferringRecord.id, targetUserId: target.user_id, targetUserName: target.name }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '赠与失败');
      logAction(session.user?.email || '未知用户', 'TRANSFER_SUBMISSION', { recordId: transferringRecord.id, targetUserId: target.user_id, targetUserName: target.name });
      setTransferringRecord(null);
      await refreshData();
    } catch (error) {
      setTransferError(errorMessage(error));
    } finally {
      setTransferring(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--cd-color-workspace)] p-4"><LoadingState label="正在进入租赁成交填报" rows={0} /></div>
    );
  }

  const complete = Boolean(progress && progress.submittedCount >= progress.targetCount);
  const progressLabel = progress ? complete ? '本周已完成' : '本周进行中' : progressPending ? '周进度加载中' : '周进度暂不可用';
  const admin = isUserAdmin(userRole);
  const coreReadFailed = Boolean(progressError || submissionsError);

  return (
    <div className="min-h-screen bg-[var(--cd-color-workspace)] text-[var(--cd-color-text-primary)]" inert={buildingSelection !== null}>
      <header className="sticky top-0 z-[var(--cd-z-sticky)] border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
        <AppHeader
          title={<span className="flex items-center gap-2">租赁成交填报<Badge tone={complete ? 'success' : 'warning'}>{progressLabel}</Badge></span>}
          homeHref="/"
          actions={(
            <>
              {admin && <Link href="/lease-submission/monitoring" className="hidden h-8 items-center rounded-[var(--cd-radius-md)] px-2 text-[var(--cd-font-size-sm)] font-medium text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-brand)] sm:inline-flex">团队监控</Link>}
              {canWrite ? <Button type="button" size="sm" onClick={openCreate}><Plus size={13} />新增成交</Button> : <span className="text-[11px] font-medium text-slate-400">只读模式</span>}
            </>
          )}
        />
      </header>

      <main className="mx-auto max-w-[1500px] space-y-3 p-3 sm:p-5">
        <section className="overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] sm:flex sm:items-center sm:justify-between sm:gap-4 sm:px-5" aria-label="租赁成交填报状态">
          <dl className="grid grid-cols-2 px-3 py-3 sm:w-1/2 sm:max-w-[22rem] sm:shrink-0 sm:px-0 sm:py-2">
            <div className="min-w-0 pr-3">
              <dt className="text-[13px] font-medium">本周目标</dt>
              {progress ? (
                <dd className="mt-0.5">
                  <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-[var(--cd-color-text-secondary)]">
                    <strong className="text-xl font-medium tabular-nums text-[var(--cd-color-brand)]">{progress.submittedCount}</strong>
                    <span>/ {progress.targetCount} 条</span>
                  </div>
                  <p className="text-xs text-[var(--cd-color-text-secondary)]">
                    {progressError ? '沿用上次数据' : complete ? '本周目标已完成' : `还需 ${Math.max(0, progress.targetCount - progress.submittedCount)} 条`}
                  </p>
                </dd>
              ) : <dd className="mt-1 text-xs text-[var(--cd-color-text-secondary)]">{progressPending ? '读取中…' : '暂不可用'}</dd>}
            </div>
            <div className="min-w-0 border-l border-[var(--cd-color-border)]/55 pl-3 sm:pl-5">
              <dt className="text-[13px] font-medium">我的记录</dt>
              {submissions ? (
                <dd className="mt-0.5">
                  <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-[var(--cd-color-text-secondary)]">
                    <strong className="text-xl font-medium tabular-nums text-[var(--cd-color-text-primary)]">{submissions.length}</strong>
                    <span>条</span>
                  </div>
                  {submissionsError && <p className="text-xs text-[var(--cd-color-text-secondary)]">沿用上次数据</p>}
                </dd>
              ) : <dd className="mt-1 text-xs text-[var(--cd-color-text-secondary)]">{submissionsPending ? '读取中…' : '暂不可用'}</dd>}
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--cd-color-border)]/55 px-3 py-2 text-xs text-[var(--cd-color-text-secondary)] sm:justify-end sm:border-t-0 sm:px-0">
            <p role="status" className="inline-flex items-center gap-1.5">
              {coreLoading ? <RotateCcw aria-hidden="true" size={13} className="shrink-0 text-[var(--cd-color-brand)] motion-safe:animate-spin" />
                : coreReadFailed ? <CircleAlert aria-hidden="true" size={13} className="shrink-0 text-[var(--cd-color-warning)]" />
                : <CheckCircle2 aria-hidden="true" size={13} className="shrink-0 text-[var(--cd-color-success)]" />}
              {coreLoading ? '正在刷新数据' : coreReadFailed ? '数据未完整读取' : '数据已就绪'}
            </p>
            <p className="flex flex-wrap items-baseline gap-x-1.5 border-l border-[var(--cd-color-border)] pl-3 tabular-nums">
              <span>最近写入</span>
              {lastSubmissionAt
                ? <time dateTime={lastSubmissionAt.toISOString()}>{lastSubmissionAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
                : <span>本次会话暂无</span>}
            </p>
          </div>
        </section>

        {(progressError || submissionsError) && <div className="grid gap-2 sm:grid-cols-2">{progressError && <div className="flex items-center gap-2"><ValidationMessage severity="error">本周进度：{progressError}</ValidationMessage><button onClick={() => { void loadProgress(userId); }} className="rounded-md border border-slate-200 bg-white p-2 text-slate-500" aria-label="重试加载本周进度"><RotateCcw size={13} /></button></div>}{submissionsError && <div className="flex items-center gap-2"><ValidationMessage severity="error">提交记录：{submissionsError}</ValidationMessage><button onClick={() => { void loadSubmissions(userId); }} className="rounded-md border border-slate-200 bg-white p-2 text-slate-500" aria-label="重试加载提交记录"><RotateCcw size={13} /></button></div>}</div>}

        <MySubmissionTable items={submissions} pending={submissionsPending} userName={userName} canWrite={canWrite} onEdit={openEdit} onTransfer={openTransfer} />

        {teamAccessEnabled && <section aria-label="团队成交汇总">{teamError ? <div className="flex items-center gap-2"><ValidationMessage severity="error">团队成交：{teamError}</ValidationMessage><button onClick={() => { void loadTeamData(userRole); }} className="rounded-md border border-slate-200 bg-white p-2 text-slate-500" aria-label="重试加载团队成交"><RotateCcw size={13} /></button></div> : teamLoading && teamSubmissions.length === 0 ? <div className="rounded-lg border border-[#d9e0e8] bg-white p-10 text-center text-xs text-slate-400">正在加载团队成交数据…</div> : <SubmissionDetailTable submissions={teamSubmissions} title="团队成交汇总" highlightUserId={userId} canManageTeamRecords={admin} onEdit={openEdit} onViewBuilding={(record, trigger) => setBuildingSelection({ record, trigger })} />}</section>}
      </main>

      {buildingSelection && <BuildingDealsDrawer record={buildingSelection.record} trigger={buildingSelection.trigger} onClose={() => setBuildingSelection(null)} />}

      {canWrite && showForm ? <LeaseTransactionForm isOpen={showForm} onClose={() => { setShowForm(false); setEditingRecord(null); }} onSubmitSuccess={refreshData} userId={userId} userName={userName} mode={editingRecord ? 'edit' : 'create'} initialData={editingRecord || undefined} /> : null}

      {canWrite && transferringRecord && (
        <Dialog
          open
          onOpenChange={(open) => { if (!open && !transferring) setTransferringRecord(null) }}
          title={<span className="flex items-center gap-2"><Gift size={15} className="text-[var(--cd-color-success)]" />转交成交记录</span>}
          description="记录归属将转移给所选团队成员。"
          size="sm"
          dismissible={!transferring}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setTransferringRecord(null)} disabled={transferring}>取消</Button>
              <Button onClick={() => { void confirmTransfer(); }} disabled={!selectedBrokerId || transferring}>{transferring && <RotateCcw size={12} className="animate-spin" />}{transferring ? '转交中…' : '确认转交'}</Button>
            </>
          )}
        >
              <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] text-slate-600"><div className="font-semibold text-slate-900">{transferringRecord.company || '-'}</div><div className="mt-1 flex items-center gap-1"><Building2 size={11} /> {transferringRecord.new_building || '-'} · {transferringRecord.area_sqm?.toLocaleString('zh-CN') || '-'} ㎡</div></div>
              {transferError && <div className="mb-3"><ValidationMessage severity="error">{transferError}</ValidationMessage></div>}
              <label htmlFor="transfer-target" className="mb-1 block text-[11px] font-medium text-slate-600">选择接收人</label>
              <select id="transfer-target" value={selectedBrokerId} onChange={(event) => setSelectedBrokerId(event.target.value)} className="min-h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs outline-none focus:border-[#003e7e]"><option value="">请选择…</option>{brokers.map((broker) => <option key={broker.user_id} value={broker.user_id}>{broker.name}</option>)}</select>
        </Dialog>
      )}
    </div>
  );
}

