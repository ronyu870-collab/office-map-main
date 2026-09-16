'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Building2,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Database,
  Layers3,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';

import { getSessionFast } from '@/src/services/Auth';
import { AppHeader, Badge, Button, LoadingState } from '@/src/components/ui';

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

function associationLabel(scope: LeaseReadRecord['building_match_scope']) {
  if (scope === 'exact') return '精确楼宇';
  if (scope === 'project') return '项目级';
  return '待映射';
}

function associationTone(scope: LeaseReadRecord['building_match_scope']) {
  if (scope === 'exact') return 'success' as const;
  if (scope === 'project') return 'brand' as const;
  return 'warning' as const;
}

function sourceLabel(source: SourceFilter | LeaseReadRecord['record_source']) {
  if (source === 'live') return '实时';
  if (source === 'history') return '历史';
  return '全部来源';
}

function periodLabel(row: LeaseReadRecord) {
  const year = row.transaction_year ?? '—';
  const quarter = row.transaction_quarter || '';
  return quarter ? `${year} ${quarter}` : String(year);
}

function MetricCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  detail: string;
}) {
  return (
    <div className="min-w-0 border-r border-[var(--cd-color-border)] px-4 py-3.5 last:border-r-0 sm:px-5">
      <div className="flex items-center gap-2 text-[11px] font-medium text-[var(--cd-color-text-secondary)]">
        <span className="text-[var(--cd-color-brand)]">{icon}</span>
        {label}
      </div>
      <div className="mt-1.5 truncate text-[22px] font-semibold tracking-[-0.02em] text-[var(--cd-color-text-primary)]">{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-[var(--cd-color-text-muted)]">{detail}</div>
    </div>
  );
}

function DetailItem({ label, value, numeric = false }: { label: string; value: React.ReactNode; numeric?: boolean }) {
  return (
    <div className="border-b border-[var(--cd-color-border)]/70 py-3 last:border-b-0">
      <div className="text-[11px] text-[var(--cd-color-text-muted)]">{label}</div>
      <div className={`mt-1 text-[13px] font-medium text-[var(--cd-color-text-primary)] ${numeric ? 'tabular-nums' : ''}`}>{value || '—'}</div>
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
      if (!response.ok) throw new Error(body.error || '查询失败');
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
  const associatedOnPage = records.filter((row) => row.building_match_scope !== 'unmapped').length;
  const associationRate = records.length === 0 ? 0 : Math.round((associatedOnPage / records.length) * 100);
  const liveOnPage = records.filter((row) => row.record_source === 'live').length;
  const historyOnPage = records.length - liveOnPage;

  const activeFilters = React.useMemo(() => {
    const items: Array<{ key: keyof FilterState | 'years'; label: string }> = [];
    if (appliedFilters.company) items.push({ key: 'company', label: `公司：${appliedFilters.company}` });
    if (appliedFilters.building) items.push({ key: 'building', label: `楼宇：${appliedFilters.building}` });
    if (appliedFilters.source) items.push({ key: 'source', label: `来源：${sourceLabel(appliedFilters.source)}` });
    if (appliedFilters.areaMin || appliedFilters.areaMax) {
      items.push({
        key: 'areaMin',
        label: `面积：${appliedFilters.areaMin || '0'}–${appliedFilters.areaMax || '不限'}㎡`,
      });
    }
    if (appliedFilters.yearFrom !== DEFAULT_FILTERS.yearFrom || appliedFilters.yearTo !== DEFAULT_FILTERS.yearTo) {
      items.push({ key: 'years', label: `年份：${appliedFilters.yearFrom || '不限'}–${appliedFilters.yearTo || '不限'}` });
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

  return (
    <div className="min-h-screen bg-[var(--cd-color-workspace)] text-[var(--cd-color-text-primary)]">
      <header className="sticky top-0 z-30 border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]/95 backdrop-blur-sm">
        <div className="mx-auto max-w-[1600px]">
          <AppHeader
            title="租赁成交情报"
            leading={<Database className="h-[18px] w-[18px] text-[var(--cd-color-brand)]" aria-hidden="true" />}
            homeHref="/lease-submission"
            homeLabel="成交填报"
            status={<Badge tone="brand">统一读取层</Badge>}
          />
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6">
        <section className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cd-color-brand)]">Lease intelligence</div>
            <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-[var(--cd-color-text-primary)] sm:text-[30px]">成交数据库</h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--cd-color-text-secondary)]">
              统一检索实时成交与历史成交。项目级记录已确认到项目，但不会把历史成交伪精确到当前某一塔楼。
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-[var(--cd-color-text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--cd-color-success)]" />
            数据读取正常 · 2015 至今
          </div>
        </section>

        <section className="mb-4 overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-sm)]">
          <div className="grid grid-cols-2 md:grid-cols-4">
            <MetricCard
              icon={<Database className="h-3.5 w-3.5" aria-hidden="true" />}
              label="匹配结果"
              value={count.toLocaleString('zh-CN')}
              detail={count === 0 ? '暂无符合条件的记录' : `第 ${rangeStart.toLocaleString('zh-CN')}–${rangeEnd.toLocaleString('zh-CN')} 条`}
            />
            <MetricCard
              icon={<CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />}
              label="时间范围"
              value={`${appliedFilters.yearFrom || '—'}–${appliedFilters.yearTo || '—'}`}
              detail="按成交年份 / 季度读取"
            />
            <MetricCard
              icon={<Layers3 className="h-3.5 w-3.5" aria-hidden="true" />}
              label="本页数据来源"
              value={`${historyOnPage} / ${liveOnPage}`}
              detail="历史 / 实时"
            />
            <MetricCard
              icon={<Building2 className="h-3.5 w-3.5" aria-hidden="true" />}
              label="本页楼宇关联"
              value={`${associationRate}%`}
              detail={`${associatedOnPage} / ${records.length} 条已关联`}
            />
          </div>
        </section>

        <section className="mb-4 overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-sm)]">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitFilters();
            }}
          >
            <div className="flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cd-color-text-muted)]" aria-hidden="true" />
                <input
                  value={filters.company}
                  onChange={(event) => updateFilter('company', event.target.value)}
                  placeholder="搜索公司名称"
                  aria-label="搜索公司名称"
                  className="h-10 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-white pl-9 pr-3 text-[13px] outline-none transition-colors placeholder:text-[var(--cd-color-text-muted)] focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
                />
              </div>
              <div className="relative min-w-0 flex-1">
                <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cd-color-text-muted)]" aria-hidden="true" />
                <input
                  value={filters.building}
                  onChange={(event) => updateFilter('building', event.target.value)}
                  placeholder="搜索楼宇名称"
                  aria-label="搜索楼宇名称"
                  className="h-10 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-white pl-9 pr-3 text-[13px] outline-none transition-colors placeholder:text-[var(--cd-color-text-muted)] focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
                />
              </div>

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
                    className={`h-8 rounded-[5px] px-3 text-[12px] font-medium transition-colors ${
                      filters.source === value
                        ? 'bg-white text-[var(--cd-color-brand)] shadow-[var(--cd-shadow-sm)]'
                        : 'text-[var(--cd-color-text-secondary)] hover:text-[var(--cd-color-text-primary)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <Button type="button" variant="secondary" size="md" onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen}>
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                高级筛选
              </Button>
              <Button type="submit" size="md" disabled={loading}>
                <Search className="h-4 w-4" aria-hidden="true" />
                {loading ? '查询中' : '查询'}
              </Button>
            </div>

            {advancedOpen ? (
              <div className="grid gap-3 border-t border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]/70 p-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium text-[var(--cd-color-text-secondary)]">起始年份</span>
                  <input
                    value={filters.yearFrom}
                    onChange={(event) => updateFilter('yearFrom', event.target.value)}
                    inputMode="numeric"
                    placeholder="2015"
                    className="h-9 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-white px-3 text-[12px] outline-none focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium text-[var(--cd-color-text-secondary)]">结束年份</span>
                  <input
                    value={filters.yearTo}
                    onChange={(event) => updateFilter('yearTo', event.target.value)}
                    inputMode="numeric"
                    placeholder={String(CURRENT_YEAR)}
                    className="h-9 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-white px-3 text-[12px] outline-none focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium text-[var(--cd-color-text-secondary)]">最小面积（㎡）</span>
                  <input
                    value={filters.areaMin}
                    onChange={(event) => updateFilter('areaMin', event.target.value)}
                    inputMode="decimal"
                    placeholder="不限"
                    className="h-9 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-white px-3 text-[12px] outline-none focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium text-[var(--cd-color-text-secondary)]">最大面积（㎡）</span>
                  <input
                    value={filters.areaMax}
                    onChange={(event) => updateFilter('areaMax', event.target.value)}
                    inputMode="decimal"
                    placeholder="不限"
                    className="h-9 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-white px-3 text-[12px] outline-none focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
                  />
                </label>
              </div>
            ) : null}
          </form>

          <div className="flex min-h-11 flex-wrap items-center gap-2 border-t border-[var(--cd-color-border)] px-3 py-2 sm:px-4">
            <span className="mr-1 text-[11px] font-medium text-[var(--cd-color-text-muted)]">当前条件</span>
            {activeFilters.length > 0 ? activeFilters.map((item) => (
              <button
                key={`${item.key}-${item.label}`}
                type="button"
                onClick={() => removeAppliedFilter(item.key)}
                className="inline-flex h-7 items-center gap-1.5 rounded-[var(--cd-radius-sm)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-2.5 text-[11px] font-medium text-[var(--cd-color-text-secondary)] transition-colors hover:border-[var(--cd-color-border-strong)] hover:text-[var(--cd-color-text-primary)]"
                title="移除此筛选"
              >
                {item.label}
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )) : (
              <span className="text-[11px] text-[var(--cd-color-text-muted)]">默认范围 · 2015–{CURRENT_YEAR} · 全部来源</span>
            )}
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto inline-flex h-7 items-center gap-1.5 px-2 text-[11px] font-medium text-[var(--cd-color-text-secondary)] transition-colors hover:text-[var(--cd-color-brand)]"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              重置
            </button>
          </div>
        </section>

        <section className="overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-sm)]">
          <div className="flex flex-col gap-2 border-b border-[var(--cd-color-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[13px] font-semibold text-[var(--cd-color-text-primary)]">成交记录</div>
              <div className="mt-0.5 text-[11px] text-[var(--cd-color-text-muted)]">点击任意一行查看完整成交信息与楼宇关联说明</div>
            </div>
            <div className="text-[11px] tabular-nums text-[var(--cd-color-text-secondary)]">
              {count === 0 ? '0 条' : `${rangeStart.toLocaleString('zh-CN')}–${rangeEnd.toLocaleString('zh-CN')} / ${count.toLocaleString('zh-CN')} 条`}
            </div>
          </div>

          {loading ? (
            <div className="p-6"><LoadingState label="正在读取成交数据库" rows={6} /></div>
          ) : error ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="text-[13px] font-medium text-[var(--cd-color-danger)]">成交数据暂时无法读取</div>
              <div className="max-w-lg text-[12px] leading-5 text-[var(--cd-color-text-secondary)]">{error}</div>
              <Button size="sm" variant="secondary" onClick={() => void load(page, appliedFilters)}>重新加载</Button>
            </div>
          ) : records.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
              <Database className="mb-3 h-8 w-8 text-[var(--cd-color-text-muted)]" aria-hidden="true" />
              <div className="text-[13px] font-semibold">没有符合条件的成交记录</div>
              <div className="mt-1 text-[12px] text-[var(--cd-color-text-secondary)]">尝试放宽年份、面积或实体名称筛选。</div>
              <Button className="mt-4" size="sm" variant="secondary" onClick={clearFilters}>恢复默认条件</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] border-collapse text-[12px]">
                <thead className="bg-[var(--cd-color-surface-alt)] text-[10px] uppercase tracking-[0.04em] text-[var(--cd-color-text-muted)]">
                  <tr>
                    {['成交期', '公司', '楼宇', '商圈', '行业 / 需求', '面积', '租金', '来源', '楼宇关联'].map((label) => (
                      <th key={label} className="border-b border-[var(--cd-color-border)] px-3.5 py-2.5 text-left font-semibold">{label}</th>
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
                      className="group cursor-pointer border-b border-[var(--cd-color-border)]/65 outline-none transition-colors last:border-b-0 hover:bg-[#f7f9fc] focus-visible:bg-[var(--cd-color-brand-soft)]"
                    >
                      <td className="whitespace-nowrap px-3.5 py-3 align-top font-medium tabular-nums text-[var(--cd-color-text-primary)]">{periodLabel(row)}</td>
                      <td className="max-w-[220px] px-3.5 py-3 align-top">
                        <div className="truncate font-semibold text-[var(--cd-color-text-primary)]">{row.company || '—'}</div>
                        <div className="mt-0.5 truncate text-[10px] text-[var(--cd-color-text-muted)]">{row.sub_industry || row.industry || '行业未标注'}</div>
                      </td>
                      <td className="max-w-[220px] px-3.5 py-3 align-top">
                        <div className="truncate font-medium text-[var(--cd-color-text-primary)]">{row.new_building || '—'}</div>
                        <div className="mt-0.5 truncate text-[10px] text-[var(--cd-color-text-muted)]">{row.district || '行政区未标注'}</div>
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-3 align-top text-[var(--cd-color-text-secondary)]">{row.sub_market || '—'}</td>
                      <td className="max-w-[160px] px-3.5 py-3 align-top">
                        <div className="truncate text-[var(--cd-color-text-secondary)]">{row.industry || '—'}</div>
                        <div className="mt-0.5 truncate text-[10px] text-[var(--cd-color-text-muted)]">{row.demand_type || '需求未标注'}</div>
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-3 text-right align-top font-semibold tabular-nums text-[var(--cd-color-text-primary)]">{fmtNumber(row.area_sqm, 0)}<span className="ml-1 text-[10px] font-normal text-[var(--cd-color-text-muted)]">㎡</span></td>
                      <td className="whitespace-nowrap px-3.5 py-3 text-right align-top tabular-nums">
                        <div className="font-medium text-[var(--cd-color-text-primary)]">{fmtNumber(row.face_rent)}</div>
                        <div className="mt-0.5 text-[10px] text-[var(--cd-color-text-muted)]">有效 {fmtNumber(row.effective_rent)}</div>
                      </td>
                      <td className="px-3.5 py-3 align-top">
                        <Badge tone={row.record_source === 'live' ? 'success' : 'neutral'}>{sourceLabel(row.record_source)}</Badge>
                      </td>
                      <td className="px-3.5 py-3 align-top">
                        <Badge tone={associationTone(row.building_match_scope)}>{associationLabel(row.building_match_scope)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex min-h-14 flex-col gap-2 border-t border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]/45 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[11px] text-[var(--cd-color-text-muted)]">每页 {PAGE_SIZE} 条 · 第 {Math.min(page + 1, totalPages)} / {totalPages} 页</div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={loading || page <= 0}
                onClick={() => void load(page - 1, appliedFilters)}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                上一页
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={loading || page + 1 >= totalPages}
                onClick={() => void load(page + 1, appliedFilters)}
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
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col border-l border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-drawer)]"
          >
            <div className="flex h-[var(--cd-header-height)] items-center justify-between border-b border-[var(--cd-color-border)] px-5">
              <div>
                <div className="text-[12px] font-semibold text-[var(--cd-color-text-primary)]">成交详情</div>
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
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate text-[18px] font-semibold tracking-[-0.02em]">{selectedRecord.company || '未标注公司'}</div>
                    <div className="mt-1 truncate text-[13px] text-[var(--cd-color-text-secondary)]">{selectedRecord.new_building || '未标注楼宇'}</div>
                  </div>
                  <Badge tone={associationTone(selectedRecord.building_match_scope)}>{associationLabel(selectedRecord.building_match_scope)}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-4 border-t border-[var(--cd-color-border)]">
                  <DetailItem label="成交面积" value={`${fmtNumber(selectedRecord.area_sqm, 0)} ㎡`} numeric />
                  <DetailItem label="租期" value={selectedRecord.lease_term_months == null ? '—' : `${fmtNumber(selectedRecord.lease_term_months, 0)} 个月`} numeric />
                  <DetailItem label="表面租金" value={fmtNumber(selectedRecord.face_rent)} numeric />
                  <DetailItem label="有效租金" value={fmtNumber(selectedRecord.effective_rent)} numeric />
                </div>
              </div>

              <div className="px-5 py-5">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--cd-color-text-muted)]">市场与需求</div>
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
                查看同公司
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!selectedRecord.new_building}
                onClick={() => focusEntity('building', selectedRecord.new_building)}
              >
                查看同楼宇
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
