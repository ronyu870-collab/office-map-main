'use client';

import * as React from 'react';
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
import { AppHeader, Button, LoadingState } from '@/src/components/ui';

type LeaseReadRecord = {
  read_id: string;
  record_source: 'live' | 'history';
  building_id: string | null;
  building_match_scope: 'exact' | 'project' | 'unmapped';
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

type SourceFilter = '' | 'live' | 'history';

type FilterState = {
  company: string;
  building: string;
  yearFrom: string;
  yearTo: string;
  source: SourceFilter;
  areaMin: string;
  areaMax: string;
};

const CURRENT_YEAR = new Date().getFullYear();
const PAGE_SIZE = 50;
const DEFAULT_FILTERS: FilterState = {
  company: '',
  building: '',
  yearFrom: '2015',
  yearTo: String(CURRENT_YEAR),
  source: '',
  areaMin: '',
  areaMax: '',
};

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
      ) : row.building_match_scope === 'unmapped' ? (
        <span className="shrink-0 text-[var(--cd-color-warning)]">· 未关联</span>
      ) : null}
    </div>
  );
}

export default function LeaseHistoryPage() {
  const [filters, setFilters] = React.useState<FilterState>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = React.useState<FilterState>(DEFAULT_FILTERS);
  const [records, setRecords] = React.useState<LeaseReadRecord[]>([]);
  const [count, setCount] = React.useState(0);
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [selectedRecord, setSelectedRecord] = React.useState<LeaseReadRecord | null>(null);
  const [canReadHistory, setCanReadHistory] = React.useState<boolean | null>(null);

  const load = React.useCallback(async (pageIndex: number, queryFilters: FilterState) => {
    setLoading(true);
    setError(null);
    setSelectedRecord(null);
    try {
      const session = await getSessionFast();
      const token = session?.session?.access_token;
      if (!token) throw new Error('登录状态异常，请重新登录');

      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageIndex * PAGE_SIZE),
      });
      if (queryFilters.company.trim()) params.set('company', queryFilters.company.trim());
      if (queryFilters.building.trim()) params.set('building', queryFilters.building.trim());
      if (queryFilters.yearFrom) params.set('year_from', queryFilters.yearFrom);
      if (queryFilters.yearTo) params.set('year_to', queryFilters.yearTo);
      if (queryFilters.source) params.set('record_source', queryFilters.source);
      if (queryFilters.areaMin) params.set('area_min', queryFilters.areaMin);
      if (queryFilters.areaMax) params.set('area_max', queryFilters.areaMax);

      const response = await fetch(`/api/lease-transactions/read?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 403) setCanReadHistory(false);
        throw new Error(body.error || '查询失败');
      }
      setCanReadHistory(body?.access?.canReadHistory === true);
      setRecords(body.records ?? []);
      setCount(body.count ?? 0);
      setPage(pageIndex);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '查询失败');
      setRecords([]);
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load(0, DEFAULT_FILTERS);
  }, [load]);

  React.useEffect(() => {
    if (!selectedRecord) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedRecord(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedRecord]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const rangeStart = count === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(count, page * PAGE_SIZE + records.length);

  const activeFilters = React.useMemo(() => {
    const items: Array<{ key: keyof FilterState | 'years'; label: string }> = [];
    if (appliedFilters.company) items.push({ key: 'company', label: `公司 ${appliedFilters.company}` });
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
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const submitFilters = () => {
    setAppliedFilters(filters);
    void load(0, filters);
  };

  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setAdvancedOpen(false);
    void load(0, DEFAULT_FILTERS);
  };

  const removeAppliedFilter = (key: keyof FilterState | 'years') => {
    const next = { ...appliedFilters };
    if (key === 'years') {
      next.yearFrom = DEFAULT_FILTERS.yearFrom;
      next.yearTo = DEFAULT_FILTERS.yearTo;
    } else if (key === 'areaMin') {
      next.areaMin = '';
      next.areaMax = '';
    } else {
      next[key] = DEFAULT_FILTERS[key] as never;
    }
    setFilters(next);
    setAppliedFilters(next);
    void load(0, next);
  };

  const focusEntity = (type: 'company' | 'building', value: string | null) => {
    if (!value) return;
    const next: FilterState = {
      ...appliedFilters,
      company: type === 'company' ? value : '',
      building: type === 'building' ? value : '',
    };
    setFilters(next);
    setAppliedFilters(next);
    setSelectedRecord(null);
    void load(0, next);
  };

  const effectiveSource: SourceFilter = canReadHistory === true ? appliedFilters.source : 'live';
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
            leading={<Database className="h-[17px] w-[17px] text-[var(--cd-color-brand)]" aria-hidden="true" />}
            homeHref="/lease-submission"
            homeLabel="成交填报"
            status={<span className={`text-[11px] ${error ? 'text-[var(--cd-color-danger)]' : 'text-[var(--cd-color-text-muted)]'}`}>{headerStatus}</span>}
          />
        </div>
      </header>

      <main className="mx-auto max-w-[1520px] px-4 py-4 sm:px-6 sm:py-5">
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
                      className={`h-7 rounded-[5px] px-3 text-[11px] font-medium transition-colors ${
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

              <Button type="button" variant="ghost" size="sm" onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen}>
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                筛选
              </Button>
              <Button type="submit" size="sm" disabled={loading} className="min-w-[68px]">
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
              <span className="text-[11px] tabular-nums text-[var(--cd-color-text-muted)]">{count.toLocaleString('zh-CN')} 条</span>
            </div>
            <div className="text-[10px] tabular-nums text-[var(--cd-color-text-muted)]">
              {count === 0 ? '0' : `${rangeStart.toLocaleString('zh-CN')}–${rangeEnd.toLocaleString('zh-CN')}`} / {count.toLocaleString('zh-CN')}
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-[12px]">
                <thead className="bg-[var(--cd-color-surface-alt)] text-[10px] text-[var(--cd-color-text-muted)]">
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
                <tbody>
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
                      className="cursor-pointer border-b border-[var(--cd-color-border)]/60 outline-none transition-colors last:border-b-0 hover:bg-[#f8fafc] focus-visible:bg-[var(--cd-color-brand-soft)]"
                    >
                      <td className="w-[116px] whitespace-nowrap px-3.5 py-3 align-top">
                        <div className="font-medium tabular-nums text-[var(--cd-color-text-primary)]">{periodLabel(row)}</div>
                        <div className="mt-0.5 text-[10px] text-[var(--cd-color-text-muted)]">{sourceLabel(row.record_source)}</div>
                      </td>
                      <td className="max-w-[260px] px-3.5 py-3 align-top">
                        <div className="truncate font-medium text-[var(--cd-color-text-primary)]">{row.company || '—'}</div>
                        {row.demand_type ? <div className="mt-0.5 truncate text-[10px] text-[var(--cd-color-text-muted)]">{row.demand_type}</div> : null}
                      </td>
                      <td className="max-w-[300px] px-3.5 py-3 align-top">
                        <div className="truncate text-[var(--cd-color-text-primary)]">{row.new_building || '—'}</div>
                        <BuildingMeta row={row} />
                      </td>
                      <td className="max-w-[220px] px-3.5 py-3 align-top">
                        <div className="truncate text-[var(--cd-color-text-secondary)]">{row.industry || '—'}</div>
                        {row.sub_industry ? <div className="mt-0.5 truncate text-[10px] text-[var(--cd-color-text-muted)]">{row.sub_industry}</div> : null}
                      </td>
                      <td className="w-[120px] whitespace-nowrap px-3.5 py-3 text-right align-top tabular-nums">
                        <span className="font-medium text-[var(--cd-color-text-primary)]">{fmtNumber(row.area_sqm, 0)}</span>
                        <span className="ml-1 text-[10px] text-[var(--cd-color-text-muted)]">㎡</span>
                      </td>
                      <td className="w-[130px] whitespace-nowrap px-3.5 py-3 text-right align-top tabular-nums">
                        <div className="font-medium text-[var(--cd-color-text-primary)]">{fmtNumber(row.face_rent)}</div>
                        {row.effective_rent != null ? <div className="mt-0.5 text-[10px] text-[var(--cd-color-text-muted)]">有效 {fmtNumber(row.effective_rent)}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex min-h-12 items-center justify-between border-t border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]/35 px-3.5 py-2">
            <div className="text-[10px] text-[var(--cd-color-text-muted)]">每页 {PAGE_SIZE} 条 · 第 {Math.min(page + 1, totalPages)} / {totalPages} 页</div>
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
                disabled={loading || page + 1 >= totalPages}
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
                  {selectedRecord.building_match_scope === 'project' ? ' · 仅确认到项目，未指定具体塔楼' : ''}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-4 border-t border-[var(--cd-color-border)]">
                  <DetailItem label="成交面积" value={`${fmtNumber(selectedRecord.area_sqm, 0)} ㎡`} numeric />
                  <DetailItem label="租期" value={selectedRecord.lease_term_months == null ? '—' : `${fmtNumber(selectedRecord.lease_term_months, 0)} 个月`} numeric />
                  <DetailItem label="表面租金" value={fmtNumber(selectedRecord.face_rent)} numeric />
                  <DetailItem label="有效租金" value={fmtNumber(selectedRecord.effective_rent)} numeric />
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

            <div className="grid grid-cols-2 gap-2 border-t border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-5 py-4">
              <Button
                variant="secondary"
                size="sm"
                disabled={!selectedRecord.company}
                onClick={() => focusEntity('company', selectedRecord.company)}
              >
                同公司成交
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!selectedRecord.new_building}
                onClick={() => focusEntity('building', selectedRecord.new_building)}
              >
                同楼宇成交
              </Button>
            </div>
          </aside>
        </>
      ) : null}

      <div className="sr-only" aria-live="polite">
        {loading ? '正在查询成交数据' : `查询完成，共 ${count} 条记录`}
      </div>
    </div>
  );
}
