'use client';

import * as React from 'react';
import { supabase } from '@/src/services/supabaseClient';
import { parseDeviceInfo } from '@/src/utils/deviceInfo';
import { MaskedText } from '@/src/components/demo';

interface UserOption { id: string; name: string; auditIds: string[]; role?: string }
interface AuthAuditRow {
  id: string;
  created_at: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  result: string | null;
  ip_address: string | null;
  user_agent: string | null;
  auth_session_id: string | null;
  metadata: Record<string, unknown> | null;
}

const PAGE_SIZE = 50;

function formatTime(value: string, full = false) {
  return new Intl.DateTimeFormat('zh-CN', full
    ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
    : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

function authActionLabel(action: string) {
  const normalized = action.toLowerCase();
  if (normalized.includes('login') || normalized.includes('sign_in') || normalized.includes('signed_in')) return '登录';
  if (normalized.includes('logout') || normalized.includes('sign_out') || normalized.includes('signed_out')) return '登出';
  if (normalized.includes('password')) return '密码变更';
  if (normalized.includes('refresh')) return '令牌刷新';
  if (normalized.includes('recover')) return '账号恢复';
  return action || '认证事件';
}

function resultLabel(row: AuthAuditRow) {
  if (row.result === 'failed') return { label: '失败', className: 'bg-red-50 text-red-700 ring-red-200' };
  if (row.result === 'success') return { label: '成功', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
  const action = row.action.toLowerCase();
  const failed = action.includes('fail') || action.includes('error');
  return failed
    ? { label: '失败', className: 'bg-red-50 text-red-700 ring-red-200' }
    : { label: '已记录', className: 'bg-zinc-50 text-zinc-600 ring-zinc-200' };
}

function Row({ row, isDemo }: { row: AuthAuditRow; isDemo: boolean }) {
  const [expanded, setExpanded] = React.useState(false);
  const device = parseDeviceInfo(row.user_agent);
  const result = resultLabel(row);
  const deviceLabel = [device.osName, device.browserName].filter(Boolean).join(' · ') || '未知设备';

  return <article className="border-b border-zinc-100 bg-white">
    <button type="button" onClick={() => setExpanded(v => !v)} aria-expanded={expanded} className="grid w-full grid-cols-[88px_minmax(120px,.8fr)_100px_90px_minmax(120px,.9fr)_minmax(150px,1fr)_24px] items-center gap-3 px-5 py-3 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#24478f] max-lg:grid-cols-[78px_minmax(0,1fr)_90px_20px]">
      <time className="text-xs tabular-nums text-zinc-400">{formatTime(row.created_at)}</time>
      <span className="truncate text-xs text-zinc-700"><MaskedText>{row.user_email || row.user_id || '未匹配用户'}</MaskedText></span>
      <span className="text-xs font-medium text-zinc-800">{authActionLabel(row.action)}</span>
      <span><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${result.className}`}>{result.label}</span></span>
      <span className="truncate font-mono text-[11px] text-zinc-500 max-lg:hidden">{isDemo ? '***' : row.ip_address || '—'}</span>
      <span className="truncate text-xs text-zinc-500 max-lg:hidden">{deviceLabel}</span>
      <svg aria-hidden="true" className={`h-3.5 w-3.5 text-zinc-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" /></svg>
    </button>
    {expanded && <div className="border-t border-zinc-100 bg-zinc-50 px-5 py-4 text-xs text-zinc-600">
      <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        <span><b className="font-medium text-zinc-800">完整时间：</b>{formatTime(row.created_at, true)}</span>
        <span><b className="font-medium text-zinc-800">User ID：</b>{isDemo ? '***' : row.user_id || '—'}</span>
        <span><b className="font-medium text-zinc-800">IP：</b>{isDemo ? '***' : row.ip_address || '—'}</span>
        <span><b className="font-medium text-zinc-800">设备：</b>{device.deviceType}</span>
        <span><b className="font-medium text-zinc-800">系统：</b>{[device.osName, device.osVersion].filter(Boolean).join(' ') || '—'}</span>
        <span><b className="font-medium text-zinc-800">浏览器：</b>{[device.browserName, device.browserVersion].filter(Boolean).join(' ') || '—'}</span>
        <span className="sm:col-span-2"><b className="font-medium text-zinc-800">Auth Session：</b><span className="font-mono">{isDemo ? '***' : row.auth_session_id || '—'}</span></span>
      </div>
      <div className="mt-3"><b className="font-medium text-zinc-800">User-Agent：</b><span className="break-all">{row.user_agent || '—'}</span></div>
      {row.metadata && Object.keys(row.metadata).length > 0 && <pre className="mt-3 max-h-40 overflow-auto rounded bg-zinc-900 p-3 text-[11px] text-zinc-200">{JSON.stringify(row.metadata, null, 2)}</pre>}
    </div>}
  </article>;
}

export function AuthAuditLogPanel({ userOptions, isDemo, refreshNonce = 0 }: { userOptions: UserOption[]; isDemo: boolean; refreshNonce?: number }) {
  const [rows, setRows] = React.useState<AuthAuditRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [page, setPage] = React.useState(0);
  const [filterUser, setFilterUser] = React.useState('ALL');
  const [excludeAdmins, setExcludeAdmins] = React.useState(false);
  const [timeRange, setTimeRange] = React.useState('week');

  const load = React.useCallback(async (nextPage = page) => {
    setLoading(true); setError('');
    const now = new Date();
    const from = timeRange === 'all' ? null : timeRange === 'today'
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      : timeRange === 'month'
        ? new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        : new Date(now.getTime() - 7 * 86400000).toISOString();
    const selected = userOptions.find(option => option.id === filterUser);
    const userId = filterUser === 'ALL' ? null : (selected?.id || filterUser);
    const { data, error: rpcError } = await supabase.rpc('admin_get_auth_audit_logs', {
      p_limit: PAGE_SIZE,
      p_offset: nextPage * PAGE_SIZE,
      p_from: from,
      p_user_id: userId,
      p_action: null,
      p_exclude_admins: excludeAdmins && filterUser === 'ALL',
    });
    if (rpcError) {
      console.error('获取认证审计日志失败:', rpcError);
      setRows([]); setError('登录记录暂时无法加载，请稍后重试。');
    } else {
      setRows((data || []) as AuthAuditRow[]);
      setPage(nextPage);
    }
    setLoading(false);
  }, [excludeAdmins, filterUser, page, timeRange, userOptions]);

  React.useEffect(() => { void load(0); }, [excludeAdmins, filterUser, timeRange, refreshNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-5 py-3">
      <select aria-label="按登录用户筛选" value={filterUser} onChange={e => setFilterUser(e.target.value)} className="rounded-md border border-zinc-200 px-2 py-1.5 text-xs"><option value="ALL">全部人员</option>{userOptions.map(option => <option key={option.id} value={option.id}>{option.name}{['admin','super_admin'].includes(String(option.role||'').toLowerCase())?'（管理员）':''}</option>)}</select>
      <button type="button" onClick={() => setExcludeAdmins(value => !value)} disabled={filterUser !== 'ALL'} title={filterUser !== 'ALL' ? '已指定人员时无需排除管理员' : '从登录记录中排除管理员账号'} className={`rounded-md border px-2.5 py-1.5 text-xs transition ${excludeAdmins && filterUser === 'ALL' ? 'border-[#24478f] bg-blue-50 text-[#24478f]' : 'border-zinc-200 text-zinc-600'} disabled:cursor-not-allowed disabled:opacity-40`}>排除管理员</button>
      <div className="flex rounded-md border border-zinc-200 p-0.5">{[{ key:'today',label:'今日'},{key:'week',label:'近 7 天'},{key:'month',label:'本月'},{key:'all',label:'全部'}].map(item => <button key={item.key} type="button" onClick={() => setTimeRange(item.key)} className={`rounded px-2 py-1 text-[11px] ${timeRange === item.key ? 'bg-zinc-100 font-medium text-zinc-900' : 'text-zinc-500'}`}>{item.label}</button>)}</div>
      <span className="ml-auto text-[11px] text-zinc-400">Supabase Auth 权威来源</span>
    </div>
    <div className="grid shrink-0 grid-cols-[88px_minmax(120px,.8fr)_100px_90px_minmax(120px,.9fr)_minmax(150px,1fr)_24px] gap-3 border-b border-zinc-200 bg-zinc-50 px-5 py-2 text-[11px] font-medium text-zinc-400 max-lg:grid-cols-[78px_minmax(0,1fr)_90px_20px]"><span>时间</span><span>用户</span><span>事件</span><span>结果</span><span className="max-lg:hidden">IP</span><span className="max-lg:hidden">设备</span><span /></div>
    <div className="min-h-0 flex-1 overflow-y-auto">{loading ? <div className="py-20 text-center text-sm text-zinc-500">正在加载…</div> : error ? <div className="py-20 text-center text-sm text-red-700">{error}</div> : rows.length === 0 ? <div className="px-6 py-20 text-center"><p className="text-sm font-medium text-zinc-700">暂无 Supabase Auth 数据库审计记录</p><p className="mt-1 text-xs text-zinc-400">如果近期已有登录行为，请确认 Authentication → Audit Logs 的数据库写入目标已开启。</p></div> : rows.map(row => <Row key={row.id} row={row} isDemo={isDemo} />)}</div>
    <footer className="flex shrink-0 items-center justify-between border-t border-zinc-200 px-5 py-3"><span className="text-xs text-zinc-400">第 {page + 1} 页</span><div className="flex gap-2"><button type="button" disabled={page === 0 || loading} onClick={() => void load(page - 1)} className="rounded border border-zinc-200 px-3 py-1.5 text-xs disabled:opacity-40">上一页</button><button type="button" disabled={rows.length < PAGE_SIZE || loading} onClick={() => void load(page + 1)} className="rounded border border-zinc-200 px-3 py-1.5 text-xs disabled:opacity-40">下一页</button></div></footer>
  </div>;
}
