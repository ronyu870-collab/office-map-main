'use client';

import { dealHistoryHref } from '@/src/lib/broker/links';
import { useImpersonation } from '@/src/contexts/ImpersonationContext';
import { useAppSession } from '@/src/components/SessionProvider';
import { canAccessModule } from '@/src/utils/accessControl';
import * as React from 'react';
import { currentMapReturnHref } from './workspace/continuity';
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
  backHref?: string;
  scope: string;
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

type ReadFailure = { title: string; description: string };
class RelatedLeaseReadError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function describeReadFailure(error: unknown): ReadFailure {
  const status = error instanceof RelatedLeaseReadError ? error.status : null;
  return {
    title: status === 401 ? '登录状态已失效' : status === 403 ? '没有权限读取关联成交' : '关联成交暂时无法读取',
    description: status === 401 ? '请重新登录后再试。' : status === 403 ? '如需查看，请确认当前账号的权限。' : '请检查网络后重试。',
  };
}

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
      <div className="text-sm font-normal leading-5 text-[var(--cd-color-text-muted)]">{label}</div>
      <div className={`mt-1 break-words text-sm leading-5 ${subdued ? 'text-[var(--cd-color-text-secondary)]' : 'text-[var(--cd-color-text-primary)]'}`}>
        {value}
      </div>
    </div>
  );
}

async function loadBuildingLeases(buildingId: string, page: number, signal: AbortSignal): Promise<LeasePayload> {
  const session = await getSessionFast();
  if (signal.aborted) throw new DOMException('Read cancelled', 'AbortError');
  const token = session?.session?.access_token;
  if (!token) throw new RelatedLeaseReadError('登录状态异常', 401);
  signal.throwIfAborted();
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
    headers, signal,
  });
  const body = await response.json().catch(() => ({}));
  signal.throwIfAborted();
  if (!response.ok) throw new RelatedLeaseReadError('关联成交读取失败', response.status);
  const count = body.count ?? reusedCount;
  if (!Number.isSafeInteger(count) || count < 0 || !Array.isArray(body.records)) throw new Error('关联成交返回格式异常');

  const payload = {
    count: typeof body.count === 'number' ? body.count : (reusedCount ?? 0),
    records: (body.records ?? []) as LeaseRow[],
  };
  if (signal.aborted) throw new DOMException('Read cancelled', 'AbortError');
  cache.set(cacheKey, { payload, cachedAt: Date.now() });
  return payload;
}

export function MapLeaseTransactionsBridge() {
  const { session, status } = useAppSession();
  const { targetUserId, targetRole } = useImpersonation();
  const sessionScope = JSON.stringify([status, session?.user.id, session?.role, session?.sessionId, targetUserId, targetRole]);
  const origin = React.useRef<HTMLElement | null>(null);
  const panel = React.useRef<HTMLElement | null>(null);
  const [context, setContext] = React.useState<BuildingContext | null>(null);
  const [page, setPage] = React.useState(0);
  const [resource, setResource] = React.useState<{ key: string; payload: LeasePayload | null; error: ReadFailure | null } | null>(null);
  const [expandedReadId, setExpandedReadId] = React.useState<string | null>(null);

  const activeContext = context?.scope === sessionScope && status === 'authenticated' ? context : null;
  const readKey = activeContext ? JSON.stringify([activeContext.scope, activeContext.buildingId, page]) : '';
  const payload = resource?.key === readKey ? resource.payload : null;
  const error = resource?.key === readKey ? resource.error : null;
  const loading = Boolean(activeContext) && resource?.key !== readKey;
  const dismiss = React.useCallback(() => {
    setContext(null);
    if (origin.current?.isConnected && !origin.current.closest('[inert], [aria-hidden="true"]')) origin.current.focus({ preventScroll: true });
  }, []);
  React.useEffect(() => {
    cache.clear();
    setContext(null);
    setResource(null);
    return () => { cache.clear(); };
  }, [sessionScope]);
  const activeBuildingId = activeContext?.buildingId;
  React.useLayoutEffect(() => {
    if (activeBuildingId) panel.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [activeBuildingId, sessionScope]);

  React.useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>(`button[data-map-action="${RELATED_ACTION_ID}"]`);
      if (!button || status !== 'authenticated') return;

      const nextContext = readBuildingPopupContext(button);
      if (!nextContext) return;
      event.preventDefault();
      event.stopPropagation();

      origin.current = button;
      setPage(0);
      setExpandedReadId(null);
      setContext({ ...nextContext, scope: sessionScope, backHref: currentMapReturnHref(nextContext.buildingId) });
    };

    const onSection = (event: Event) => {
      const { id, name, section } = (event as CustomEvent).detail;
      if (section !== 'deals' || status !== 'authenticated') return;
      origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPage(0);
      setContext({ buildingId: id, buildingName: name, scope: sessionScope, backHref: currentMapReturnHref(id) });
    };
    document.addEventListener('click', handleClick, true);
    window.addEventListener('broker:building-section', onSection);
    return () => {
      document.removeEventListener('click', handleClick, true);
      window.removeEventListener('broker:building-section', onSection);
    };
  }, [sessionScope, status]);

  React.useEffect(() => {
    if (!activeContext) {
      setResource(null);
      setExpandedReadId(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setResource(null);
    setExpandedReadId(null);
    void loadBuildingLeases(activeContext.buildingId, page, controller.signal)
      .then(nextPayload => {
        if (!cancelled) setResource({ key: readKey, payload: nextPayload, error: null });
      })
      .catch(loadError => {
        if (!cancelled) setResource({ key: readKey, payload: null, error: describeReadFailure(loadError) });
      });
    return () => { cancelled = true; controller.abort(); };
  }, [activeContext, page, readKey]);

  React.useEffect(() => {
    if (!activeContext) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open], [aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activeContext, dismiss]);

  if (!activeContext) return null;

  const count = payload?.count ?? 0;
  const records = payload?.records ?? [];
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <aside
      ref={panel}
      data-map-related-leases
      role="dialog"
      aria-modal="false"
      aria-label={`${activeContext.buildingName || '当前楼宇'}关联成交`}
      className="fixed bottom-4 right-4 top-[70px] z-[560] flex w-[420px] break-words [overflow-wrap:anywhere] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-drawer)]"
    >
      <header className="flex items-center justify-between gap-4 border-b border-[var(--cd-color-border)]/70 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 shrink-0 text-[var(--cd-color-brand)]" aria-hidden="true" />
            <h2 className="text-base font-semibold leading-6 text-[var(--cd-color-text-primary)]">关联成交</h2>
          </div>
          <div className="mt-1 break-words pl-6 text-sm leading-5 text-[var(--cd-color-text-secondary)]">
            {activeContext.buildingName || '当前楼宇'}
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="关闭关联成交"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline-none focus-visible:bg-[var(--cd-color-surface-alt)]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      {payload && <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--cd-color-border)]/60 bg-[var(--cd-color-surface-alt)]/35 px-4">
        <span className="text-sm leading-5 text-[var(--cd-color-text-secondary)]">
          <strong className="font-semibold tabular-nums text-[var(--cd-color-text-primary)]">{count.toLocaleString('zh-CN')}</strong> 条成交
        </span>
        {canAccessModule('lease-submission', session?.role) && <a className="inline-flex min-h-11 items-center text-sm text-[var(--cd-color-brand)] underline" href={dealHistoryHref(
          { id: activeContext.buildingId, name: activeContext.buildingName || '当前楼宇' },
          activeContext.backHref,
        )}>在成交库查看</a>}
      </div>}

      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading}>
        {loading ? (
          <div className="px-4 py-2" role="status" aria-label="正在读取关联成交">
            <p className="py-2 text-sm text-[var(--cd-color-text-secondary)]">正在读取关联成交…</p>
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
            <div className="text-sm font-normal leading-5 text-[var(--cd-color-text-primary)]">{error.title}</div>
            <div className="mt-1.5 text-sm leading-5 text-[var(--cd-color-text-muted)]">{error.description}</div>
            <button
              type="button"
              onClick={() => {
                cache.clear();
                setContext({ ...activeContext });
              }}
              className="mt-4 text-sm font-normal leading-5 text-[var(--cd-color-brand)] hover:underline"
            >
              重新加载
            </button>
          </div>
        ) : records.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center px-8 text-center">
            <Database className="h-7 w-7 text-[var(--cd-color-text-muted)]" aria-hidden="true" />
            <div className="mt-3 text-sm font-normal leading-5 text-[var(--cd-color-text-primary)]">暂无已关联成交</div>
            <div className="mt-1 break-words text-sm leading-5 text-[var(--cd-color-text-muted)]">仅展示已经通过楼宇身份治理确认的成交记录。</div>
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
                        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                          <div className="min-w-0 basis-full break-words text-[14px] font-semibold leading-5 text-[var(--cd-color-text-primary)]" title={row.company || '未标注公司'}>
                            {row.company || '未标注公司'}
                          </div>
                          <div className="shrink-0 text-sm leading-5 tabular-nums text-[var(--cd-color-text-secondary)]">{periodLabel(row)}</div>
                        </div>

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-normal leading-5 text-[var(--cd-color-text-primary)]">
                          {metrics.length > 0 ? metrics.map(metric => (
                            <span key={metric} className="tabular-nums">{metric}</span>
                          )) : (
                            <span className="font-normal text-[var(--cd-color-text-muted)]">交易条件未完整记录</span>
                          )}
                        </div>

                        {(descriptors.length > 0 || row.building_match_scope === 'project') ? (
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-5 text-[var(--cd-color-text-muted)]">
                            {descriptors.map((descriptor, index) => (
                              <React.Fragment key={`${descriptor}-${index}`}>
                                {index > 0 ? <span aria-hidden="true">·</span> : null}
                                <span>{descriptor}</span>
                              </React.Fragment>
                            ))}
                            {row.building_match_scope === 'project' ? (
                              <>
                                {descriptors.length > 0 ? <span aria-hidden="true">·</span> : null}
                                <span className="rounded-md border border-[var(--cd-color-border)]/80 px-1.5 py-0.5 font-normal leading-4 text-[var(--cd-color-text-secondary)]">项目级</span>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <ChevronDown
                        className={`mt-0.5 h-4 w-4 shrink-0 text-[var(--cd-color-text-muted)] transition-transform duration-200 ease-out motion-reduce:transition-none ${isExpanded ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                    </div>
                  </button>

                  <div
                    className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
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

                        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--cd-color-border)]/30 pt-2.5 text-sm leading-5 text-[var(--cd-color-text-muted)]">
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

      {page > 0 || count > PAGE_SIZE ? (
        <footer className="flex h-11 items-center justify-center gap-2.5 border-t border-[var(--cd-color-border)]/55 px-4">
          <button
            type="button"
            aria-label="上一页关联成交"
            disabled={loading || page <= 0}
            onClick={() => setPage(current => Math.max(0, current - 1))}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:bg-[var(--cd-color-surface-alt)]"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="min-w-12 text-center text-sm leading-5 tabular-nums text-[var(--cd-color-text-secondary)]">
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            aria-label="下一页关联成交"
            disabled={loading || page + 1 >= totalPages}
            onClick={() => setPage(current => Math.min(totalPages - 1, current + 1))}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:bg-[var(--cd-color-surface-alt)]"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </footer>
      ) : null}
    </aside>
  );
}
