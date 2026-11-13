'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import { Dialog } from '@/src/components/ui/Dialog';
import { getSessionFast } from '@/src/services/Auth';
import { withImpersonationHeaders } from '@/src/services/impersonationHeaders';
import type { LeaseTransaction } from '@/src/types/lease-transaction';
import { formatLeaseRent } from '@/src/utils/formatLeaseRent';

const PAGE_SIZE = 30;

type BuildingScope = 'tower' | 'project';
type Deal = {
  read_id: string;
  building_id: string | null;
  building_match_scope: 'exact' | 'reference' | 'project' | 'unmapped';
  company: string | null;
  demand_type: string | null;
  new_building: string | null;
  transaction_year: number | null;
  transaction_quarter: string | null;
  area_sqm: number | null;
  effective_rent: number | null;
};

type LeaseResponse = {
  records: Deal[];
  count: number | null;
  access: { canReadHistory: boolean };
};

type DealList = { records: Deal[]; count: number };
type Reader = (params: Record<string, string>) => Promise<LeaseResponse>;
type Result =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'unlinked'; message: string }
  | { status: 'ready'; tower: DealList; project: DealList; canReadHistory: boolean; loadPage: (scope: BuildingScope, offset: number) => Promise<LeaseResponse> };

async function createReader(signal: AbortSignal): Promise<Reader> {
  const session = await getSessionFast();
  const token = session?.session?.access_token;
  if (!token) throw new Error('登录已失效，请重新登录后查看');
  const headers = withImpersonationHeaders({ Authorization: `Bearer ${token}` });
  return async (params) => {
    const response = await fetch(`/api/lease-transactions/read?${new URLSearchParams(params)}`, { headers, signal });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) throw new Error(body?.error || '暂时无法读取楼宇成交');
    return body;
  };
}

function dealPeriod(deal: Deal) {
  return [deal.transaction_year, deal.transaction_quarter].filter(Boolean).join(' ') || '时间未填';
}

function dealArea(area: number | null) {
  return area?.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) ?? '—';
}

const actionClass = 'min-h-11 rounded-sm text-sm text-[var(--cd-color-brand)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--cd-color-brand)]';
const ruleClass = 'border-b border-[var(--cd-color-border)]';

function DealRows({ records }: { records: Deal[] }) {
  return (
    <table className="w-full table-fixed text-sm" aria-label="本楼成交记录，按成交时间从新到旧">
      <colgroup><col /><col className="w-[64px] sm:w-[90px]" /><col className="w-[86px] sm:w-[154px]" /></colgroup>
      <thead className="text-[var(--cd-color-text-secondary)]">
        <tr className={ruleClass}>
          <th scope="col" className="py-3 pr-2 text-left font-normal">成交企业</th>
          <th scope="col" className="py-3 text-right font-normal">面积<span className="block whitespace-nowrap sm:inline">（㎡）</span></th>
          <th scope="col" className="py-3 text-right font-normal">有效租金<span className="block whitespace-nowrap sm:inline">（元/㎡/月）</span></th>
        </tr>
      </thead>
      <tbody>
        {records.map((deal) => (
          <tr key={deal.read_id} className={`${ruleClass} last:border-b-0`}>
            <th scope="row" className="py-3.5 pr-2 text-left align-top font-normal [overflow-wrap:anywhere]">
              <span className="font-semibold">{deal.company?.trim() || '未填写企业'}</span>
              <span className="mt-0.5 block text-[var(--cd-color-text-secondary)]">
                {[dealPeriod(deal), deal.demand_type?.trim()].filter(Boolean).join(' · ')}
              </span>
            </th>
            <td className="py-3.5 text-right align-top tabular-nums">{dealArea(deal.area_sqm)}</td>
            <td className="py-3.5 text-right align-top tabular-nums">{formatLeaseRent(deal.effective_rent)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PaginatedDeals({ initial, scope, loadPage }: {
  initial: DealList;
  scope: BuildingScope;
  loadPage: (scope: BuildingScope, offset: number) => Promise<LeaseResponse>;
}) {
  const [records, setRecords] = React.useState(initial.records);
  const [offset, setOffset] = React.useState(initial.records.length);
  const [finished, setFinished] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);
  const hasMore = !finished && offset < initial.count;
  const initiallyPaginated = initial.records.length < initial.count;
  async function showMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(false);
    try {
      const next = await loadPage(scope, offset);
      setRecords((current) => {
        const seen = new Set(current.map((deal) => deal.read_id));
        return [...current, ...next.records.filter((deal) => !seen.has(deal.read_id))];
      });
      setOffset(offset + next.records.length);
      setFinished(next.records.length < PAGE_SIZE);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      {scope === 'tower' ? <DealRows records={records} /> : (
        <ul className="text-sm">
          {records.map((deal) => (
            <li key={deal.read_id} className={`${ruleClass} py-3.5 [overflow-wrap:anywhere]`}>
              <div className="font-semibold">{deal.company?.trim() || '未填写企业'}</div>
              <div className="mt-0.5 text-[var(--cd-color-text-secondary)]">
                {[dealPeriod(deal), deal.new_building?.trim(), deal.area_sqm == null ? null : `${dealArea(deal.area_sqm)} ㎡`].filter(Boolean).join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      )}
      {initiallyPaginated && (
        <div className={`${ruleClass} flex flex-wrap items-center justify-between gap-x-3 text-sm`}>
          <p aria-live="polite" className="text-[var(--cd-color-text-secondary)]">{error ? '加载失败，请重试' : `已显示 ${records.length} / ${initial.count} 条`}</p>
          <button type="button" className={actionClass} aria-disabled={!hasMore || loading} onClick={() => { void showMore(); }}>
            {loading ? '正在加载…' : !hasMore ? '没有更多记录' : error ? '重试加载更多' : '加载更多'}
          </button>
        </div>
      )}
    </>
  );
}

export function BuildingDealsDrawer({ record, trigger, onClose }: {
  record: LeaseTransaction;
  trigger: HTMLButtonElement;
  onClose: () => void;
}) {
  const [attempt, setAttempt] = React.useState(0);
  const [result, setResult] = React.useState<Result>({ status: 'loading' });
  const [showProject, setShowProject] = React.useState(false);
  const projectId = React.useId();
  const recordId = record.id;

  React.useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      if (!recordId) {
        setResult({ status: 'unlinked', message: '这条成交没有可用于查询的记录编号。' });
        return;
      }
      try {
        const read = await createReader(signal);
        const lookup = await read({ live_record_id: recordId, include_count: '0' });
        if (signal.aborted) return;
        const match = lookup.records[0];
        if (!match?.building_id || (match.building_match_scope !== 'exact' && match.building_match_scope !== 'reference')) {
          const message = !match ? '未找到这条成交的楼宇关联。'
            : match.building_match_scope === 'project' ? '这条成交只关联到项目，尚未确认具体楼座。'
              : '这条成交尚未关联到可查询的楼宇。';
          setResult({ status: 'unlinked', message });
          return;
        }
        const buildingId = match.building_id;
        const loadPage = (scope: BuildingScope, offset: number) => read({
          building_id: buildingId,
          building_scope: scope,
          limit: String(PAGE_SIZE),
          offset: String(offset),
          include_count: offset === 0 ? '1' : '0',
        });
        const [tower, project] = await Promise.all([loadPage('tower', 0), loadPage('project', 0)]);
        if (!signal.aborted) setResult({
          status: 'ready',
          tower: { records: tower.records, count: tower.count ?? tower.records.length },
          project: { records: project.records, count: project.count ?? project.records.length },
          canReadHistory: tower.access.canReadHistory,
          loadPage,
        });
      } catch (error) {
        if (!signal.aborted) setResult({
          status: 'error',
          message: error instanceof Error && error.message ? error.message : '暂时无法读取楼宇成交',
        });
      }
    }
    void load();
    return () => controller.abort();
  }, [recordId, attempt]);

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={record.new_building?.trim() || '楼宇成交'}
      description={result.status === 'ready' ? `本楼成交 ${result.tower.count} 条 · ${result.canReadHistory ? '当前及历史' : '当前成交'}` : undefined}
      closeLabel="关闭楼宇成交"
      returnFocusTo={trigger}
      presentation="drawer"
    >
      {result.status === 'loading' && <p role="status" className="py-6 text-sm text-[var(--cd-color-text-secondary)]">正在加载楼宇成交…</p>}
      {result.status === 'unlinked' && <p className="py-6 text-sm text-[var(--cd-color-text-secondary)]">{result.message}</p>}
      {result.status === 'error' && (
        <div className="py-4">
          <p role="alert" className="text-sm text-[var(--cd-color-text-secondary)]">{result.message}</p>
          <button type="button" className={actionClass} onClick={(event) => {
            event.currentTarget.closest('[role="dialog"]')?.querySelector('button')?.focus();
            setResult({ status: 'loading' });
            setAttempt((n) => n + 1);
          }}>重新加载</button>
        </div>
      )}
      {result.status === 'ready' && (
        <>
          <span role="status" className="sr-only">{`本楼成交 ${result.tower.count} 条`}</span>
          {result.tower.records.length ? <PaginatedDeals initial={result.tower} scope="tower" loadPage={result.loadPage} />
            : <p className="py-6 text-sm text-[var(--cd-color-text-secondary)]">当前可见范围内暂无本楼成交。</p>}
          {result.project.count > 0 && (
            <section className="mt-2 border-t border-[var(--cd-color-border)]" aria-label="项目级成交">
              <button
                type="button"
                aria-expanded={showProject}
                aria-controls={projectId}
                onClick={() => setShowProject(!showProject)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm py-3 text-left text-sm hover:bg-[var(--cd-color-surface-alt)] focus-visible:outline-2 focus-visible:outline-[var(--cd-color-brand)]"
              >
                <span><strong className="font-semibold">项目级成交</strong><span className="text-[var(--cd-color-text-secondary)]"> · {result.project.count} 条 · 未确认楼座</span></span>
                <ChevronDown aria-hidden="true" size={16} className={`shrink-0 text-[var(--cd-color-text-secondary)] motion-safe:transition-transform ${showProject ? 'rotate-180' : ''}`} />
              </button>
              <div id={projectId} hidden={!showProject}>
                <PaginatedDeals initial={result.project} scope="project" loadPage={result.loadPage} />
              </div>
            </section>
          )}
        </>
      )}
    </Dialog>
  );
}
