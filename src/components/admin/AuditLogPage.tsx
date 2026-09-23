'use client';

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/src/services/supabaseClient';
import { getLogBadgeStyle, parseAuditLog } from '@/src/utils/auditTranslator';
import { MaskedText } from '@/src/components/demo';
import { AuthAuditLogPanel } from './AuthAuditLogPanel';

type AuditTab = 'user' | 'files' | 'admin' | 'database' | 'trail' | 'security' | 'auth';
type AppAuditTab = Exclude<AuditTab, 'auth'>;

interface AuditLog {
  id: number; user_id: string; action_type: string; details: Record<string, unknown>; created_at: string;
  occurred_at?: string; ip_address?: string; ip_country?: string; ip_region?: string; ip_city?: string;
  user_agent?: string; auth_session_id?: string; client_device_id?: string;
  browser_name?: string; browser_version?: string; os_name?: string; os_version?: string; device_type?: string;
  request_source?: string; module?: string; page_url?: string; target_table?: string; target_id?: string; target_name?: string;
  old_values?: Record<string, unknown>; new_values?: Record<string, unknown>; error_message?: string;
}
interface AuditLogWithUser extends AuditLog { user_name?: string }
interface UserOption { id: string; name: string; auditIds: string[]; role?: string }

const PAGE_SIZE = 50;
const MODULE_NAMES: Record<string, string> = { map:'地图', admin:'管理后台', update:'季度填报', bi:'商业分析', intelligence:'AI 智能推荐', 'lease-submission':'租赁成交', oss:'研究资料库', login:'登录', home:'首页', settings:'设置' };

const TRAIL_ACTIONS = [
  'PAGE_VIEW','ENTER_MODULE','MAP_FILTER','SEARCH','VIEW_BUILDING','VIEW_BI_CHART',
  'OPEN_LEASE_FORM','LOOKUP_LEASE_COMPANY_HISTORY',
];
const DATABASE_ACTIONS = ['DB_INSERT','DB_UPDATE','DB_DELETE','LEASE_TRANSACTION_UPDATE'];
const AUTH_ACTIONS = ['LOGIN','LOGIN_FAILED','LOGOUT'];
const FILE_ACTIONS = [
  'OSS_FILE_ACCESS','OSS_UPLOAD','OSS_DELETE','OSS_BATCH_DELETE','OSS_CREATE_FOLDER','OSS_MOVE',
  'EXPORT_DATA','EXPORT_LEASE_TRANSACTIONS','EXPORT_BACKUP','EXPORT_MAP_DATA','EXPORT_REPORT','EXPORT_TABLE','EXPORT_CHART',
  'EXPORT_CHART','EXPORT_TABLE','EXPORT_REPORT','UPLOAD_FILE','DELETE_FILE','IMPORT_DATA',
];
const HIGH_RISK_ACTIONS = [
  'LOGIN_FAILED','DELETE_USER','DELETE_PROJECT','DB_DELETE','OSS_DELETE','OSS_BATCH_DELETE',
  'IMPERSONATE_START','impersonate_start','CHANGE_PASSWORD','ACCESS_DENIED','EXPORT_BACKUP',
];
const HIGH_RISK_SET = new Set(HIGH_RISK_ACTIONS);
const HIGH_RISK_FILTER = `action_type.in.(${HIGH_RISK_ACTIONS.join(',')}),error_message.not.is.null`;
const BUSINESS_EXCLUDED_ACTIONS = Array.from(new Set([
  'ADMIN_DATA_OPERATION',
  ...DATABASE_ACTIONS,
  ...TRAIL_ACTIONS,
  ...AUTH_ACTIONS,
]));
const ACTION_TYPES = [
  'ACCESS_DENIED','CHANGE_PASSWORD',
  'SUBMIT_QUARTERLY_DATA','SUBMIT_LEASE_TRANSACTION','TRANSFER_SUBMISSION',
  'POST_MESSAGE','UPDATE_NOTICE','DELETE_NOTICE',
  'EXPORT_DATA','EXPORT_LEASE_TRANSACTIONS','EXPORT_BACKUP','EXPORT_MAP_DATA',
  'OSS_FILE_ACCESS','OSS_UPLOAD','OSS_DELETE','OSS_BATCH_DELETE','OSS_CREATE_FOLDER','OSS_MOVE',
  'AI_REQUIREMENT_PARSE','AI_RECOMMENDATION',
  'SUBMIT_FEEDBACK','FEEDBACK_SUBMITTED','FEEDBACK_USER_REPLIED','FEEDBACK_ADMIN_CREATED','FEEDBACK_ADMIN_REPLIED','FEEDBACK_STATUS_CHANGED',
  'UPDATE_LEASE_TEAM_ACCESS',
  'BUILDING_METRICS_UPDATE','BUILDING_METRICS_INSERT',
  'ADMIN_DATA_OPERATION','DB_INSERT','DB_UPDATE','LEASE_TRANSACTION_UPDATE','DB_DELETE',
  'impersonate_start','impersonate_end',
  'CHANGELOG_CREATE','CHANGELOG_UPDATE','CHANGELOG_DELETE',
  'NOTIFICATION_RULE_CREATE','NOTIFICATION_RULE_UPDATE','NOTIFICATION_SEND',
  'PAGE_VIEW','ENTER_MODULE','SEARCH','MAP_FILTER','LOOKUP_LEASE_COMPANY_HISTORY','VIEW_BUILDING','VIEW_BI_CHART','OPEN_LEASE_FORM',
];

const DETAIL_LABELS: Record<string,string> = {
  file_name:'文件', filename:'文件', display_name:'资料名', file_type:'文件类型', folder:'目录',
  record_count:'记录数', count:'数量', table:'数据表', table_label:'业务对象', export_type:'导出类型',
  export_mode:'视图', view_mode:'视图', year:'年份', quarter:'季度', session_index:'提交批次',
  subject_user_name:'数据所属人', subject_user_id:'数据所属人 ID', company:'企业', building:'楼宇',
  building_name:'楼宇', module:'模块', reason:'原因', category:'分类', next_status:'状态', status:'状态',
  model:'模型', candidate_count:'候选数', operation:'操作', access_method:'访问方式', source:'入口',
  report_name:'报告', report_type:'报告类型', export_method:'导出方式',
  size:'文件大小', file_size_bytes:'文件大小（字节）', table_count:'数据表数量', blocked:'是否被阻止',
};

function moduleName(module?: string) { return MODULE_NAMES[module || ''] || module || '未标记模块'; }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)); }
function formatFullTime(value: string) { return new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)); }
function isHighRisk(log: AuditLog) { return HIGH_RISK_SET.has(log.action_type) || Boolean(log.error_message); }
function readable(value: unknown) { if (value == null || value === '') return '—'; if (typeof value === 'object') return JSON.stringify(value); return String(value); }
function isReadableText(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001F\uFFFD]/.test(value); }
function displayActor(log: AuditLogWithUser) { if (isReadableText(log.user_name) && log.user_name !== log.user_id) return log.user_name.trim(); if (['system','unknown','未知用户',''].includes(log.user_id)) return '系统'; return '未匹配用户'; }
function sourceLabel(source?: string) { if (source === 'database_trigger') return '数据库触发器'; if (source === 'frontend') return '用户界面'; return source || '系统'; }
function deviceSummary(log: AuditLog) { return [log.os_name, log.browser_name].filter(Boolean).join(' · ') || log.device_type || '—'; }
function detailLabel(key: string) { return DETAIL_LABELS[key] || key; }
function objectSummary(log: AuditLog) {
  const p = log.details || {};
  const candidates = [
    log.target_name,
    p.display_name,
    p.file_name,
    p.filename,
    p.table_label,
    p.building_name,
    p.buildingName,
    p.company,
    log.target_table,
  ];
  const value = candidates.find(isReadableText);
  return value ? String(value) : '—';
}

function LogItem({ log, isDemo }: { log: AuditLogWithUser; isDemo: boolean }) {
  const [expanded,setExpanded] = useState(false);
  const badge = getLogBadgeStyle(log.action_type);
  const details = Object.entries(log.details || {}).filter(([key]) => !key.startsWith('_') && key !== 'changed_fields').slice(0,8);
  const before = log.old_values || {}; const after = log.new_values || {};
  const changes = Array.from(new Set([...Object.keys(before),...Object.keys(after)])).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  const when = log.occurred_at || log.created_at;
  return <article className={`border-b border-zinc-100 ${isHighRisk(log) ? 'bg-amber-50/30' : 'bg-white'}`}>
    <button type="button" onClick={() => setExpanded(v => !v)} aria-expanded={expanded} className="grid w-full grid-cols-[88px_minmax(120px,.75fr)_minmax(260px,2fr)_minmax(130px,.9fr)_130px_24px] items-center gap-3 px-5 py-3 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#24478f] max-lg:grid-cols-[78px_minmax(0,1fr)_100px_20px]">
      <time className="text-xs tabular-nums text-zinc-400">{formatTime(when)}</time>
      <span className="truncate text-xs text-zinc-600"><MaskedText>{displayActor(log)}</MaskedText></span>
      <span className="min-w-0 flex items-center gap-2"><span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${badge.className}`}>{badge.label}</span>{isHighRisk(log) && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">需关注</span>}<span className="truncate text-[13px] text-zinc-800">{parseAuditLog(log.action_type,log.details)}</span></span>
      <span className="truncate text-xs text-zinc-500 max-lg:hidden">{objectSummary(log)}</span>
      <span className="truncate text-right text-[11px] text-zinc-400 max-lg:hidden">{deviceSummary(log)}</span>
      <svg aria-hidden="true" className={`h-3.5 w-3.5 text-zinc-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" /></svg>
    </button>
    {expanded && <div className="border-t border-zinc-100 bg-zinc-50 px-5 py-4">
      <div className="grid gap-x-8 gap-y-2 text-xs text-zinc-500 sm:grid-cols-2 lg:grid-cols-4">
        <span><b className="font-medium text-zinc-700">发生时间：</b>{formatFullTime(when)}</span><span><b className="font-medium text-zinc-700">入库时间：</b>{formatFullTime(log.created_at)}</span><span><b className="font-medium text-zinc-700">模块：</b>{moduleName(log.module)}</span><span><b className="font-medium text-zinc-700">来源：</b>{sourceLabel(log.request_source)}</span>
        <span><b className="font-medium text-zinc-700">IP：</b>{isDemo ? '***' : log.ip_address || '—'}</span><span><b className="font-medium text-zinc-700">地区：</b>{isDemo ? '***' : [log.ip_country,log.ip_region,log.ip_city].filter(Boolean).join(' / ') || '—'}</span><span><b className="font-medium text-zinc-700">设备：</b>{[log.os_name,log.os_version,log.browser_name,log.browser_version].filter(Boolean).join(' ') || '—'}</span><span><b className="font-medium text-zinc-700">类型：</b>{log.device_type || '—'}</span>
        <span className="sm:col-span-2"><b className="font-medium text-zinc-700">Device ID：</b><span className="font-mono">{isDemo ? '***' : log.client_device_id || '—'}</span></span><span className="sm:col-span-2"><b className="font-medium text-zinc-700">Auth Session：</b><span className="font-mono">{isDemo ? '***' : log.auth_session_id || '—'}</span></span>
      </div>
      {details.length > 0 && <div className="mt-4 overflow-hidden rounded-md border border-zinc-200 bg-white"><div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium text-zinc-800">操作信息</div><div className="grid sm:grid-cols-2">{details.map(([key,value]) => <div key={key} className="flex gap-3 border-b border-zinc-100 px-3 py-2 text-xs"><span className="shrink-0 text-zinc-400">{detailLabel(key)}</span><span className="break-words text-zinc-700">{readable(value)}</span></div>)}</div></div>}
      {changes.length > 0 && <div className="mt-4 overflow-hidden rounded-md border border-zinc-200 bg-white"><div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium text-zinc-800">字段变更</div>{changes.map(key => <div key={key} className="grid grid-cols-[minmax(100px,.7fr)_1fr_1fr] border-b border-zinc-100 text-xs"><div className="px-3 py-2 text-zinc-700">{key}</div><div className="px-3 py-2 text-zinc-500">{readable(before[key])}</div><div className="px-3 py-2 text-zinc-800">{readable(after[key])}</div></div>)}</div>}
      {log.error_message && <p className="mt-3 rounded border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">失败原因：{log.error_message}</p>}
      <details className="mt-3 text-xs text-zinc-500"><summary className="cursor-pointer">技术详情</summary><pre className="mt-2 max-h-48 overflow-auto rounded bg-zinc-900 p-3 text-[11px] text-zinc-200">{JSON.stringify({ id:log.id,page_url:log.page_url,target_id:log.target_id,user_agent:log.user_agent },null,2)}</pre></details>
    </div>}
  </article>;
}

export function AuditLogPage() {
  const [logTab,setLogTab] = useState<AuditTab>('user');
  const [logs,setLogs] = useState<AuditLogWithUser[]>([]); const [loading,setLoading] = useState(true); const [loadError,setLoadError] = useState('');
  const [filterUser,setFilterUser] = useState('ALL'); const [filterAction,setFilterAction] = useState('ALL'); const [timeRange,setTimeRange] = useState('week'); const [highRiskOnly,setHighRiskOnly] = useState(false); const [excludeAdmins,setExcludeAdmins] = useState(false);
  const [ipSearch,setIpSearch] = useState(''); const [deviceSearch,setDeviceSearch] = useState(''); const [sessionSearch,setSessionSearch] = useState(''); const [deviceType,setDeviceType] = useState('ALL');
  const [page,setPage] = useState(0); const [totalCount,setTotalCount] = useState(0); const [historyTotal,setHistoryTotal] = useState(0); const [isDemo,setIsDemo] = useState(false); const [lastUpdated,setLastUpdated] = useState<Date|null>(null); const [authRefresh,setAuthRefresh] = useState(0);
  const [tabCounts,setTabCounts] = useState({user:0,files:0,admin:0,database:0,trail:0,security:0}); const [userOptions,setUserOptions] = useState<UserOption[]>([]);

  useEffect(() => { try { queueMicrotask(() => setIsDemo(Boolean(sessionStorage.getItem('__impersonation_state')))); } catch {} },[]);
  useEffect(() => { supabase.from('user_roles').select('user_id,email,chinese_name,full_name,role').then(({data}) => { if (!data) return; setUserOptions(data.flatMap(user => { const id=user.user_id||user.email; if(!id) return []; const candidate=user.chinese_name||user.full_name||user.email||user.user_id; return [{id:String(user.user_id || id),name:isReadableText(candidate)?candidate.trim():'未命名用户',auditIds:[user.user_id,user.email].filter(Boolean).map(String),role:user.role||undefined}]; }).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'))); }); },[]);
  const userNames = useMemo(() => new Map(userOptions.flatMap(option => option.auditIds.map(id => [id,option.name] as const))),[userOptions]);
  const adminAuditIds = useMemo(() => Array.from(new Set(userOptions.filter(option => ['admin','super_admin'].includes(String(option.role || '').toLowerCase())).flatMap(option => option.auditIds))),[userOptions]);

  const applyFilters = useCallback((query:any, tab:AppAuditTab = logTab === 'auth' ? 'user' : logTab) => {
    if(tab==='admin') {
      query=query.eq('action_type','ADMIN_DATA_OPERATION');
    } else if(tab==='files') {
      query=query.in('action_type',FILE_ACTIONS);
    } else if(tab==='database') {
      query=query.or(`request_source.eq.database_trigger,action_type.in.(${DATABASE_ACTIONS.join(',')})`);
    } else if(tab==='trail') {
      query=query.in('action_type',TRAIL_ACTIONS);
    } else if(tab==='security') {
      query=query.or(HIGH_RISK_FILTER);
    } else {
      for (const action of BUSINESS_EXCLUDED_ACTIONS) query=query.neq('action_type',action);
      query=query.neq('request_source','database_trigger');
    }

    if(filterUser!=='ALL'){
      const selected=userOptions.find(o=>o.id===filterUser);
      query=query.in('user_id',selected?.auditIds||[filterUser]);
    } else if(excludeAdmins) {
      for (const adminId of adminAuditIds) query=query.neq('user_id',adminId);
    }

    if(filterAction!=='ALL') query=query.eq('action_type',filterAction);
    if(highRiskOnly&&tab!=='security') query=query.or(HIGH_RISK_FILTER);
    if(timeRange!=='all'){ const now=new Date(); const start=timeRange==='today'?new Date(now.getFullYear(),now.getMonth(),now.getDate()):timeRange==='week'?new Date(now.getTime()-7*86400000):new Date(now.getFullYear(),now.getMonth(),1); query=query.gte('occurred_at',start.toISOString()); }
    if(ipSearch.trim()) query=query.ilike('ip_address',`%${ipSearch.trim()}%`);
    if(deviceSearch.trim()) query=query.ilike('client_device_id',`%${deviceSearch.trim()}%`);
    if(sessionSearch.trim()) query=query.eq('auth_session_id',sessionSearch.trim());
    if(deviceType!=='ALL') query=query.eq('device_type',deviceType);
    return query;
  },[adminAuditIds,deviceSearch,deviceType,excludeAdmins,filterAction,filterUser,highRiskOnly,ipSearch,logTab,sessionSearch,timeRange,userOptions]);

  const fetchLogs = useCallback(async(nextPage:number) => { if(logTab==='auth'){setLoading(false);return;} setLoading(true);setLoadError(''); try { const query=applyFilters(supabase.from('audit_logs').select('*',{count:'exact'}),logTab).order('occurred_at',{ascending:false}); const {data,count,error}=await query.range(nextPage*PAGE_SIZE,(nextPage+1)*PAGE_SIZE-1); if(error) throw error; setLogs((data||[]).map((log:AuditLog)=>({...log,user_name:userNames.get(log.user_id)}))); setTotalCount(count||0);setLastUpdated(new Date()); } catch(error){console.error('获取审计日志失败:',error);setLogs([]);setTotalCount(0);setLoadError('日志暂时无法加载，请刷新后重试。');} finally{setLoading(false);} },[applyFilters,logTab,userNames]);
  useEffect(()=>{ if(logTab==='auth'){setLoading(false);return;} queueMicrotask(()=>{setPage(0);void fetchLogs(0);}); },[fetchLogs,logTab]);
  useEffect(()=>{ Promise.all((['user','files','admin','database','trail','security'] as const).map(tab=>applyFilters(supabase.from('audit_logs').select('*',{count:'exact',head:true}),tab))).then(([user,files,admin,database,trail,security])=>setTabCounts({user:user.count||0,files:files.count||0,admin:admin.count||0,database:database.count||0,trail:trail.count||0,security:security.count||0})); },[applyFilters]);
  useEffect(()=>{supabase.from('audit_logs').select('*',{count:'exact',head:true}).then(({count})=>setHistoryTotal(count||0));},[]);

  const totalPages=Math.ceil(totalCount/PAGE_SIZE); const hasFilters=filterUser!=='ALL'||filterAction!=='ALL'||timeRange!=='week'||highRiskOnly||excludeAdmins||Boolean(ipSearch||deviceSearch||sessionSearch)||deviceType!=='ALL';
  const resetFilters=()=>{setFilterUser('ALL');setFilterAction('ALL');setTimeRange('week');setHighRiskOnly(false);setExcludeAdmins(false);setIpSearch('');setDeviceSearch('');setSessionSearch('');setDeviceType('ALL');};
  const tabs=[{key:'user',label:'业务活动'},{key:'files',label:'文件 / 导出'},{key:'admin',label:'后台数据操作'},{key:'database',label:'数据库变更'},{key:'trail',label:'访问轨迹'},{key:'security',label:'需关注'},{key:'auth',label:'登录记录'}] as const;

  return <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white" aria-label="审计日志">
    <header className="shrink-0 border-b border-zinc-200 bg-white px-5 pt-4">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-base font-semibold text-zinc-900">审计日志</h2><p className="mt-1 text-xs text-zinc-500">优先呈现可追责的业务动作；页面访问与筛选等低风险行为已独立到「访问轨迹」</p></div><div className="flex items-center gap-3"><span className="hidden text-[11px] text-zinc-400 sm:inline">{lastUpdated?`更新于 ${formatTime(lastUpdated.toISOString())}`:'尚未加载'}</span><button type="button" onClick={()=>logTab==='auth'?setAuthRefresh(v=>v+1):void fetchLogs(page)} className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50">刷新</button></div></div>
      <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50/60 sm:grid-cols-4"><div className="border-r border-zinc-200 px-3 py-2.5"><p className="text-[11px] text-zinc-500">历史总量</p><p className="text-lg font-semibold">{historyTotal}</p></div><div className="border-r border-zinc-200 px-3 py-2.5"><p className="text-[11px] text-zinc-500">当前筛选</p><p className="text-lg font-semibold">{logTab==='auth'?'—':totalCount}</p></div><div className="border-r border-zinc-200 px-3 py-2.5"><p className="text-[11px] text-zinc-500">当前范围需关注</p><p className="text-lg font-semibold text-amber-700">{tabCounts.security}</p></div><div className="px-3 py-2.5"><p className="text-[11px] text-zinc-500">文件 / 导出</p><p className="text-lg font-semibold text-[#24478f]">{tabCounts.files}</p></div></div>
      <div className="mt-4 flex items-center gap-1 overflow-x-auto" role="tablist">{tabs.map(tab=><button key={tab.key} type="button" role="tab" aria-selected={logTab===tab.key} onClick={()=>setLogTab(tab.key)} className={`shrink-0 border-b-2 px-3 py-2 text-xs font-medium ${logTab===tab.key?'border-[#24478f] text-[#24478f]':'border-transparent text-zinc-500'}`}>{tab.label}{tab.key!=='auth'&&<span className="ml-1.5 text-zinc-400">{tabCounts[tab.key]}</span>}</button>)}</div>
      {logTab!=='auth'&&<div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 py-3"><select value={filterUser} onChange={e=>setFilterUser(e.target.value)} className="rounded-md border border-zinc-200 px-2 py-1.5 text-xs"><option value="ALL">全部人员</option>{userOptions.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select><button type="button" onClick={()=>setExcludeAdmins(v=>!v)} disabled={filterUser!=='ALL'} title={filterUser!=='ALL'?'已指定人员时无需排除管理员':'从当前审计视图中排除所有管理员账号'} className={`rounded-md border px-2.5 py-1.5 text-xs transition ${excludeAdmins&&filterUser==='ALL'?'border-[#24478f] bg-blue-50 text-[#24478f]':'border-zinc-200 text-zinc-600'} disabled:cursor-not-allowed disabled:opacity-40`}>排除管理员</button><select value={filterAction} onChange={e=>setFilterAction(e.target.value)} className="rounded-md border border-zinc-200 px-2 py-1.5 text-xs"><option value="ALL">全部操作</option>{ACTION_TYPES.map(action=><option key={action} value={action}>{getLogBadgeStyle(action).label}</option>)}</select><select value={deviceType} onChange={e=>setDeviceType(e.target.value)} className="rounded-md border border-zinc-200 px-2 py-1.5 text-xs"><option value="ALL">全部设备</option><option value="desktop">Desktop</option><option value="mobile">Mobile</option><option value="tablet">Tablet</option><option value="unknown">Unknown</option></select><input value={ipSearch} onChange={e=>setIpSearch(e.target.value)} placeholder="搜索 IP" className="w-32 rounded-md border border-zinc-200 px-2 py-1.5 text-xs"/><input value={deviceSearch} onChange={e=>setDeviceSearch(e.target.value)} placeholder="Device ID" className="w-36 rounded-md border border-zinc-200 px-2 py-1.5 text-xs"/><input value={sessionSearch} onChange={e=>setSessionSearch(e.target.value)} placeholder="完整 Session UUID" className="w-44 rounded-md border border-zinc-200 px-2 py-1.5 text-xs"/><div className="flex rounded-md border border-zinc-200 p-0.5">{[{key:'today',label:'今日'},{key:'week',label:'近 7 天'},{key:'month',label:'本月'},{key:'all',label:'全部'}].map(r=><button key={r.key} type="button" onClick={()=>setTimeRange(r.key)} className={`rounded px-2 py-1 text-[11px] ${timeRange===r.key?'bg-zinc-100 font-medium':'text-zinc-500'}`}>{r.label}</button>)}</div><button type="button" onClick={()=>setHighRiskOnly(v=>!v)} className={`rounded-md border px-2.5 py-1.5 text-xs ${highRiskOnly?'border-amber-300 bg-amber-50 text-amber-800':'border-zinc-200 text-zinc-600'}`}>仅高风险</button>{hasFilters&&<button type="button" onClick={resetFilters} className="text-xs text-zinc-500">清除筛选</button>}<span className="ml-auto text-xs text-zinc-400">{totalCount} 条</span></div>}
    </header>
    {logTab==='auth'?<AuthAuditLogPanel userOptions={userOptions} isDemo={isDemo} refreshNonce={authRefresh}/>:<><div className="grid shrink-0 grid-cols-[88px_minmax(120px,.75fr)_minmax(260px,2fr)_minmax(130px,.9fr)_130px_24px] gap-3 border-b border-zinc-200 bg-zinc-50 px-5 py-2 text-[11px] font-medium text-zinc-400 max-lg:grid-cols-[78px_minmax(0,1fr)_100px_20px]"><span>时间</span><span>操作人</span><span>操作内容</span><span className="max-lg:hidden">对象</span><span className="text-right max-lg:hidden">设备</span><span/></div><div className="min-h-0 flex-1 overflow-y-auto">{loading?<div className="py-20 text-center text-sm text-zinc-500">正在加载…</div>:loadError?<div className="py-20 text-center text-sm text-red-700">{loadError}</div>:logs.length===0?<div className="py-20 text-center text-sm text-zinc-500">没有符合条件的日志</div>:logs.map(log=><LogItem key={log.id} log={log} isDemo={isDemo}/>)}</div>{totalPages>1&&<footer className="flex shrink-0 items-center justify-between border-t border-zinc-200 px-5 py-3"><span className="text-xs text-zinc-400">第 {page+1} / {totalPages} 页</span><div className="flex gap-2"><button disabled={page===0} onClick={()=>{const next=page-1;setPage(next);void fetchLogs(next);}} className="rounded border border-zinc-200 px-3 py-1.5 text-xs disabled:opacity-40">上一页</button><button disabled={page>=totalPages-1} onClick={()=>{const next=page+1;setPage(next);void fetchLogs(next);}} className="rounded border border-zinc-200 px-3 py-1.5 text-xs disabled:opacity-40">下一页</button></div></footer>}</>}
  </section>;
}
