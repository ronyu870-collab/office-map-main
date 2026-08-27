'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, CheckCircle2, Edit2, Gift, Plus, RotateCcw } from 'lucide-react';

import { getSessionFast } from '@/src/services/Auth';
import { getAllBrokers, getAllSubmissions, getMySubmissions, getWeeklyProgress } from '@/src/services/leaseTransactionSubmitService';
import { logAction } from '@/src/utils/audit';
import { canViewLeaseTeamSubmissions, isUserAdmin } from '@/src/utils/accessControl';
import { isDemoMode } from '@/src/config/demoMode';
import { retryAsync } from '@/src/utils/retryAsync';
import { MaskedCell } from '@/src/components/demo';
import { ValidationMessage } from '@/src/components/data-entry/ValidationMessage';
import { LeaseTransactionForm } from './components/LeaseTransactionForm';
import { SubmissionDetailTable } from './components/SubmissionDetailTable';
import type { LeaseTransaction, WeeklyProgress } from '@/src/types/lease-transaction';
import { AppHeader, Badge, Button, Dialog, LoadingState } from '@/src/components/ui';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '网络请求失败，请稍后重试';
}

interface HistoryProps {
  items: LeaseTransaction[];
  userName: string;
  onEdit: (record: LeaseTransaction) => void;
  onTransfer: (record: LeaseTransaction) => void;
}

function MySubmissionTable({ items, userName, onEdit, onTransfer }: HistoryProps) {
  const [page, setPage] = React.useState(1);
  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = React.useMemo(() => items.slice((page - 1) * pageSize, page * pageSize), [items, page]);

  React.useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  return (
    <section className="overflow-hidden rounded-lg border border-[#d9e0e8] bg-white shadow-[0_1px_3px_rgba(23,32,51,0.04)]" aria-label="我的提交记录">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-[13px] font-semibold text-slate-900">我的提交记录</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">{userName || '用户'} · 共 {items.length} 条成交记录</p>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">上一页</button>
            <span className="min-w-9 text-center tabular-nums">{page}/{totalPages}</span>
            <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages} className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">下一页</button>
          </div>
        )}
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <div className="text-xs font-medium text-slate-500">暂无提交记录</div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[11px]">
            <thead className="bg-slate-50/90 text-[10px] text-slate-500">
              <tr>{['公司','楼宇','面积 (㎡)','净有效租金','季度','提交日期','操作'].map((label, index) => <th key={label} className={`border-b border-slate-200 px-3 py-2.5 font-semibold ${index >= 2 && index <= 3 ? 'text-right' : index >= 4 ? 'text-center' : 'text-left'}`}>{label}</th>)}</tr>
            </thead>
            <tbody>{current.map((item, index) => (
              <tr key={item.id ?? index} className="border-b border-slate-100 last:border-0 transition-colors hover:bg-slate-50/70">
                <td className="max-w-48 truncate px-3 py-2.5 font-medium text-slate-900"><MaskedCell masked>{item.company || '-'}</MaskedCell></td>
                <td className="max-w-48 truncate px-3 py-2.5 text-slate-600"><MaskedCell masked>{item.new_building || '-'}</MaskedCell></td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{item.area_sqm?.toLocaleString('zh-CN') ?? '-'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-medium text-[#003e7e]">{item.effective_rent?.toLocaleString('zh-CN') ?? '-'}</td>
                <td className="px-3 py-2.5 text-center text-slate-600">{item.transaction_year ? `${item.transaction_year} ` : ''}{item.transaction_quarter || '-'}</td>
                <td className="px-3 py-2.5 text-center text-slate-400">{item.created_at ? new Date(item.created_at).toLocaleDateString('zh-CN') : '-'}</td>
                <td className="px-3 py-2.5 text-center">
                  <div className="inline-flex gap-1.5">
                    <button type="button" onClick={() => onEdit(item)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-[#003e7e] transition hover:border-[#003e7e]/25 hover:bg-[#003e7e]/5"><Edit2 size={11} /> 编辑</button>
                    <button type="button" onClick={() => onTransfer(item)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-emerald-700 transition hover:border-emerald-200 hover:bg-emerald-50"><Gift size={11} /> 转交</button>
                  </div>
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
  const [userEmail, setUserEmail] = React.useState('');
  const [progress, setProgress] = React.useState<WeeklyProgress | null>(null);
  const [submissions, setSubmissions] = React.useState<LeaseTransaction[]>([]);
  const [teamSubmissions, setTeamSubmissions] = React.useState<LeaseTransaction[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [progressError, setProgressError] = React.useState<string | null>(null);
  const [submissionsError, setSubmissionsError] = React.useState<string | null>(null);
  const [teamError, setTeamError] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);
  const [editingRecord, setEditingRecord] = React.useState<LeaseTransaction | null>(null);
  const [lastSubmissionAt, setLastSubmissionAt] = React.useState<Date | null>(null);
  const [transferringRecord, setTransferringRecord] = React.useState<LeaseTransaction | null>(null);
  const [brokers, setBrokers] = React.useState<Array<{ user_id: string; name: string }>>([]);
  const [selectedBrokerId, setSelectedBrokerId] = React.useState('');
  const [transferring, setTransferring] = React.useState(false);
  const [transferError, setTransferError] = React.useState<string | null>(null);

  const loadData = React.useCallback(async (uid: string, role: string) => {
    setLoading(true);
    setProgressError(null);
    setSubmissionsError(null);
    setTeamError(null);
    const canViewTeamSubmissions = canViewLeaseTeamSubmissions(role);
    const requests: Promise<unknown>[] = [
      retryAsync(() => getWeeklyProgress(uid), { attempts: 3, baseDelayMs: 250 }),
      retryAsync(() => getMySubmissions(uid), { attempts: 3, baseDelayMs: 250 }),
    ];
    if (canViewTeamSubmissions) requests.push(retryAsync(() => getAllSubmissions(role), { attempts: 1 }));
    try {
      const results = await Promise.allSettled(requests);
      const progressResult = results[0];
      const submissionsResult = results[1];
      if (progressResult.status === 'fulfilled') setProgress(progressResult.value as WeeklyProgress); else setProgressError(errorMessage(progressResult.reason));
      if (submissionsResult.status === 'fulfilled') setSubmissions(submissionsResult.value as LeaseTransaction[]); else setSubmissionsError(errorMessage(submissionsResult.reason));
      if (canViewTeamSubmissions) {
        const teamResult = results[2];
        if (teamResult?.status === 'fulfilled') setTeamSubmissions(teamResult.value as LeaseTransaction[]); else if (teamResult?.status === 'rejected') setTeamError(errorMessage(teamResult.reason));
      } else {
        setTeamSubmissions([]);
      }
    } finally {
      setLoading(false);
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
        setUserEmail(session.user.email ?? '');
        setReady(true);
        await loadData(uid, role);
      } catch (error) {
        console.error('Lease workspace session load failed', error);
        if (!cancelled) router.replace('/login');
      }
    })();
    return () => { cancelled = true; };
  }, [loadData, router]);

  const refreshData = React.useCallback(async () => {
    if (!userId) return;
    setLastSubmissionAt(new Date());
    await loadData(userId, userRole);
  }, [loadData, userId, userRole]);

  const openCreate = () => {
    setEditingRecord(null);
    setShowForm(true);
    void getSessionFast().then((session) => logAction(session?.user?.email || '未知用户', 'OPEN_LEASE_FORM', { mode: 'new' })).catch(() => {});
  };

  const openEdit = (record: LeaseTransaction) => {
    setEditingRecord(record);
    setShowForm(true);
    void getSessionFast().then((session) => logAction(session?.user?.email || '未知用户', 'OPEN_LEASE_FORM', { mode: 'edit', recordId: record.id })).catch(() => {});
  };

  const openTransfer = async (record: LeaseTransaction) => {
    setTransferringRecord(record);
    setSelectedBrokerId('');
    setTransferError(null);
    if (brokers.length === 0) {
      try { setBrokers(await getAllBrokers()); } catch (error) { setTransferError(errorMessage(error)); }
    }
  };

  const confirmTransfer = async () => {
    if (!transferringRecord || !selectedBrokerId) return;
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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

  const target = progress?.targetCount ?? 2;
  const submitted = progress?.submittedCount ?? 0;
  const complete = submitted >= target;
  const admin = isUserAdmin(userRole);
  const canViewTeamSubmissions = canViewLeaseTeamSubmissions(userRole);

  return (
    <div className="min-h-screen bg-[var(--cd-color-workspace)] text-[var(--cd-color-text-primary)]">
      <header className="sticky top-0 z-[var(--cd-z-sticky)] border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
        <AppHeader
          title={<span className="flex items-center gap-2">租赁成交填报<Badge tone={complete ? 'success' : 'warning'}>{complete ? '本周已完成' : '本周进行中'}</Badge></span>}
          homeHref="/"
          actions={(
            <>
              {(admin || isDemoMode(userEmail)) && <Link href="/lease-submission/monitoring" className="hidden h-8 items-center rounded-[var(--cd-radius-md)] px-2 text-[var(--cd-font-size-sm)] font-medium text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-brand)] sm:inline-flex">团队监控</Link>}
              <Button type="button" size="sm" onClick={openCreate}><Plus size={13} />新增成交</Button>
            </>
          )}
        />
      </header>

      <main className="mx-auto max-w-[1500px] space-y-3 p-3 sm:p-5">
        <section className="flex flex-wrap items-stretch overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]" aria-label="租赁成交填报状态">
          <div className="min-w-[150px] flex-1 border-b border-[var(--cd-color-border)] px-3.5 py-3 sm:border-b-0 sm:border-r">
            <div className="text-[10px] font-medium text-slate-400">本周目标</div>
            <div className="mt-1 flex items-baseline gap-1"><strong className={`text-xl tabular-nums ${complete ? 'text-emerald-700' : 'text-[#003e7e]'}`}>{submitted}</strong><span className="text-xs text-slate-400">/ {target} 条</span></div>
            <div className="mt-1 text-[10px] text-slate-400">{complete ? '本周目标已完成' : `还需 ${Math.max(0, target - submitted)} 条`}</div>
          </div>
          <div className="min-w-[150px] flex-1 border-b border-[var(--cd-color-border)] px-3.5 py-3 sm:border-b-0 sm:border-r">
            <div className="text-[10px] font-medium text-slate-400">我的记录</div>
            <strong className="mt-1 block text-xl tabular-nums text-slate-900">{submissions.length}</strong>
          </div>
          <div className="min-w-[170px] flex-1 border-b border-[var(--cd-color-border)] px-3.5 py-3 sm:border-b-0 sm:border-r">
            <div className="text-[10px] font-medium text-slate-400">工作区状态</div>
            <div className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">{loading ? <RotateCcw size={13} className="animate-spin text-[#003e7e]" /> : <CheckCircle2 size={13} className="text-emerald-600" />}{loading ? '正在刷新数据' : '数据已就绪'}</div>
          </div>
          <div className="min-w-[150px] flex-1 px-3.5 py-3">
            <div className="text-[10px] font-medium text-slate-400">最近写入</div>
            <strong className="mt-1.5 block text-xs font-semibold text-slate-700">{lastSubmissionAt ? lastSubmissionAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '本次会话暂无'}</strong>
          </div>
        </section>

        {(progressError || submissionsError) && <div className="grid gap-2 sm:grid-cols-2">{progressError && <div className="flex items-center gap-2"><ValidationMessage severity="error">本周进度：{progressError}</ValidationMessage><button onClick={() => { void refreshData(); }} className="rounded-md border border-slate-200 bg-white p-2 text-slate-500" aria-label="重试加载本周进度"><RotateCcw size={13} /></button></div>}{submissionsError && <div className="flex items-center gap-2"><ValidationMessage severity="error">提交记录：{submissionsError}</ValidationMessage><button onClick={() => { void refreshData(); }} className="rounded-md border border-slate-200 bg-white p-2 text-slate-500" aria-label="重试加载提交记录"><RotateCcw size={13} /></button></div>}</div>}

        <MySubmissionTable items={submissions} userName={userName} onEdit={openEdit} onTransfer={openTransfer} />

        {canViewTeamSubmissions && <section aria-label="团队成交汇总">{teamError ? <div className="flex items-center gap-2"><ValidationMessage severity="error">团队成交：{teamError}</ValidationMessage><button onClick={() => { void refreshData(); }} className="rounded-md border border-slate-200 bg-white p-2 text-slate-500"><RotateCcw size={13} /></button></div> : loading && teamSubmissions.length === 0 ? <div className="rounded-lg border border-[#d9e0e8] bg-white p-10 text-center text-xs text-slate-400">正在加载团队成交数据…</div> : <SubmissionDetailTable submissions={teamSubmissions} title="团队成交汇总" highlightUserId={userId} canManageTeamRecords={admin} onEdit={openEdit} />}</section>}
      </main>

      <LeaseTransactionForm isOpen={showForm} onClose={() => { setShowForm(false); setEditingRecord(null); }} onSubmitSuccess={refreshData} userId={userId} userName={userName} mode={editingRecord ? 'edit' : 'create'} initialData={editingRecord || undefined} />

      {transferringRecord && (
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
