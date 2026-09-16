'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, Database, X } from 'lucide-react';

import { getSessionFast } from '@/src/services/Auth';
import { ACTION_MODULES, type ActionModule } from '@/src/services/MapController';

const NEARBY_COMPARE_HANDLER = '__colliers_analyzeCompetitors';
const RELATED_ACTION_ID = 'related-leases';
const RELATED_ACTION_LABEL = '关联成交';
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
  building_match_scope: 'exact' | 'project' | 'unmapped';
  company: string | null;
  industry: string | null;
  sub_industry: string | null;
  demand_type: string | null;
  area_sqm: number | null;
  face_rent: number | null;
  effective_rent: number | null;
  transaction_year: number | null;
  transaction_quarter: string | null;
};

type LeasePayload = {
  count: number;
  records: LeaseRow[];
};

function getInfoWindow(element: Element): HTMLElement | null {
  return (element.closest('.amap-info-content') || element.closest('.amap-info-outer')) as HTMLElement | null;
}

function readBuildingContext(infoWindow: Element): BuildingContext | null {
  const explicitId = infoWindow.getAttribute('data-building-id')?.trim();
  const explicitName = infoWindow.getAttribute('data-building-name')?.trim();
  if (explicitId) return { buildingId: explicitId, buildingName: explicitName || undefined };

  const nearby = infoWindow.querySelector<HTMLButtonElement>(`button[onclick*="${NEARBY_COMPARE_HANDLER}"]`);
  const handler = nearby?.getAttribute('onclick') || '';
  const buildingId = handler.match(/__colliers_analyzeCompetitors\('([^']+)'/)?.[1]?.trim();
  if (!buildingId) return null;

  const buildingName = Array.from(infoWindow.querySelectorAll<HTMLElement>('[title]'))
    .map(element => element.getAttribute('title')?.trim() || '')
    .find(value => value && !['编辑数据', '删除', '收起筛选面板'].includes(value));

  return { buildingId, buildingName: buildingName || undefined };
}

function decorateInfoWindow(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('.amap-info-content, .amap-info-outer').forEach(infoWindow => {
    const context = readBuildingContext(infoWindow);
    if (!context) return;

    infoWindow.setAttribute('data-building-id', context.buildingId);
    if (context.buildingName) infoWindow.setAttribute('data-building-name', context.buildingName);

    let button = Array.from(infoWindow.querySelectorAll<HTMLButtonElement>('button'))
      .find(item => item.dataset.mapAction === RELATED_ACTION_ID || item.textContent?.trim() === RELATED_ACTION_LABEL);

    if (!button) {
      const reference = Array.from(infoWindow.querySelectorAll<HTMLButtonElement>('button'))
        .find(item => item.getAttribute('onclick')?.includes(NEARBY_COMPARE_HANDLER));
      const container = reference?.parentElement;
      if (!reference || !container) return;

      button = reference.cloneNode(true) as HTMLButtonElement;
      const placeholder = Array.from(container.children)
        .find(child => child.textContent?.trim() === '最新销控');
      if (placeholder) placeholder.replaceWith(button);
      else container.appendChild(button);
    }

    button.removeAttribute('onclick');
    button.dataset.mapAction = RELATED_ACTION_ID;
    button.type = 'button';
    button.textContent = RELATED_ACTION_LABEL;
    button.setAttribute('aria-label', context.buildingName ? `查看${context.buildingName}关联成交` : RELATED_ACTION_LABEL);
  });
}

function fmtNumber(value: number | null, maximumFractionDigits = 1) {
  return value == null
    ? '—'
    : value.toLocaleString('zh-CN', { maximumFractionDigits });
}

function periodLabel(row: LeaseRow) {
  const year = row.transaction_year ?? '—';
  return row.transaction_quarter ? `${year} ${row.transaction_quarter}` : String(year);
}

async function loadBuildingLeases(buildingId: string, page: number): Promise<LeasePayload> {
  const cacheKey = `${buildingId}:${page}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.payload;

  const session = await getSessionFast();
  const token = session?.session?.access_token;
  if (!token) throw new Error('登录状态异常，请重新登录');

  const params = new URLSearchParams({
    building_id: buildingId,
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  });
  const response = await fetch(`/api/lease-transactions/read?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '关联成交读取失败');

  const payload = {
    count: Number(body.count ?? 0),
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

  React.useEffect(() => {
    const existingIndex = ACTION_MODULES.findIndex(module => module.id === RELATED_ACTION_ID);
    let replaced: { index: number; module: ActionModule } | null = null;
    let appended = false;

    if (existingIndex < 0) {
      const latestSalesIndex = ACTION_MODULES.findIndex(module => module.id === 'latest-sales');
      const relatedModule: ActionModule = {
        id: RELATED_ACTION_ID,
        label: RELATED_ACTION_LABEL,
        icon: '📋',
        enabled: true,
      };

      if (latestSalesIndex >= 0) {
        replaced = { index: latestSalesIndex, module: { ...ACTION_MODULES[latestSalesIndex] } };
        ACTION_MODULES.splice(latestSalesIndex, 1, relatedModule);
      } else {
        ACTION_MODULES.push(relatedModule);
        appended = true;
      }
    }

    const decorateAll = () => decorateInfoWindow(document);
    decorateAll();

    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('.amap-info-content, .amap-info-outer') || node.querySelector('.amap-info-content, .amap-info-outer')) {
            decorateInfoWindow(node.parentNode || document);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>(`button[data-map-action="${RELATED_ACTION_ID}"]`);
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();
      const infoWindow = getInfoWindow(button);
      if (!infoWindow) return;
      const nextContext = readBuildingContext(infoWindow);
      if (!nextContext) return;

      setPage(0);
      setContext(nextContext);
    };

    document.addEventListener('click', handleClick, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('click', handleClick, true);

      const relatedIndex = ACTION_MODULES.findIndex(module => module.id === RELATED_ACTION_ID);
      if (relatedIndex >= 0 && replaced) ACTION_MODULES.splice(relatedIndex, 1, replaced.module);
      else if (relatedIndex >= 0 && appended) ACTION_MODULES.splice(relatedIndex, 1);
    };
  }, []);

  React.useEffect(() => {
    if (!context) {
      setPayload(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

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
  const rangeStart = count === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(count, page * PAGE_SIZE + records.length);
  const hasProjectRows = records.some(row => row.building_match_scope === 'project');

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={`${context.buildingName || '当前楼宇'}关联成交`}
      className="fixed bottom-4 right-4 top-[70px] z-[560] flex w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-lg border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-drawer)]"
    >
      <header className="flex items-center justify-between gap-4 border-b border-[var(--cd-color-border)] px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 shrink-0 text-[var(--cd-color-brand)]" aria-hidden="true" />
            <h2 className="text-[14px] font-semibold text-[var(--cd-color-text-primary)]">关联成交</h2>
          </div>
          <div className="mt-1 truncate pl-6 text-[11px] text-[var(--cd-color-text-muted)]">
            {context.buildingName || '当前楼宇'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setContext(null)}
          aria-label="关闭关联成交"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--cd-color-text-secondary)] transition hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-focus)]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]/55 px-4 text-[11px]">
        <span className="text-[var(--cd-color-text-secondary)]">
          <strong className="font-semibold tabular-nums text-[var(--cd-color-text-primary)]">{count.toLocaleString('zh-CN')}</strong> 条关联成交
        </span>
        <span className="tabular-nums text-[var(--cd-color-text-muted)]">
          {count > 0 ? `${rangeStart}–${rangeEnd}` : '—'}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-0 px-4 py-2" aria-label="正在读取关联成交">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="border-b border-[var(--cd-color-border)]/70 py-3.5 last:border-b-0">
                <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
                <div className="mt-2 h-2.5 w-4/5 animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center px-8 text-center">
            <div className="text-[13px] font-medium text-[var(--cd-color-text-primary)]">关联成交暂时无法读取</div>
            <div className="mt-1.5 text-[11px] leading-5 text-[var(--cd-color-text-muted)]">{error}</div>
            <button
              type="button"
              onClick={() => {
                cache.delete(`${context.buildingId}:${page}`);
                setContext({ ...context });
              }}
              className="mt-4 text-[11px] font-medium text-[var(--cd-color-brand)] hover:underline"
            >
              重新加载
            </button>
          </div>
        ) : records.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center px-8 text-center">
            <Database className="h-7 w-7 text-[var(--cd-color-text-muted)]" aria-hidden="true" />
            <div className="mt-3 text-[13px] font-medium text-[var(--cd-color-text-primary)]">暂无已关联成交</div>
            <div className="mt-1 text-[11px] leading-5 text-[var(--cd-color-text-muted)]">仅展示已经通过楼宇身份治理确认的 exact / project 成交。</div>
          </div>
        ) : (
          <div>
            {records.map(row => (
              <div key={row.read_id} className="border-b border-[var(--cd-color-border)]/70 px-4 py-3.5 last:border-b-0 hover:bg-[var(--cd-color-surface-alt)]/60">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 truncate text-[13px] font-semibold text-[var(--cd-color-text-primary)]" title={row.company || '未标注公司'}>
                    {row.company || '未标注公司'}
                  </div>
                  <div className="shrink-0 text-[11px] tabular-nums text-[var(--cd-color-text-secondary)]">{periodLabel(row)}</div>
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[11px] text-[var(--cd-color-text-secondary)]">
                  <span className="min-w-0 flex-1 truncate">{row.sub_industry || row.industry || row.demand_type || '行业未标注'}</span>
                  <span className="shrink-0 tabular-nums">{fmtNumber(row.area_sqm, 0)}㎡</span>
                  <span className="w-[72px] shrink-0 text-right tabular-nums">租金 {fmtNumber(row.face_rent)}</span>
                </div>
                <div className="mt-1.5 text-[10px] text-[var(--cd-color-text-muted)]">
                  {row.record_source === 'live' ? '实时成交' : '历史成交'}
                  {row.building_match_scope === 'project' ? ' · 项目级关联' : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {hasProjectRows ? (
        <div className="border-t border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]/45 px-4 py-2 text-[10px] leading-4 text-[var(--cd-color-text-muted)]">
          项目级关联表示成交已确认属于该项目，但历史数据无法精确到当前具体塔楼。
        </div>
      ) : null}

      {count > PAGE_SIZE ? (
        <footer className="flex h-12 items-center justify-between border-t border-[var(--cd-color-border)] px-4">
          <span className="text-[10px] tabular-nums text-[var(--cd-color-text-muted)]">第 {page + 1} / {totalPages} 页</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="上一页关联成交"
              disabled={loading || page <= 0}
              onClick={() => setPage(current => Math.max(0, current - 1))}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--cd-color-border)] text-[var(--cd-color-text-secondary)] disabled:cursor-not-allowed disabled:opacity-35 hover:not-disabled:bg-[var(--cd-color-surface-alt)]"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="下一页关联成交"
              disabled={loading || page + 1 >= totalPages}
              onClick={() => setPage(current => Math.min(totalPages - 1, current + 1))}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--cd-color-border)] text-[var(--cd-color-text-secondary)] disabled:cursor-not-allowed disabled:opacity-35 hover:not-disabled:bg-[var(--cd-color-surface-alt)]"
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </footer>
      ) : null}
    </aside>
  );
}
