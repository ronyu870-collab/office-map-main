'use client';

import * as React from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Database, X } from 'lucide-react';

import { getSessionFast } from '@/src/services/Auth';
import { withImpersonationHeaders } from '@/src/services/impersonationHeaders';
import { readBuildingPopupContext } from '@/src/services/map/buildingPopup';

const RELATED_ACTION_ID = 'related-leases';
const PAGE_SIZE = 50;
const CACHE_TTL_MS = 30_000;

const cache = new Map<string, { payload: LeasePayload; cachedAt: number }>();

type BuildingContext = {
  buildingId: string;
  buildingName?: string;
};

type LeaseRow = {
  read_id: string;
  record_source: 'live' | 'history';
  building_match_scope: 'exact' | 'project' | 'reference' | 'unmapped';
  company: string | null;
  industry: string | null;
  sub_industry: string | null;
  demand_type: string | null;
  area_sqm: number | null;
  face_rent: number | null;
  effective_rent: number | null;
  lease_term_months: number | null;
  transaction_year: number | null;
  transaction_quarter: string | null;
  remarks: string | null;
  agency_company: string | null;
  agency_person: string | null;
};

type LeasePayload = {
  count: number;
  records: LeaseRow[];
};

function fmtNumber(value: number, maximumFractionDigits = 1) {
  return value.toLocaleString('zh-CN', { maximumFractionDigits });
}

function periodLabel(row: LeaseRow) {
  if (row.transaction_year == null) return '时间未记录';
  return row.transaction_quarter
    ? `${row.transaction_year} ${row.transaction_quarter}`
    : String(row.transaction_year);
}

function sourceLabel(row: LeaseRow) {
  return row.record_source === 'live' ? '当前成交库' : '历史成交库';
}

function leaseTermLabel(months: number | null) {
  if (months == null || !Number.isFinite(months) || months <= 0) return null;
  return `${fmtNumber(months, 0)}个月`;
}

function summaryIndustry(row: LeaseRow) {
  return row.sub_industry || row.industry || null;
}

function fullIndustry(row: LeaseRow) {
  if (row.industry && row.sub_industry && row.industry !== row.sub_industry) {
    return `${row.industry} / ${row.sub_industry}`;
  }
  return row.sub_industry || row.industry || '未标注';
}

function brokerLabel(row: LeaseRow) {
  return [row.agency_company, row.agency_person].filter(Boolean).join(' · ');
}

function DetailItem({
  label,
  value,
  span = 1,
  subdued = false,
}: {
  label: string;
  value: React.ReactNode;
  span?: 1 | 2;
  subdued?: boolean;
}) {
  return (
    <div className={span === 2 ? 'col-span-2 min-w-0' : 'min-w-0'}>
      <div className="text-[11px] font-medium leading-4 text-[var(--cd-color-text-muted)]">{label}</div>
      <div className={`mt-1 text-[12px] leading-5 ${subdued ? 'text-[var(--cd-color-text-secondary)]' : 'text-[var(--cd-color-text-primary)]'}`}>
        {value}
      </div>
    </div>
  );
}

async function loadBuildingLeases(buildingId: string, page: number): Promise<LeasePayload> {
  const session = await getSessionFast();
  const token = session?.session?.access_token;
  if (!token) throw new Error('登录状态异常，请重新登录');
  const headers = withImpersonationHeaders({ Authorization: `Bearer ${token}` });
  const scope = JSON.stringify([session.user.id, session.role, token, headers.get('X-Colliers-Impersonate-User')]);
  const cacheKey = `${scope}:${buildingId}:${page}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.payload;
  const first = cache.get(`${scope}:${buildingId}:0`);
  const reusedCount = page > 0 && first && Date.now() - first.cachedAt < CACHE_TTL_MS
    ? first.payload.count : null;

  const params = new URLSearchParams({
    building_id: buildingId,
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  });
  if (reusedCount !== null) params.set('include_count', '0');
  const response = await fetch(`/api/lease-transactions/read?${params.toString()}`, {
    headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '关联成交读取失败');

  const payload = {
    count: typeof body.count === 'number' ? body.count : (reusedCount ?? 0),
    records: (body.records ?? []) as LeaseRow[],
  };
  cache.set(cacheKey, { payload, cachedAt: Date.now() });
  return payload;
}

export function MapLeaseTransactionsBridge() {
  const [context, setContext] = React.useState<BuildingContext | null>(null);
  const [page, setPage] = React.useState(0);
  const [payload, setPayload] = React.useState<LeasePayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedReadId, setExpandedReadId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>(`button[data-map-action="${RELATED_ACTION_ID}"]`);
      if (!button) return;

      const nextContext = readBuildingPopupContext(button);
      if (!nextContext) return;
      event.preventDefault();
      event.stopPropagation();

      setPage(0);
      setExpandedReadId(null);
      setContext(nextContext);
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  React.useEffect(() => {
    if (!context) {
      setPayload(null);
      setError(null);
      setExpandedReadId(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setExpandedReadId(null);

    void loadBuildingLeases(context.buildingId, page)
      .then(nextPayload => {
        if (!cancelled) setPayload(nextPayload);
      })
      .catch(loadError => {
        if (!cancelled) {
          setPayload(null);
          setError(loadError instanceof Error ? loadError.message : '关联成交读取失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [context, page]);

  React.useEffect(() => {
    if (!context) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContext(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [context]);

  if (!context) return null;

  const count = payload?.count ?? 0;
  const records = payload?.records ?? [];
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={`${context.buildingName || '当前楼宇'}关联成交`}
      className="fixed bottom-4 right-4 top-[70px] z-[560] flex w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-drawer)]"
    >
      <header className="flex items-center justify-between gap-4 border-b border-[var(--cd-color-border)]/70 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 shrink-0 text-[var(--cd-color-brand)]" aria-hidden="true" />
            <h2 className="text-[14px] font-semibold leading-5 text-[var(--cd-color-text-primary)]">关联成交</h2>
          </div>
          <div className="mt-1 truncate pl-6 text-[12px] leading-5 text-[var(--cd-color-text-secondary)]">
            {context.buildingName || '当前楼宇'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setContext(null)}
          aria-label="关闭关联成交"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline-none focus-visible:bg-[var(--cd-color-surface-alt)]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--cd-color-border)]/60 bg-[var(--cd-color-surface-alt)]/35 px-4">
        <span className="text-[12px] leading-5 text-[var(--cd-color-text-secondary)]">
          <strong className="font-semibold tabular-nums text-[var(--cd-color-text-primary)]">{count.toLocaleString('zh-CN')}</strong> 条成交
        </span>
        <span className="text-[11px] leading-5 text-[var(--cd-color-text-muted)]">最新优先</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-4 py-2" aria-label="正在读取关联成交">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="border-b border-[var(--cd-color-border)]/40 py-3.5 last:border-b-0">
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-slate-200" />
                <div className="mt-2.5 h-3 w-4/5 animate-pulse rounded bg-slate-100" />
                <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center px-8 text-center">
            <div className="text-[13px] font-medium leading-5 text-[var(--cd-color-text-primary)]">关联成交暂时无法读取</div>
            <div className="mt-1.5 text-[11px] leading-5 text-[var(--cd-color-text-muted)]">{error}</div>
            <button
              type="button"
              onClick={() => {
                cache.clear();
                setContext({ ...context });
              }}
              className="mt-4 text-[12px] font-medium leading-5 text-[var(--cd-color-brand)] hover:underline"
            >
              重新加载
            </button>
          </div>
        ) : records.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center px-8 text-center">
            <Database className="h-7 w-7 text-[var(--cd-color-text-muted)]" aria-hidden="true" />
            <div className="mt-3 text-[13px] font-medium leading-5 text-[var(--cd-color-text-primary)]">暂无已关联成交</div>
            <div className="mt-1 text-[11px] leading-5 text-[var(--cd-color-text-muted)]">仅展示已经通过楼宇身份治理确认的成交记录。</div>
          </div>
        ) : (
          <div>
            {records.map(row => {
              const isExpanded = expandedReadId === row.read_id;
              const industry = summaryIndustry(row);
              const leaseTerm = leaseTermLabel(row.lease_term_months);
              const descriptors = [industry, row.demand_type, leaseTerm].filter((value): value is string => Boolean(value));
              const metrics = [
                row.area_sqm == null ? null : `${fmtNumber(row.area_sqm, 0)}㎡`,
                row.face_rent == null ? null : `表面 ¥${fmtNumber(row.face_rent)}/㎡/月`,
                row.effective_rent == null ? null : `净有效 ¥${fmtNumber(row.effective_rent)}/㎡/月`,
              ].filter((value): value is string => Boolean(value));
              const broker = brokerLabel(row);

              return (
                <article key={row.read_id} className="border-b border-[var(--cd-color-border)]/40 last:border-b-0">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedReadId(current => current === row.read_id ? null : row.read_id)}
                    className={`block w-full px-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:bg-[var(--cd-color-surface-alt)]/55 ${isExpanded ? 'bg-[var(--cd-color-surface-alt)]/28' : 'hover:bg-[var(--cd-color-surface-alt)]/35'}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 truncate text-[14px] font-semibold leading-5 text-[var(--cd-color-text-primary)]" title={row.company || '未标注公司'}>
                            {row.company || '未标注公司'}
                          </div>
                          <div className="shrink-0 text-[12px] leading-5 tabular-nums text-[var(--cd-color-text-secondary)]">{periodLabel(row)}</div>
                        </div>

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-medium leading-5 text-[var(--cd-color-text-primary)]">
                          {metrics.length > 0 ? metrics.map(metric => (
                            <span key={metric} className="tabular-nums">{metric}</span>
                          )) : (
                            <span className="font-normal text-[var(--cd-color-text-muted)]">交易条件未完整记录</span>
                          )}
                        </div>

                        {(descriptors.length > 0 || row.building_match_scope === 'project') ? (
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-5 text-[var(--cd-color-text-muted)]">
                            {descriptors.map((descriptor, index) => (
                              <React.Fragment key={`${descriptor}-${index}`}>
                                {index > 0 ? <span aria-hidden="true">·</span> : null}
                                <span>{descriptor}</span>
                              </React.Fragment>
                            ))}
                            {row.building_match_scope === 'project' ? (
                              <>
                                {descriptors.length > 0 ? <span aria-hidden="true">·</span> : null}
                                <span className="rounded-md border border-[var(--cd-color-border)]/80 px-1.5 py-0.5 font-medium leading-4 text-[var(--cd-color-text-secondary)]">项目级</span>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <ChevronDown
                        className={`mt-0.5 h-4 w-4 shrink-0 text-[var(--cd-color-text-muted)] transition-transform duration-200 ease-out ${isExpanded ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                    </div>
                  </button>

                  <div
                    className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                    aria-hidden={!isExpanded}
                  >
                    <div className="overflow-hidden">
                      <div className="border-t border-[var(--cd-color-border)]/35 bg-[var(--cd-color-surface-alt)]/18 px-4 py-3">
                        <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                          <DetailItem label="成交类型" value={row.demand_type || '未标注'} />
                          <DetailItem label="租期" value={leaseTerm || '未记录'} />
                          <DetailItem label="行业" value={fullIndustry(row)} span={2} subdued={!industry} />
                          {(row.face_rent != null || row.effective_rent != null) ? (
                            <DetailItem
                              label="租金"
                              span={2}
                              value={
                                <span className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                                  {row.face_rent != null ? <span>表面 ¥{fmtNumber(row.face_rent)}/㎡/月</span> : null}
                                  {row.effective_rent != null ? <span>净有效 ¥{fmtNumber(row.effective_rent)}/㎡/月</span> : null}
                                </span>
                              }
                            />
                          ) : (
                            <DetailItem label="租金" value="未记录" span={2} subdued />
                          )}
                          {broker ? <DetailItem label="经纪信息" value={broker} span={2} /> : null}
                          {row.remarks ? <DetailItem label="备注" value={<span className="whitespace-pre-wrap break-words">{row.remarks}</span>} span={2} /> : null}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--cd-color-border)]/30 pt-2.5 text-[11px] leading-4 text-[var(--cd-color-text-muted)]">
                          <span>来源：{sourceLabel(row)}</span>
                          {row.building_match_scope === 'project' ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>项目级关联，历史记录无法精确到具体塔楼</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {count > PAGE_SIZE ? (
        <footer className="flex h-11 items-center justify-center gap-2.5 border-t border-[var(--cd-color-border)]/55 px-4">
          <button
            type="button"
            aria-label="上一页关联成交"
            disabled={loading || page <= 0}
            onClick={() => setPage(current => Math.max(0, current - 1))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:bg-[var(--cd-color-surface-alt)]"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="min-w-12 text-center text-[11px] leading-5 tabular-nums text-[var(--cd-color-text-secondary)]">
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            aria-label="下一页关联成交"
            disabled={loading || page + 1 >= totalPages}
            onClick={() => setPage(current => Math.min(totalPages - 1, current + 1))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:bg-[var(--cd-color-surface-alt)]"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </footer>
      ) : null}
    </aside>
  );
}
