'use client';

import { LeaseExpiryLink } from '@/src/components/lease/LeaseExpiryLink';
import { ExportReview } from '@/src/components/ExportReview';
import { logAction } from '@/src/utils/audit';
import { brokerReturn, dealHistoryHref, mapBuildingHref } from '@/src/lib/broker/links';
import { DEFAULT_FILTERS, historyContextHref, leaseFilterParams, readHistoryContext, readSavedHistory, type FilterState, type SourceFilter } from './filters';
import { BrokerSearchLink } from '@/src/components/BrokerSearchLink';
import * as React from 'react';
import { formatLeaseRent } from '@/src/utils/formatLeaseRent';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Database,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';

import { getSessionFast } from '@/src/services/Auth';
import { IMPERSONATION_REQUEST_HEADER, getImpersonationTargetUserId, withImpersonationHeaders } from '@/src/services/impersonationHeaders';
import { AppHeader, Button, LoadingState } from '@/src/components/ui';

type LeaseReadRecord = {
  read_id: string;
  record_source: 'live' | 'history';
  building_id: string | null;
  building_match_scope: 'exact' | 'project' | 'reference' | 'unmapped';
  related_building_ids: string[];
  company: string | null;
  industry: string | null;
  sub_industry: string | null;
  demand_type: string | null;
  new_building: string | null;
  sub_market: string | null;
  district: string | null;
  area_sqm: number | null;
  face_rent: number | null;
  effective_rent: number | null;
  lease_term_months: number | null;
  transaction_year: number | null;
  transaction_quarter: string | null;
  transaction_period: string | null;
  transaction_time_precision: string | null;
  remarks: string | null;
  agency_company: string | null;
  agency_person: string | null;
  quality_status: string | null;
};

const touchHeight = 'max-sm:min-h-11 pointer-coarse:min-h-11';
const touchTarget = `${touchHeight} max-sm:min-w-11 pointer-coarse:min-w-11`;

type LeaseReadScope = {
  canReadHistory: boolean;
  effectiveRole: string;
  effectiveSource: string;
  impersonating: boolean;
};

type CountRequest = {
  controller: AbortController;
  params: string;
  headers: Headers;
  scope: LeaseReadScope;
  key: string;
  minimumCount: number;
};

function scopeKey(scope: LeaseReadScope) {
  return JSON.stringify([scope.effectiveRole, scope.effectiveSource, scope.canReadHistory, scope.impersonating]);
}

const CURRENT_YEAR = Number(DEFAULT_FILTERS.yearTo);
const PAGE_SIZE = 50;
const EXPORT_LIMIT = 5000;
const EXPORT_PAGE = 100;

function fmtNumber(value: number | null, maximumFractionDigits = 2) {
  return value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits });
}

function sourceLabel(source: SourceFilter | LeaseReadRecord['record_source']) {
  if (source === 'live') return '实时';
  if (source === 'history') return '历史';
  return '实时 + 历史';
}

function associationLabel(scope: LeaseReadRecord['building_match_scope']) {
  if (scope === 'exact') return '精确到楼宇';
  if (scope === 'project') return '项目级';
  if (scope === 'reference') return '历史参考实体';
  return '未关联';
}

function periodLabel(row: LeaseReadRecord) {
  const year = row.transaction_year ?? '—';
  const quarter = row.transaction_quarter || '';
  return quarter ? `${year} ${quarter}` : String(year);
}

function DetailItem({ label, value, numeric = false }: { label: string; value: React.ReactNode; numeric?: boolean }) {
  return (
    <div className="border-b border-[var(--cd-color-border)]/70 py-3 last:border-b-0">
      <div className="text-[11px] text-[var(--cd-color-text-muted)]">{label}</div>
      <div className={`mt-1 text-[13px] font-medium text-[var(--cd-color-text-primary)] ${numeric ? 'tabular-nums' : ''}`}>{value || '—'}</div>
    </div>
  );
}

function BuildingMeta({ row }: { row: LeaseReadRecord }) {
  return (
    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--cd-color-text-muted)]">
      <span className="truncate">{row.sub_market || row.district || '区域未标注'}</span>
      {row.building_match_scope === 'project' ? (
        <span className="shrink-0 text-[var(--cd-color-brand)]">· 项目级</span>
      ) : row.building_match_scope === 'reference' ? (
        <span className="shrink-0 text-[var(--cd-color-text-secondary)]">· 历史参考</span>
      ) : row.building_match_scope === 'unmapped' ? (
        <span className="shrink-0 text-[var(--cd-color-warning)]">· 未关联</span>
      ) : null}
    </div>
  );
}

export default function LeaseHistoryPage() {
  const [back, setBack] = React.useState<string>();
  const [preferenceKey, setPreferenceKey] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [exportReview, setExportReview] = React.useState(false);
  const [exportError, setExportError] = React.useState('');
  const [exportBusy, setExportBusy] = React.useState(false);
  const exportRequest = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => exportRequest.current?.abort(), []);
  const [filters, setFilters] = React.useState<FilterState>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = React.useState<FilterState>(DEFAULT_FILTERS);
  const [records, setRecords] = React.useState<LeaseReadRecord[]>([]);
  const [count, setCount] = React.useState<number | null>(null);
  const [countStatus, setCountStatus] = React.useState<'idle' | 'loading' | 'error'>('idle');
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [selectedRecord, setSelectedRecord] = React.useState<LeaseReadRecord | null>(null);
  const [canReadHistory, setCanReadHistory] = React.useState<boolean | null>(null);
  const knownCount = React.useRef<{ key: string; count: number; savedAt: number } | null>(null);
  const activeRead = React.useRef<AbortController | null>(null);
  const changedFiltersHere = React.useRef(false);
  const pendingCount = React.useRef<CountRequest | null>(null);

  const loadCount = React.useCallback(async (task: CountRequest) => {
    const { signal } = task.controller;
    if (signal.aborted) return;
    setCountStatus('loading');
    try {
      const response = await fetch(`/api/lease-transactions/read?${task.params}`, { headers: task.headers, signal });
      const body = await response.json().catch(() => ({}));
      if (signal.aborted) return;
      if (response.status === 401 || response.status === 403 ||
          (response.ok && body.access && scopeKey(body.access) !== scopeKey(task.scope))) {
        knownCount.current = null;
        pendingCount.current = null;
        setCanReadHistory(false);
        setSelectedRecord(null);
        setRecords([]);
        setCount(null);
        setCountStatus('idle');
        setError('读取权限已变化，请重新加载');
        return;
      }
      if (!response.ok || !body.access || !Number.isSafeInteger(body.count) || body.count < task.minimumCount) {
        throw new Error('成交总数暂不可用');
      }
      knownCount.current = { key: task.key, count: body.count, savedAt: Date.now() };
      pendingCount.current = null;
      setCount(body.count);
      setCountStatus('idle');
    } catch {
      if (!signal.aborted) setCountStatus('error');
    }
  }, []);

  const load = React.useCallback(async (pageIndex: number, queryFilters: FilterState, detail?: string | null) => {
    activeRead.current?.abort();
    const controller = new AbortController();
    const { signal } = controller;
    activeRead.current = controller;
    pendingCount.current = null;
    setLoading(true);
    setError(null);
    setSelectedRecord(null);
    setCount(null);
    setCountStatus('idle');
    setPage(pageIndex);
    try {
      const session = await getSessionFast();
      if (signal.aborted) return;
      const token = session?.session?.access_token;
      if (!token) throw new Error('登录状态异常，请重新登录');

      const filters = leaseFilterParams(queryFilters);

      const headers = withImpersonationHeaders({ Authorization: `Bearer ${token}` });
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageIndex * PAGE_SIZE),
        include_count: '0',
      });
      filters.forEach((value, key) => params.set(key, value));
      const response = await fetch(`/api/lease-transactions/read?${params}`, { headers, signal });
      const body = await response.json().catch(() => ({}));
      if (signal.aborted) return;
      if (!response.ok || !body.access || !Array.isArray(body.records)) {
        if (response.status === 403) setCanReadHistory(false);
        throw new Error(body.error || '查询失败');
      }
      const scope: LeaseReadScope = body.access;
      setCanReadHistory(body?.access?.canReadHistory === true);
      setRecords(body.records);
      if (detail) setSelectedRecord(body.records.find((row: LeaseReadRecord) => row.read_id === detail) ?? null);
      const minimumCount = body.records.length === 0 ? 0 : pageIndex * PAGE_SIZE + body.records.length;
      const key = JSON.stringify([session.user.id, session.role, token, headers.get(IMPERSONATION_REQUEST_HEADER), scopeKey(scope), filters.toString()]);
      const previous = pageIndex > 0 && knownCount.current?.key === key ? knownCount.current : null;
      if (previous && previous.count >= minimumCount && Date.now() - previous.savedAt < 30_000) {
        setCount(previous.count);
      } else {
        const countParams = new URLSearchParams(filters);
        countParams.set('count_only', '1');
        const task = { controller, params: countParams.toString(), headers, scope, key, minimumCount };
        pendingCount.current = task;
        void loadCount(task);
      }
    } catch (loadError) {
      if (signal.aborted) return;
      setError(loadError instanceof Error ? loadError.message : '查询失败');
      setRecords([]);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [loadCount]);

  React.useEffect(() => {
    let alive = true;
    const params = new URLSearchParams(window.location.search);
    const context = readHistoryContext(params);
    setBack(brokerReturn(params.get('back')));
    void getSessionFast().then(session => {
      if (!alive) return;
      const target = withImpersonationHeaders().get(IMPERSONATION_REQUEST_HEADER) ?? '';
      const key = session ? `broker-deals:v1:${JSON.stringify([session.user.id, session.role, target])}` : '';
      const saved = key && !context ? readSavedHistory(window.sessionStorage, key + ':recent', session?.role === 'admin' && !target) : null;
      const starting = context ?? saved;
      const initial = starting?.filters ?? DEFAULT_FILTERS;
      setPreferenceKey(key);
      setFilters(initial);
      setAppliedFilters(initial);
      void load(starting?.page ?? 0, initial, starting?.detail);
    }).catch(() => { if (alive) void load(0, context?.filters ?? DEFAULT_FILTERS); });
    return () => { alive = false; activeRead.current?.abort(); };
  }, [load]);

  React.useEffect(() => {
    if (!selectedRecord) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedRecord(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedRecord]);

  React.useEffect(() => {
    if (!preferenceKey || loading || error) return;
    // An incoming link should not replace preferences unless the user runs a new query here.
    if (!changedFiltersHere.current && (back || readHistoryContext(new URLSearchParams(window.location.search)))) return;
    try { window.sessionStorage.setItem(preferenceKey + ':recent', historyContextHref(appliedFilters, page).split('?')[1]); }
    catch { /* Filtering still works without local storage. */ }
  }, [preferenceKey, appliedFilters, page, loading, error, back]);

  const totalPages = count === null ? null : Math.max(1, Math.ceil(count / PAGE_SIZE));
  const rangeStart = records.length ? page * PAGE_SIZE + 1 : 0;
  const rangeEnd = records.length ? page * PAGE_SIZE + records.length : 0;
  const visibleRange = records.length ? `${rangeStart.toLocaleString('zh-CN')}–${rangeEnd.toLocaleString('zh-CN')}` : '0';

  const activeFilters = React.useMemo(() => {
    const items: Array<{ key: keyof FilterState | 'years'; label: string }> = [];
    if (appliedFilters.company) items.push({ key: 'company', label: `${appliedFilters.exactCompany ? '同名企业' : '企业'} ${appliedFilters.company}` });
    if (appliedFilters.building) items.push({ key: 'building', label: `楼宇 ${appliedFilters.building}` });
    if (appliedFilters.source) items.push({ key: 'source', label: sourceLabel(appliedFilters.source) });
    if (appliedFilters.areaMin || appliedFilters.areaMax) {
      items.push({
        key: 'areaMin',
        label: `${appliedFilters.areaMin || '0'}–${appliedFilters.areaMax || '不限'} ㎡`,
      });
    }
    if (appliedFilters.yearFrom !== DEFAULT_FILTERS.yearFrom || appliedFilters.yearTo !== DEFAULT_FILTERS.yearTo) {
      items.push({ key: 'years', label: `${appliedFilters.yearFrom || '不限'}–${appliedFilters.yearTo || '不限'}` });
    }
    return items;
  }, [appliedFilters]);

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((current) => ({ ...current, [key]: value, ...(key === 'company' ? { exactCompany: false } : key === 'building' ? { buildingId: undefined } : {}) }));
  };

  const submitFilters = () => {
    changedFiltersHere.current = true;
    setAppliedFilters(filters);
    void load(0, filters);
  };

  const clearFilters = () => {
    changedFiltersHere.current = true;
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setAdvancedOpen(false);
    void load(0, DEFAULT_FILTERS);
  };

  const removeAppliedFilter = (key: keyof FilterState | 'years') => {
    changedFiltersHere.current = true;
    const next = { ...appliedFilters };
    if (key === 'years') {
      next.yearFrom = DEFAULT_FILTERS.yearFrom;
      next.yearTo = DEFAULT_FILTERS.yearTo;
    } else if (key === 'areaMin') {
      next.areaMin = '';
      next.areaMax = '';
    } else {
      next[key] = DEFAULT_FILTERS[key] as never;
      if (key === 'building') next.buildingId = undefined;
      if (key === 'company') next.exactCompany = false;
    }
    setFilters(next);
    setAppliedFilters(next);
    void load(0, next);
  };

  const currentContext = (detail?: string) => historyContextHref(appliedFilters, page, detail, back);
  const openBuildingHref = (row: LeaseReadRecord) => {
    if (row.building_match_scope !== 'exact' || !row.building_id) return null;
    return mapBuildingHref(row.building_id, { back: currentContext(row.read_id) });
  };
  const storeView = (slot: number) => {
    if (!preferenceKey) return;
    try {
      window.localStorage.setItem(preferenceKey + ':view:' + slot, historyContextHref(appliedFilters, 0).split('?')[1]);
      setNotice(`已保存到常用视图 ${slot}`);
    } catch { setNotice('此浏览器无法保存常用视图。'); }
  };
  const restoreView = (slot: number) => {
    const saved = preferenceKey && readSavedHistory(window.localStorage, preferenceKey + ':view:' + slot, canReadHistory === true);
    if (!saved) { setNotice(`常用视图 ${slot} 尚未保存。`); return; }
    changedFiltersHere.current = true;
    setNotice(`已载入常用视图 ${slot}`);
    setFilters(saved.filters);
    setAppliedFilters(saved.filters);
    void load(0, saved.filters);
  };

  const effectiveSource: SourceFilter = canReadHistory === true ? appliedFilters.source : 'live';
  const exportScope = [sourceLabel(effectiveSource), ...activeFilters.filter(item => item.key !== 'source' && item.key !== 'years').map(item => item.label),
    `年份 ${appliedFilters.yearFrom || '不限'}–${appliedFilters.yearTo || '不限'}`, count === null ? '数量待确认' : `共 ${count} 笔（所有结果页）`].join(' · ');
  const exportFiltered = async () => {
    if (exportRequest.current || !canReadHistory || count === null || count < 1 || count > EXPORT_LIMIT) return;
    const controller = new AbortController();
    exportRequest.current = controller;
    setExportBusy(true);
    setExportError('');
    try {
      const session = await getSessionFast();
      const token = session?.session.access_token;
      const headers = withImpersonationHeaders({ Authorization: `Bearer ${token}` });
      if (!token || session.role !== 'admin' || headers.has(IMPERSONATION_REQUEST_HEADER)) throw new Error('当前角色无法导出。');
      const records: LeaseReadRecord[] = [];
      const ids = new Set<string>();
      const base = leaseFilterParams(appliedFilters);
      for (let offset = 0; offset < count; offset += EXPORT_PAGE) {
        const params = new URLSearchParams(base);
        params.set('limit', String(EXPORT_PAGE));
        params.set('offset', String(offset));
        const response = await fetch(`/api/lease-transactions/read?${params}`, { headers, signal: controller.signal, cache: 'no-store' });
        const body = await response.json();
        if (!response.ok || body.access?.canReadHistory !== true || body.access?.impersonating ||
          body.count !== count || !Array.isArray(body.records) || body.records.length !== Math.min(EXPORT_PAGE, count - offset)) {
          throw new Error('成交范围或权限已变化，请刷新结果后重新导出。');
        }
        for (const row of body.records as LeaseReadRecord[]) {
          if (!row.read_id || ids.has(row.read_id)) throw new Error('分页结果已变化，请刷新后重试。');
          ids.add(row.read_id);
          records.push(row);
        }
      }
      const { createHistoryWorkbook } = await import('./exportWorkbook');
      const { XLSX, book } = await createHistoryWorkbook(records, exportScope);
      controller.signal.throwIfAborted();
      const filename = '筛选成交.xlsx';
      XLSX.writeFile(book, filename, { compression: true });
      logAction(session.user.email, 'EXPORT_LEASE_TRANSACTIONS', { record_count: records.length, file_name: filename, target_name: filename });
      setExportReview(false);
    } catch (cause) {
      if (!controller.signal.aborted) setExportError(cause instanceof Error ? cause.message : '导出未完成，请重试。');
    } finally {
      exportRequest.current = null;
      if (!controller.signal.aborted) setExportBusy(false);
    }
  };
  const headerStatus = loading
    ? '正在读取'
    : error
      ? '读取异常'
      : `${appliedFilters.yearFrom || '不限'}–${appliedFilters.yearTo || '不限'} · ${sourceLabel(effectiveSource)}`;

  return (
    <div className="min-h-screen bg-[var(--cd-color-workspace)] text-[var(--cd-color-text-primary)]">
      <header className="sticky top-0 z-30 border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]/96 backdrop-blur-sm">
        <div className="mx-auto max-w-[1520px]">
          <AppHeader
            title="成交数据库"
            actions={<BrokerSearchLink />}
            leading={<Database className="h-[17px] w-[17px] text-[var(--cd-color-brand)]" aria-hidden="true" />}
            homeHref="/lease-submission"
            homeLabel="成交填报"
            status={<span className={`text-[11px] ${error ? 'text-[var(--cd-color-danger)]' : 'text-[var(--cd-color-text-muted)]'}`}>{headerStatus}</span>}
          />
        </div>
        {back && <a href={back} className="inline-flex min-h-11 items-center px-4 text-sm text-[var(--cd-color-brand)] underline">返回来源</a>}
      </header>

      <main className="mx-auto max-w-[1520px] px-4 py-4 sm:px-6 sm:py-5">
        {canReadHistory === true && !getImpersonationTargetUserId() && <div className="mb-2 flex flex-wrap items-center gap-3">
          <LeaseExpiryLink />
          <Button type="button" variant="secondary" disabled={loading || Boolean(error) || !count || count > EXPORT_LIMIT}
            onClick={() => { setExportError(''); setExportReview(true); }}>导出筛选结果</Button>
          {count !== null && count > EXPORT_LIMIT && <span className="text-sm">请缩小到 {EXPORT_LIMIT} 笔以内。</span>}
        </div>}
        {exportReview && <ExportReview title="核对成交导出" scope={exportScope}
          contents="Excel 包含成交查询字段、数值原始精度和独立的筛选范围页。列宽按字段设置。"
          confirmLabel="下载 Excel" busy={exportBusy} error={exportError} onClose={() => setExportReview(false)} onConfirm={() => { void exportFiltered(); }} />}

        {preferenceKey && <details className="mb-3 rounded-md border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center">常用视图</summary>
          <div className="flex flex-wrap items-center gap-2 pb-2">
            {[1, 2].map(slot => <div key={slot} className="flex items-center gap-1">
              <Button type="button" variant="secondary" onClick={() => restoreView(slot)}>视图 {slot}</Button>
              <Button type="button" variant="ghost" disabled={loading || Boolean(error)} onClick={() => storeView(slot)}>保存到 {slot}</Button>
            </div>)}
            <span role="status">{notice}</span>
          </div>
        </details>}

        <section className="overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-sm)]">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitFilters();
            }}
            className="border-b border-[var(--cd-color-border)]"
          >
            <div className="flex flex-col gap-2.5 p-3 lg:flex-row lg:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--cd-color-text-muted)]" aria-hidden="true" />
                <input
                  value={filters.company}
                  onChange={(event) => updateFilter('company', event.target.value)}
                  placeholder="公司"
                  aria-label="搜索公司名称"
                  className="h-9 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-white pl-8 pr-3 text-[12px] outline-none transition-colors placeholder:text-[var(--cd-color-text-muted)] focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
                />
              </div>
              <div className="relative min-w-0 flex-1">
                <Building2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--cd-color-text-muted)]" aria-hidden="true" />
                <input
                  value={filters.building}
                  onChange={(event) => updateFilter('building', event.target.value)}
                  placeholder="楼宇"
                  aria-label="搜索楼宇名称"
                  className="h-9 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-white pl-8 pr-3 text-[12px] outline-none transition-colors placeholder:text-[var(--cd-color-text-muted)] focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
                />
              </div>

              {canReadHistory === true ? (
                <div className="flex shrink-0 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] p-0.5">
                  {([
                    ['', '全部'],
                    ['live', '实时'],
                    ['history', '历史'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => updateFilter('source', value)}
                      className={`h-7 rounded-[5px] px-3 text-[11px] font-medium transition-colors ${touchTarget} ${
                        filters.source === value
                          ? 'bg-white text-[var(--cd-color-text-primary)] shadow-[var(--cd-shadow-sm)]'
                          : 'text-[var(--cd-color-text-muted)] hover:text-[var(--cd-color-text-primary)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : canReadHistory === false ? (
                <div className="flex h-8 shrink-0 items-center rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-3 text-[11px] font-medium text-[var(--cd-color-text-secondary)]">
                  实时
                </div>
              ) : null}

              <Button type="button" variant="ghost" size="sm" className={touchTarget} onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen}>
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                筛选
              </Button>
              <Button type="submit" size="sm" disabled={loading} className={`min-w-[68px] ${touchHeight}`}>
                {loading ? '查询中' : '查询'}
              </Button>
            </div>

            {advancedOpen ? (
              <div className="grid gap-3 border-t border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]/60 px-3 py-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium text-[var(--cd-color-text-muted)]">起始年份</span>
                  <input
                    value={filters.yearFrom}
                    onChange={(event) => updateFilter('yearFrom', event.target.value)}
                    inputMode="numeric"
                    placeholder="2015"
                    className="h-8 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-white px-2.5 text-[11px] outline-none focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium text-[var(--cd-color-text-muted)]">结束年份</span>
                  <input
                    value={filters.yearTo}
                    onChange={(event) => updateFilter('yearTo', event.target.value)}
                    inputMode="numeric"
                    placeholder={String(CURRENT_YEAR)}
                    className="h-8 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-white px-2.5 text-[11px] outline-none focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium text-[var(--cd-color-text-muted)]">最小面积（㎡）</span>
                  <input
                    value={filters.areaMin}
                    onChange={(event) => updateFilter('areaMin', event.target.value)}
                    inputMode="decimal"
                    placeholder="不限"
                    className="h-8 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-white px-2.5 text-[11px] outline-none focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium text-[var(--cd-color-text-muted)]">最大面积（㎡）</span>
                  <input
                    value={filters.areaMax}
                    onChange={(event) => updateFilter('areaMax', event.target.value)}
                    inputMode="decimal"
                    placeholder="不限"
                    className="h-8 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-white px-2.5 text-[11px] outline-none focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
                  />
                </label>
              </div>
            ) : null}
          </form>

          {activeFilters.length > 0 ? (
            <div className="flex min-h-10 flex-wrap items-center gap-1.5 border-b border-[var(--cd-color-border)] px-3 py-2">
              {activeFilters.map((item) => (
                <button
                  key={`${item.key}-${item.label}`}
                  type="button"
                  onClick={() => removeAppliedFilter(item.key)}
                  className="inline-flex h-6 items-center gap-1 rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-surface-alt)] px-2 text-[10px] text-[var(--cd-color-text-secondary)] transition-colors hover:text-[var(--cd-color-text-primary)]"
                  title="移除此筛选"
                >
                  {item.label}
                  <X className="h-2.5 w-2.5" aria-hidden="true" />
                </button>
              ))}
              <button
                type="button"
                onClick={clearFilters}
                className="ml-auto inline-flex h-6 items-center gap-1 px-1.5 text-[10px] text-[var(--cd-color-text-muted)] transition-colors hover:text-[var(--cd-color-brand)]"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                清除
              </button>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5 border-b border-[var(--cd-color-border)] px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-baseline gap-2">
              <h2 className="text-[13px] font-semibold text-[var(--cd-color-text-primary)]">成交记录</h2>
              {count !== null ? (
                <span className="text-[11px] tabular-nums text-[var(--cd-color-text-muted)]">{count.toLocaleString('zh-CN')} 条</span>
              ) : !loading && !error && countStatus === 'loading' ? (
                <span className="text-[11px] text-[var(--cd-color-text-muted)]">正在统计总数…</span>
              ) : !loading && !error && countStatus === 'error' ? (
                <Button size="sm" variant="ghost" onClick={() => { if (pendingCount.current) void loadCount(pendingCount.current); }}>重试总数</Button>
              ) : null}
            </div>
            <div className="text-[10px] tabular-nums text-[var(--cd-color-text-muted)]">
              {!loading && !error && (count === null ? `当前 ${visibleRange}` : `${visibleRange} / ${count.toLocaleString('zh-CN')}`)}
            </div>
          </div>

          {loading ? (
            <div className="p-6"><LoadingState label="正在读取成交记录" rows={6} /></div>
          ) : error ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="text-[13px] font-medium text-[var(--cd-color-danger)]">成交数据暂时无法读取</div>
              <div className="max-w-lg text-[12px] leading-5 text-[var(--cd-color-text-secondary)]">{error}</div>
              <Button size="sm" variant="secondary" onClick={() => void load(page, appliedFilters)}>重新加载</Button>
            </div>
          ) : records.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
              <Database className="mb-3 h-7 w-7 text-[var(--cd-color-text-muted)]" aria-hidden="true" />
              <div className="text-[13px] font-medium">没有符合条件的成交记录</div>
              <div className="mt-1 text-[11px] text-[var(--cd-color-text-muted)]">尝试放宽年份、面积或实体名称筛选。</div>
              <Button className="mt-4" size="sm" variant="secondary" onClick={clearFilters}>恢复默认条件</Button>
            </div>
          ) : (
            <div className="min-w-0">
              <table className="block w-full border-collapse text-[12px] md:table md:table-fixed">
                <colgroup className="hidden md:table-column-group">
                  <col className="w-[14%]" /><col className="w-[23%]" /><col className="w-[23%]" />
                  <col className="w-[14%]" /><col className="w-[11%]" /><col className="w-[15%]" />
                </colgroup>
                <thead className="hidden bg-[var(--cd-color-surface-alt)] text-[12px] text-[var(--cd-color-text-muted)] md:table-header-group">
                  <tr>
                    {['成交时间', '公司', '楼宇 / 商圈', '行业', '面积', '租金'].map((label, index) => (
                      <th
                        key={label}
                        className={`border-b border-[var(--cd-color-border)] px-3.5 py-2 text-left font-medium ${index >= 4 ? 'text-right' : ''}`}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="block md:table-row-group">
                  {records.map((row) => (
                    <tr
                      key={row.read_id}
                      tabIndex={0}
                      role="button"
                      onClick={() => setSelectedRecord(row)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedRecord(row);
                        }
                      }}
                      className="grid cursor-pointer grid-cols-2 gap-x-3 gap-y-1 border-b border-[var(--cd-color-border)]/60 px-3.5 py-3 outline-none transition-colors last:border-b-0 hover:bg-[#f8fafc] focus-visible:bg-[var(--cd-color-brand-soft)] md:table-row"
                    >
                      <td className="order-2 min-w-0 text-right align-top md:px-3.5 md:py-3 md:text-left">
                        <div className="font-medium tabular-nums text-[var(--cd-color-text-primary)]">{periodLabel(row)}</div>
                        <div className="mt-0.5 text-[10px] text-[var(--cd-color-text-muted)]">{sourceLabel(row.record_source)}</div>
                      </td>
                      <td className="order-1 min-w-0 align-top md:px-3.5 md:py-3">
                        <div className="[overflow-wrap:anywhere] font-semibold text-[var(--cd-color-text-primary)]">{row.company || '—'}</div>
                        {row.demand_type ? <div className="mt-0.5 truncate text-[10px] text-[var(--cd-color-text-muted)]">{row.demand_type}</div> : null}
                      </td>
                      <td className="order-3 col-span-2 min-w-0 align-top md:px-3.5 md:py-3">
                        <div className="[overflow-wrap:anywhere] text-[var(--cd-color-text-primary)]">{row.new_building || '—'}</div>
                        <BuildingMeta row={row} />
                      </td>
                      <td className="order-6 col-span-2 min-w-0 align-top md:px-3.5 md:py-3">
                        <div className="[overflow-wrap:anywhere] text-[var(--cd-color-text-secondary)]">{row.industry || '—'}</div>
                        {row.sub_industry ? <div className="mt-0.5 truncate text-[10px] text-[var(--cd-color-text-muted)]">{row.sub_industry}</div> : null}
                      </td>
                      <td className="order-4 min-w-0 align-top tabular-nums md:px-3.5 md:py-3 md:text-right">
                        <span className="font-medium text-[var(--cd-color-text-primary)]">{fmtNumber(row.area_sqm, 0)}</span>
                        <span className="ml-1 text-[10px] text-[var(--cd-color-text-muted)]">㎡</span>
                      </td>
                      <td className="order-5 min-w-0 [overflow-wrap:anywhere] text-right align-top tabular-nums md:px-3.5 md:py-3">
                        <div className="font-medium text-[var(--cd-color-text-primary)]"><span className="font-normal text-[var(--cd-color-text-secondary)] md:hidden">租金 </span>{formatLeaseRent(row.face_rent)}</div>
                        {row.effective_rent != null ? <div className="mt-0.5 text-[10px] text-[var(--cd-color-text-muted)]">有效 {formatLeaseRent(row.effective_rent)}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex min-h-12 items-center justify-between border-t border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]/35 px-3.5 py-2">
            <div className="text-[10px] text-[var(--cd-color-text-muted)]">每页 {PAGE_SIZE} 条 · {totalPages === null ? `第 ${page + 1} 页` : `第 ${Math.min(page + 1, totalPages)} / ${totalPages} 页`}</div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={loading || page <= 0}
                onClick={() => void load(page - 1, appliedFilters)}
                aria-label="上一页"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                上一页
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={loading || totalPages === null || page + 1 >= totalPages}
                onClick={() => void load(page + 1, appliedFilters)}
                aria-label="下一页"
              >
                下一页
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </section>
      </main>

      {selectedRecord ? (
        <>
          <button
            type="button"
            aria-label="关闭成交详情"
            onClick={() => setSelectedRecord(null)}
            className="fixed inset-0 z-40 cursor-default bg-slate-950/15"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="成交详情"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col border-l border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-drawer)]"
          >
            <div className="flex h-[var(--cd-header-height)] items-center justify-between border-b border-[var(--cd-color-border)] px-5">
              <div>
                <div className="text-[13px] font-semibold text-[var(--cd-color-text-primary)]">成交详情</div>
                <div className="mt-0.5 text-[10px] text-[var(--cd-color-text-muted)]">{periodLabel(selectedRecord)} · {sourceLabel(selectedRecord.record_source)}</div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                aria-label="关闭"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--cd-radius-md)] text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="border-b border-[var(--cd-color-border)] px-5 py-5">
                <div className="text-[17px] font-semibold tracking-[-0.02em]">{selectedRecord.company || '未标注公司'}</div>
                <div className="mt-1 text-[13px] text-[var(--cd-color-text-secondary)]">{selectedRecord.new_building || '未标注楼宇'}</div>
                <div className={`mt-1 text-[10px] ${selectedRecord.building_match_scope === 'unmapped' ? 'text-[var(--cd-color-warning)]' : 'text-[var(--cd-color-text-muted)]'}`}>
                  {associationLabel(selectedRecord.building_match_scope)}
                  {selectedRecord.building_match_scope === 'project'
                    ? ' · 仅确认到项目，未指定具体塔楼'
                    : selectedRecord.building_match_scope === 'reference'
                      ? ' · 已确认实体，仅用于历史成交关联，不参与当前运营跟踪'
                      : ''}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-4 border-t border-[var(--cd-color-border)]">
                  <DetailItem label="成交面积" value={`${fmtNumber(selectedRecord.area_sqm, 0)} ㎡`} numeric />
                  <DetailItem label="租期" value={selectedRecord.lease_term_months == null ? '—' : `${fmtNumber(selectedRecord.lease_term_months, 0)} 个月`} numeric />
                  <DetailItem label="表面租金" value={formatLeaseRent(selectedRecord.face_rent)} numeric />
                  <DetailItem label="有效租金" value={formatLeaseRent(selectedRecord.effective_rent)} numeric />
                </div>
              </div>

              <div className="px-5 py-5">
                <div className="mb-1 text-[11px] font-semibold text-[var(--cd-color-text-primary)]">市场与需求</div>
                <DetailItem label="商圈 / 行政区" value={[selectedRecord.sub_market, selectedRecord.district].filter(Boolean).join(' · ') || '—'} />
                <DetailItem label="行业 / 子行业" value={[selectedRecord.industry, selectedRecord.sub_industry].filter(Boolean).join(' · ') || '—'} />
                <DetailItem label="需求类型" value={selectedRecord.demand_type || '—'} />
                <DetailItem label="成交时间精度" value={selectedRecord.transaction_time_precision || selectedRecord.transaction_period || '—'} />
                <DetailItem label="代理公司 / 人员" value={[selectedRecord.agency_company, selectedRecord.agency_person].filter(Boolean).join(' · ') || '—'} />
                <DetailItem label="数据质量" value={selectedRecord.quality_status || '—'} />
                <DetailItem label="备注" value={selectedRecord.remarks || '—'} />
              </div>
            </div>

            <div className="flex flex-wrap gap-3 border-t border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-5 py-2 text-sm text-[var(--cd-color-brand)]">
              {selectedRecord.company && <a className="inline-flex min-h-11 items-center underline" href={dealHistoryHref({ company: selectedRecord.company }, currentContext(selectedRecord.read_id))}>查看同名企业成交</a>}
              {openBuildingHref(selectedRecord) && <a className="inline-flex min-h-11 items-center underline" href={openBuildingHref(selectedRecord)!}>打开地图楼宇</a>}
              {selectedRecord.building_match_scope === 'exact' && selectedRecord.building_id && <a className="inline-flex min-h-11 items-center underline" href={dealHistoryHref({ id: selectedRecord.building_id, name: selectedRecord.new_building || '当前楼宇' }, currentContext(selectedRecord.read_id))}>查看楼宇成交</a>}
              {selectedRecord.building_match_scope === 'project' && <span className="self-center">项目级记录，未归到单一楼座</span>}
            </div>
          </aside>
        </>
      ) : null}

      <div className="sr-only" aria-live="polite">
        {loading ? '正在查询成交数据' : error ? '成交数据暂时无法读取' : count === null
          ? (countStatus === 'error' ? '成交记录已加载，总数暂不可用' : '成交记录已加载，正在统计总数')
          : `查询完成，共 ${count} 条记录`}
      </div>
    </div>
  );
}
