'use client';

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/src/services/supabaseClient';
import { getLogBadgeStyle, parseAuditLog } from '@/src/utils/auditTranslator';
import { MaskedText } from '@/src/components/demo';

interface AuditLog {
  id: number;
  user_id: string;
  action_type: string;
  details: Record<string, unknown>;
  created_at: string;
  ip_address?: string;
  request_source?: string;
  module?: string;
  page_url?: string;
  target_table?: string;
  target_id?: string;
  target_name?: string;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  error_message?: string;
}

interface AuditLogWithUser extends AuditLog { user_name?: string }
interface UserOption { id: string; name: string; auditIds: string[] }

const PAGE_SIZE = 50;
const MODULE_NAMES: Record<string, string> = {
  map: '地图', admin: '管理后台', update: '季度填报', bi: '商业分析',
  'lease-submission': '租赁成交', oss: '云盘', login: '登录', home: '首页', settings: '设置',
};
const HIGH_RISK_ACTIONS = ['LOGIN_FAILED', 'DELETE_USER', 'DELETE_PROJECT', 'DB_DELETE', 'OSS_DELETE', 'OSS_BATCH_DELETE', 'IMPERSONATE_START', 'impersonate_start', 'CHANGE_PASSWORD'];
const HIGH_RISK_SET = new Set(HIGH_RISK_ACTIONS);
const HIGH_RISK_FILTER = `action_type.in.(${HIGH_RISK_ACTIONS.join(',')}),error_message.not.is.null`;
const ACTION_TYPES = [
  'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'CHANGE_PASSWORD', 'ENTER_MODULE', 'SEARCH', 'MAP_FILTER',
  'LOOKUP_LEASE_COMPANY_HISTORY', 'PAGE_VIEW', 'POST_MESSAGE', 'UPDATE_NOTICE', 'DELETE_NOTICE',
  'VIEW_BUILDING', 'VIEW_BI_CHART', 'EXPORT_MAP_DATA', 'SUBMIT_QUARTERLY_DATA', 'SUBMIT_LEASE_TRANSACTION',
  'OPEN_LEASE_FORM', 'TRANSFER_SUBMISSION', 'BUILDING_METRICS_UPDATE', 'BUILDING_METRICS_INSERT',
  'ADMIN_DATA_OPERATION', 'DB_INSERT', 'DB_UPDATE', 'DB_DELETE', 'OSS_UPLOAD', 'OSS_DELETE', 'OSS_BATCH_DELETE',
  'impersonate_start', 'impersonate_end', 'CHANGELOG_UPDATE', 'OSS_CREATE_FOLDER', 'OSS_MOVE',
  'NOTIFICATION_RULE_CREATE', 'NOTIFICATION_RULE_UPDATE', 'NOTIFICATION_SEND',
];

function moduleName(module?: string) { return MODULE_NAMES[module || ''] || module || '未标记模块'; }
function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
function formatFullTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value));
}
function isHighRisk(log: AuditLog) { return HIGH_RISK_SET.has(log.action_type) || Boolean(log.error_message); }
function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
function getChanges(log: AuditLog) {
  const before = log.old_values || {};
  const after = log.new_values || {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return keys.filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(key => ({ key, before: before[key], after: after[key] }));
}

function detailEntries(details: Record<string, unknown>) {
  return Object.entries(details).filter(([key]) => !key.startsWith('_') && key !== 'changed_fields').slice(0, 8);
}

function sourceLabel(source?: string) {
  if (source === 'database_trigger') return '数据库触发器';
  if (source === 'frontend') return '用户界面';
  return source || '系统';
}

function isReadableText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001F\uFFFD]/.test(value);
}

function displayActor(log: AuditLogWithUser) {
  if (isReadableText(log.user_name) && log.user_name !== log.user_id) return log.user_name.trim();
  if (['system', 'unknown', '未知用户', ''].includes(log.user_id)) return '系统';
  // 历史日志可能来自已移除账户或旧写入方式；不展示 UUID、邮箱或异常字符。
  return '未匹配用户';
}

function LogItem({ log, isDemo }: { log: AuditLogWithUser; isDemo: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const badge = getLogBadgeStyle(log.action_type);
  const changes = getChanges(log);
  const risk = isHighRisk(log);
  const title = parseAuditLog(log.action_type, log.details);
  const details = detailEntries(log.details || {});

  return (
    <article className={`border-b border-zinc-100 ${risk ? 'bg-amber-50/30' : 'bg-white'}`}>
      <button
        type="button"
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
        className="grid w-full grid-cols-[88px_minmax(120px,0.75fr)_minmax(280px,2.5fr)_minmax(120px,1fr)_110px_24px] items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#24478f] max-lg:grid-cols-[78px_minmax(0,1fr)_100px_20px] max-lg:gap-2"
      >
        <time className="text-xs tabular-nums text-zinc-400" dateTime={log.created_at}>{formatTime(log.created_at)}</time>
        <span className="min-w-0 text-xs text-zinc-600 truncate"><MaskedText>{displayActor(log)}</MaskedText></span>
        <span className="min-w-0 flex items-center gap-2">
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${badge.className}`}>{badge.label}</span>
          {risk && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">需关注</span>}
          <span className="truncate text-[13px] text-zinc-800">{title}</span>
        </span>
        <span className="min-w-0 text-xs text-zinc-500 truncate max-lg:hidden">{log.target_name || log.target_table || '—'}</span>
        <span className="text-right text-[11px] text-zinc-400 truncate max-lg:hidden">{moduleName(log.module)}</span>
        <svg aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" /></svg>
      </button>

      {expanded && (
        <div className="border-t border-zinc-100 bg-zinc-50 px-5 py-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs text-zinc-500 sm:grid-cols-4">
            <span><b className="font-medium text-zinc-700">完整时间：</b>{formatFullTime(log.created_at)}</span>
            <span><b className="font-medium text-zinc-700">模块：</b>{moduleName(log.module)}</span>
            <span><b className="font-medium text-zinc-700">对象：</b>{isDemo ? '***' : log.target_name || log.target_table || '—'}</span>
            <span><b className="font-medium text-zinc-700">记录来源：</b>{sourceLabel(log.request_source)}</span>
          </div>

          {details.length > 0 && <div className="mt-4 overflow-hidden rounded-md border border-zinc-200 bg-white"><div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium text-zinc-800">操作信息</div><div className="grid grid-cols-1 divide-y divide-zinc-100 sm:grid-cols-2 sm:divide-y-0">{details.map(([key, value]) => <div key={key} className="flex gap-3 px-3 py-2 text-xs sm:border-r sm:border-zinc-100 even:border-r-0"><span className="shrink-0 text-zinc-400">{key}</span><span className="min-w-0 break-words text-zinc-700">{displayValue(value)}</span></div>)}</div></div>}

          {changes.length > 0 ? (
            <div className="mt-4 overflow-hidden rounded-md border border-zinc-200 bg-white">
              <div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium text-zinc-800">字段变更</div>
              <div className="grid grid-cols-[minmax(120px,0.8fr)_minmax(160px,1fr)_minmax(160px,1fr)] text-xs">
                <div className="bg-zinc-50 px-3 py-2 font-medium text-zinc-500">字段</div><div className="bg-zinc-50 px-3 py-2 font-medium text-zinc-500">修改前</div><div className="bg-zinc-50 px-3 py-2 font-medium text-zinc-500">修改后</div>
                {changes.map(change => <React.Fragment key={change.key}><div className="border-t border-zinc-100 px-3 py-2 text-zinc-700 break-words">{change.key}</div><div className="border-t border-zinc-100 px-3 py-2 text-zinc-500 break-words">{displayValue(change.before)}</div><div className="border-t border-zinc-100 px-3 py-2 text-zinc-800 break-words">{displayValue(change.after)}</div></React.Fragment>)}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-xs text-zinc-400">此记录未保存字段级前后值。</p>
          )}

          {log.error_message && <p className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">失败原因：{log.error_message}</p>}
          <details className="mt-3 text-xs text-zinc-500"><summary className="cursor-pointer select-none hover:text-zinc-800">技术详情</summary><pre className="mt-2 max-h-48 overflow-auto rounded bg-zinc-900 p-3 text-[11px] leading-relaxed text-zinc-200">{JSON.stringify({ id: log.id, ip_address: log.ip_address, target_id: log.target_id, details: log.details }, null, 2)}</pre></details>
        </div>
      )}
    </article>
  );
}

export function AuditLogPage() {
  const [logTab, setLogTab] = useState<'user' | 'admin' | 'database' | 'security'>('user');
  const [logs, setLogs] = useState<AuditLogWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterUser, setFilterUser] = useState('ALL');
  const [filterAction, setFilterAction] = useState('ALL');
  const [timeRange, setTimeRange] = useState('week');
  const [highRiskOnly, setHighRiskOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [tabCounts, setTabCounts] = useState({ user: 0, admin: 0, database: 0, security: 0 });
  const [historyTotal, setHistoryTotal] = useState(0);
  const [isDemo, setIsDemo] = useState(false);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => { try { queueMicrotask(() => setIsDemo(Boolean(sessionStorage.getItem('__impersonation_state')))); } catch {} }, []);
  useEffect(() => {
    supabase.from('user_roles').select('user_id, email, chinese_name, full_name').then(({ data }) => {
      if (!data) return;
      const options = data.flatMap(user => {
        const candidateName = user.chinese_name || user.full_name || user.email || user.user_id;
        const name = isReadableText(candidateName) ? candidateName.trim() : '未命名用户';
        const auditIds = [user.user_id, user.email].filter(Boolean).map(String);
        const id = user.user_id || user.email;
        return id ? [{ id: String(id), name, auditIds }] : [];
      });
      setUserOptions(options.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')));
    });
  }, []);

  const userNames = useMemo(() => new Map(userOptions.flatMap(option => option.auditIds.map(id => [id, option.name] as const))), [userOptions]);
  const applyFilters = useCallback((query: any, tab = logTab) => {
    if (tab === 'admin') query = query.eq('action_type', 'ADMIN_DATA_OPERATION');
    else if (tab === 'database') query = query.eq('request_source', 'database_trigger');
    else if (tab === 'security') query = query.or(HIGH_RISK_FILTER);
    else query = query.neq('action_type', 'ADMIN_DATA_OPERATION').neq('request_source', 'database_trigger');
    if (filterUser !== 'ALL') {
      const selectedUser = userOptions.find(option => option.id === filterUser);
      query = query.in('user_id', selectedUser?.auditIds || [filterUser]);
    }
    if (filterAction !== 'ALL') query = query.eq('action_type', filterAction);
    if (highRiskOnly && tab !== 'security') query = query.or(HIGH_RISK_FILTER);
    if (timeRange !== 'all') {
      const now = new Date();
      const start = timeRange === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : timeRange === 'week' ? new Date(now.getTime() - 7 * 86400000) : new Date(now.getFullYear(), now.getMonth(), 1);
      query = query.gte('created_at', start.toISOString());
    }
    return query;
  }, [filterAction, filterUser, highRiskOnly, logTab, timeRange, userOptions]);

  const fetchLogs = useCallback(async (nextPage: number) => {
    setLoading(true);
    setLoadError('');
    try {
      let query = applyFilters(supabase.from('audit_logs').select('*', { count: 'exact' })).order('created_at', { ascending: false });
      const { data, count, error } = await query.range(nextPage * PAGE_SIZE, (nextPage + 1) * PAGE_SIZE - 1);
      if (error) throw error;
      const mapped = (data || []).map((log: AuditLog) => ({ ...log, user_name: userNames.get(log.user_id) })) as AuditLogWithUser[];
      setLogs(mapped); setTotalCount(count || 0); setLastUpdated(new Date());
    } catch (error) { console.error('获取审计日志失败:', error); setLogs([]); setTotalCount(0); setLoadError('日志暂时无法加载，请刷新后重试。'); }
    finally { setLoading(false); }
  }, [applyFilters, userNames]);

  useEffect(() => { queueMicrotask(() => { setPage(0); fetchLogs(0); }); }, [fetchLogs]);
  useEffect(() => {
    Promise.all((['user', 'admin', 'database', 'security'] as const).map(tab => applyFilters(supabase.from('audit_logs').select('*', { count: 'exact', head: true }), tab)))
      .then(([user, admin, database, security]) => setTabCounts({ user: user.count || 0, admin: admin.count || 0, database: database.count || 0, security: security.count || 0 }));
  }, [applyFilters]);
  useEffect(() => {
    supabase.from('audit_logs').select('*', { count: 'exact', head: true })
      .then(({ count }) => setHistoryTotal(count || 0));
  }, []);

  const hasFilters = filterUser !== 'ALL' || filterAction !== 'ALL' || timeRange !== 'week' || highRiskOnly;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const resetFilters = () => { setFilterUser('ALL'); setFilterAction('ALL'); setTimeRange('week'); setHighRiskOnly(false); };

  return <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white" aria-label="审计日志">
    <header className="shrink-0 border-b border-zinc-200 bg-white px-5 pt-4">
      <div className="flex items-start justify-between gap-4">
        <div><h2 className="text-base font-semibold text-zinc-900">审计日志</h2><p className="mt-1 text-xs text-zinc-500">追溯人员操作、数据变化与安全事件</p></div>
        <div className="flex items-center gap-3"><span className="hidden text-[11px] text-zinc-400 sm:inline">{lastUpdated ? `更新于 ${formatTime(lastUpdated.toISOString())}` : '尚未加载'}</span><button type="button" onClick={() => fetchLogs(page)} aria-label="刷新审计日志" className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24478f]">刷新</button></div>
      </div>
      <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50/60 sm:grid-cols-4"><div className="border-b border-r border-zinc-200 px-3 py-2.5 sm:border-b-0"><p className="text-[11px] text-zinc-500">历史总量</p><p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900">{historyTotal}</p></div><div className="border-b border-zinc-200 px-3 py-2.5 sm:border-b-0 sm:border-r"><p className="text-[11px] text-zinc-500">当前筛选结果</p><p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900">{totalCount}</p></div><div className="border-r border-zinc-200 px-3 py-2.5"><p className="text-[11px] text-zinc-500">当前范围需关注</p><p className={`mt-0.5 text-lg font-semibold tabular-nums ${tabCounts.security ? 'text-amber-700' : 'text-zinc-900'}`}>{tabCounts.security}</p></div><div className="px-3 py-2.5"><p className="text-[11px] text-zinc-500">当前范围数据变更</p><p className="mt-0.5 text-lg font-semibold tabular-nums text-[#24478f]">{tabCounts.database}</p></div></div>
      <div className="mt-4 flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="日志分类">
        {([{ key: 'user', label: '业务活动' }, { key: 'admin', label: '后台数据操作' }, { key: 'database', label: '数据库变更' }, { key: 'security', label: '需关注' }] as const).map(tab => <button key={tab.key} type="button" role="tab" aria-selected={logTab === tab.key} onClick={() => setLogTab(tab.key)} className={`shrink-0 border-b-2 px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24478f] ${logTab === tab.key ? (tab.key === 'security' ? 'border-amber-600 text-amber-700' : 'border-[#24478f] text-[#24478f]') : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>{tab.label}<span className="ml-1.5 tabular-nums text-zinc-400">{tabCounts[tab.key]}</span></button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 py-3">
        <select aria-label="按人员筛选" value={filterUser} onChange={event => setFilterUser(event.target.value)} className="min-w-28 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24478f]"><option value="ALL">全部人员</option>{userOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
        <select aria-label="按操作筛选" value={filterAction} onChange={event => setFilterAction(event.target.value)} className="min-w-28 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24478f]"><option value="ALL">全部操作</option>{ACTION_TYPES.map(action => <option key={action} value={action}>{getLogBadgeStyle(action).label}</option>)}</select>
        <div className="flex rounded-md border border-zinc-200 p-0.5" aria-label="按时间筛选">{[{ key: 'today', label: '今日' }, { key: 'week', label: '近 7 天' }, { key: 'month', label: '本月' }, { key: 'all', label: '全部' }].map(range => <button key={range.key} type="button" onClick={() => setTimeRange(range.key)} className={`rounded px-2 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24478f] ${timeRange === range.key ? 'bg-zinc-100 font-medium text-zinc-900' : 'text-zinc-500 hover:text-zinc-800'}`}>{range.label}</button>)}</div>
        <button type="button" onClick={() => setHighRiskOnly(value => !value)} aria-pressed={highRiskOnly} className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24478f] ${highRiskOnly ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>仅高风险</button>
        {hasFilters && <button type="button" onClick={resetFilters} className="px-1 text-xs text-zinc-500 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24478f]">清除筛选</button>}
        <span className="ml-auto text-xs tabular-nums text-zinc-400">当前筛选：{totalCount} 条</span>
      </div>
    </header>
    <div className="grid shrink-0 grid-cols-[88px_minmax(120px,0.75fr)_minmax(280px,2.5fr)_minmax(120px,1fr)_110px_24px] gap-3 border-b border-zinc-200 bg-zinc-50 px-5 py-2 text-[11px] font-medium text-zinc-400 max-lg:grid-cols-[78px_minmax(0,1fr)_100px_20px] max-lg:gap-2"><span>时间</span><span>操作人</span><span>操作内容</span><span className="max-lg:hidden">对象</span><span className="text-right max-lg:hidden">模块</span><span /></div>
    <div className="min-h-0 flex-1 overflow-y-auto">{loading ? <div className="flex items-center justify-center gap-2 py-20 text-sm text-zinc-500" aria-live="polite"><span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-[#24478f]" />正在加载…</div> : loadError ? <div className="flex flex-col items-center justify-center py-20 text-center"><p className="text-sm font-medium text-red-700">{loadError}</p><button type="button" onClick={() => fetchLogs(page)} className="mt-3 text-xs text-[#24478f] hover:underline">重新加载</button></div> : logs.length === 0 ? <div className="flex flex-col items-center justify-center py-20 text-center"><p className="text-sm font-medium text-zinc-700">没有符合条件的日志</p><p className="mt-1 text-xs text-zinc-400">可调整筛选条件后再试。</p></div> : logs.map(log => <LogItem key={log.id} log={log} isDemo={isDemo} />)}</div>
    {totalPages > 1 && <footer className="flex shrink-0 items-center justify-between border-t border-zinc-200 px-5 py-3"><span className="text-xs tabular-nums text-zinc-400">第 {page + 1} / {totalPages} 页</span><div className="flex gap-2"><button type="button" disabled={page === 0} onClick={() => { const next = page - 1; setPage(next); fetchLogs(next); }} className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24478f]">上一页</button><button type="button" disabled={page >= totalPages - 1} onClick={() => { const next = page + 1; setPage(next); fetchLogs(next); }} className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24478f]">下一页</button></div></footer>}
  </section>;
}
