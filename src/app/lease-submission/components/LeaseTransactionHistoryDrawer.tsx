'use client';

import * as React from 'react';
import { ChevronDown, History, Loader2, Search, ShieldCheck, X } from 'lucide-react';

import { supabase } from '@/src/services/supabaseClient';
import type { LeaseTransaction } from '@/src/types/lease-transaction';
import { buildLeaseTransactionChanges } from '../leaseTransactionChangeHistory';

interface LeaseHistoryRow {
  id: number;
  user_id: string;
  occurred_at?: string | null;
  created_at?: string | null;
  target_id?: string | null;
  target_name?: string | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  details?: Record<string, unknown> | null;
}

interface UserRow {
  user_id: string;
  chinese_name?: string | null;
  full_name?: string | null;
  email?: string | null;
}

interface LeaseTransactionHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  record?: LeaseTransaction | null;
}

const MAX_HISTORY_ROWS = 300;

function formatTime(value?: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function historySearchText(row: LeaseHistoryRow): string {
  const before = row.old_values || {};
  const after = row.new_values || {};
  return [
    row.target_name,
    before.company,
    before.new_building,
    after.company,
    after.new_building,
  ].filter(Boolean).join(' ').toLowerCase();
}

export function LeaseTransactionHistoryDrawer({ open, onClose, record = null }: LeaseTransactionHistoryDrawerProps) {
  const [rows, setRows] = React.useState<LeaseHistoryRow[]>([]);
  const [users, setUsers] = React.useState<UserRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [operator, setOperator] = React.useState('ALL');
  const [timeRange, setTimeRange] = React.useState<'7d' | '30d' | 'all'>('30d');
  const [expandedId, setExpandedId] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setExpandedId(null);

    void (async () => {
      try {
        let historyQuery = supabase
          .from('audit_logs')
          .select('id,user_id,occurred_at,created_at,target_id,target_name,old_values,new_values,details')
          .eq('action_type', 'LEASE_TRANSACTION_UPDATE')
          .eq('target_table', 'lease_transactions')
          .order('occurred_at', { ascending: false })
          .limit(MAX_HISTORY_ROWS);

        if (record?.id) historyQuery = historyQuery.eq('target_id', record.id);

        const [historyResult, userResult] = await Promise.all([
          historyQuery,
          supabase.from('user_roles').select('user_id,chinese_name,full_name,email'),
        ]);

        if (historyResult.error) throw historyResult.error;
        if (userResult.error) throw userResult.error;
        if (cancelled) return;

        setRows((historyResult.data || []) as LeaseHistoryRow[]);
        setUsers((userResult.data || []) as UserRow[]);
      } catch (error) {
        console.error('加载租赁成交变更记录失败', error);
        if (!cancelled) {
          setRows([]);
          setUsers([]);
          setLoadError('变更记录暂时无法加载，请稍后重试。');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, record?.id]);

  React.useEffect(() => {
    if (!open) {
      setSearch('');
      setOperator('ALL');
      setTimeRange('30d');
      setExpandedId(null);
    }
  }, [open]);

  const userNames = React.useMemo(() => new Map(
    users.map((user) => [
      user.user_id,
      user.chinese_name?.trim() || user.full_name?.trim() || user.email?.trim() || user.user_id,
    ]),
  ), [users]);

  const operators = React.useMemo(() => {
    const ids = Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean)));
    return ids.map((id) => ({ id, name: userNames.get(id) || (id === 'system' ? '系统' : '未知用户') }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [rows, userNames]);

  const filteredRows = React.useMemo(() => {
    const now = Date.now();
    const query = search.trim().toLowerCase();
    const cutoff = timeRange === 'all'
      ? null
      : now - (timeRange === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000;

    return rows.filter((row) => {
      const when = Date.parse(row.occurred_at || row.created_at || '');
      if (cutoff !== null && Number.isFinite(when) && when < cutoff) return false;
      if (operator !== 'ALL' && row.user_id !== operator) return false;
      if (query && !historySearchText(row).includes(query)) return false;
      return true;
    });
  }, [operator, rows, search, timeRange]);

  if (!open) return null;

  const title = record
    ? `${record.company || '成交记录'} · ${record.new_building || '未标记楼宇'}`
    : '成交变更记录';

  return (
    <>
      <div className="fixed inset-0 z-[110] bg-slate-950/30" onClick={onClose} aria-hidden="true" />
      <aside className="fixed inset-y-0 right-0 z-[115] flex w-full max-w-2xl flex-col border-l border-zinc-200 bg-zinc-50 shadow-2xl" role="dialog" aria-modal="true" aria-label="租赁成交变更记录">
        <header className="shrink-0 border-b border-zinc-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <History size={16} className="shrink-0 text-[#003e7e]" />
                <h2 className="truncate text-sm font-semibold text-zinc-900">{title}</h2>
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-400"><ShieldCheck size={12} />仅管理员可见 · 数据库自动留痕</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label="关闭变更记录"><X size={17} /></button>
          </div>

          {!record && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <label className="relative min-w-[210px] flex-1">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索企业 / 楼宇" className="h-8 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-2 text-xs outline-none focus:border-[#003e7e]" />
              </label>
              <select value={operator} onChange={(event) => setOperator(event.target.value)} className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-600">
                <option value="ALL">全部操作人</option>
                {operators.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <select value={timeRange} onChange={(event) => setTimeRange(event.target.value as '7d' | '30d' | 'all')} className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-600">
                <option value="7d">近 7 天</option>
                <option value="30d">近 30 天</option>
                <option value="all">全部</option>
              </select>
            </div>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-xs text-zinc-500"><Loader2 size={14} className="animate-spin" />正在读取变更记录</div>
          ) : loadError ? (
            <div className="px-5 py-16 text-center text-xs text-rose-700">{loadError}</div>
          ) : filteredRows.length === 0 ? (
            <div className="px-5 py-20 text-center"><History size={28} className="mx-auto text-zinc-300" /><p className="mt-2 text-xs font-medium text-zinc-500">暂无符合条件的变更记录</p></div>
          ) : (
            <div className="divide-y divide-zinc-200">
              {filteredRows.map((row) => {
                const changes = buildLeaseTransactionChanges(
                  row.old_values || {},
                  row.new_values || {},
                );
                const expanded = expandedId === row.id;
                const operatorName = userNames.get(row.user_id) || (row.user_id === 'system' ? '系统' : '未知用户');
                return (
                  <article key={row.id} className="bg-white">
                    <button type="button" onClick={() => setExpandedId((current) => current === row.id ? null : row.id)} className="flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-zinc-50">
                      <ChevronDown size={14} className={`mt-0.5 shrink-0 text-zinc-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-xs font-semibold text-zinc-800">{operatorName}</span>
                          <span className="text-[11px] text-zinc-400">{formatTime(row.occurred_at || row.created_at)}</span>
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-[#003e7e]">{changes.length > 0 ? `修改 ${changes.length} 项` : '系统字段变更'}</span>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-zinc-500">{row.target_name || [row.new_values?.company, row.new_values?.new_building].filter(Boolean).join(' · ') || row.target_id || '成交记录'}</p>
                      </div>
                    </button>
                    {expanded && (
                      <div className="border-t border-zinc-100 bg-zinc-50/60 px-5 py-3">
                        {changes.length > 0 ? (
                          <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
                            <div className="grid grid-cols-[minmax(90px,.8fr)_1fr_1fr] border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-[10px] font-semibold text-zinc-400"><span>字段</span><span>修改前</span><span>修改后</span></div>
                            {changes.map((change) => (
                              <div key={change.key} className="grid grid-cols-[minmax(90px,.8fr)_1fr_1fr] border-b border-zinc-100 px-3 py-2 text-[11px] last:border-b-0">
                                <span className="font-medium text-zinc-600">{change.label}</span>
                                <span className="break-words pr-3 text-zinc-500">{change.beforeText}</span>
                                <span className="break-words font-medium text-zinc-800">{change.afterText}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="rounded-md border border-zinc-200 bg-white px-3 py-3 text-[11px] text-zinc-500">本次只涉及记录归属或系统字段变化，业务字段未发生变化。</p>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-zinc-200 bg-white px-5 py-3 text-[10px] text-zinc-400">
          <span>当前显示 {filteredRows.length} 条</span>
          {!record && rows.length >= MAX_HISTORY_ROWS && <span>最多加载最近 {MAX_HISTORY_ROWS} 条，可通过筛选缩小范围</span>}
        </footer>
      </aside>
    </>
  );
}
