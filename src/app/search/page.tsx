'use client';

import * as React from 'react';
import Link from 'next/link';
import { AppHeader, Input, LoadingState } from '@/src/components/ui';
import { useImpersonation } from '@/src/contexts/ImpersonationContext';
import { useAppSession } from '@/src/components/SessionProvider';
import { getBuildings, type BuildingRow } from '@/src/services/apiClient';
import { fetchFutureSupplyPayload } from '@/src/services/mapDataClient';
import { searchLeaseCompanies } from '@/src/services/leaseCompanyLookupClient';
import { canAccessModule } from '@/src/utils/accessControl';
import { buildingChoices, matchesBuildingChoice } from '@/src/lib/broker/buildingChoices';
import { dealHistoryHref, mapBuildingHref } from '@/src/lib/broker/links';
import type { LeaseCompanySuggestion } from '../lease-submission/leaseCompanyLookup';

const action = 'inline-flex min-h-11 items-center rounded-md px-2 text-sm text-[var(--cd-color-brand)] hover:bg-[var(--cd-color-surface-alt)]';

export default function BrokerSearchPage() {
  const { session, status } = useAppSession();
  const { targetUserId, targetRole } = useImpersonation();
  if (status === 'unauthenticated') return <div className="p-5"><Link href="/login">登录后使用统一搜索</Link></div>;
  if (status !== 'authenticated' || !session || session.user.app_metadata?.must_change_password) return <LoadingState label="正在确认访问权限" />;
  if (!canAccessModule('map', session.role)) return <div className="p-5">当前账号无法访问搜索。</div>;
  return <SearchWorkspace key={JSON.stringify([session.user.id, session.role, session.session.access_token, targetUserId, targetRole])} companyAccess={canAccessModule('lease-submission', targetRole ?? session.role)} />;
}

function SearchWorkspace({ companyAccess }: { companyAccess: boolean }) {
  const [input, setInput] = React.useState(() => typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('q')?.slice(0, 200) ?? '');
  const [composing, setComposing] = React.useState(false);
  const [catalog, setCatalog] = React.useState<{ stock: BuildingRow[]; future: BuildingRow[]; errors: string[] }>();
  const [retry, setRetry] = React.useState(0);
  const [companyRead, setCompanyRead] = React.useState<{ query: string; results: LeaseCompanySuggestion[] | null }>();
  const query = composing ? '' : input.trim();
  React.useEffect(() => {
    let alive = true;
    void Promise.allSettled([
      getBuildings({ select: 'id,name,former_names,district,submarket,grade,location_lng,location_lat' }),
      fetchFutureSupplyPayload(),
    ]).then(([stock, future]) => {
      if (!alive) return;
      setCatalog({
        stock: stock.status === 'fulfilled' ? stock.value : [],
        future: future.status === 'fulfilled' ? future.value.map(row => ({
          ...row, name: row.name, lng: row.location_lng, lat: row.location_lat,
        } as BuildingRow)) : [],
        errors: [stock.status === 'rejected' ? '楼宇' : '', future.status === 'rejected' ? '未来供应' : ''].filter(Boolean),
      });
    });
    return () => { alive = false; };
  }, [retry]);
  React.useEffect(() => {
    if (!query || !companyAccess) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void searchLeaseCompanies(query, controller.signal).then(
        data => { if (!controller.signal.aborted) setCompanyRead({ query, results: data.suggestions }); },
        () => { if (!controller.signal.aborted) setCompanyRead({ query, results: null }); },
      );
    }, 280);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [companyAccess, query, retry]);
  const stock = React.useMemo(() => buildingChoices(catalog?.stock ?? []), [catalog]);
  const future = React.useMemo(() => buildingChoices(catalog?.future ?? []), [catalog]);
  const matched = query ? [
    ...stock.filter(item => matchesBuildingChoice(item, query)).map(item => ({ ...item, future: false })),
    ...future.filter(item => matchesBuildingChoice(item, query)).map(item => ({ ...item, future: true })),
  ] : [];
  const companies = companyRead?.query === query ? companyRead.results : undefined;
  const back = `/search?${new URLSearchParams({ q: input })}`;

  const updateInput = (value: string) => {
    setInput(value);
    window.history.replaceState(null, '', value ? `/search?${new URLSearchParams({ q: value })}` : '/search');
  };

  return <div className="min-h-dvh bg-[var(--cd-color-canvas)]">
    <header className="border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]"><AppHeader title="统一搜索" homeHref="/" /></header>
    <main className="mx-auto w-full max-w-3xl px-4 py-5">
      <label htmlFor="broker-search" className="mb-2 block text-sm font-medium">楼宇、项目或企业</label>
      <Input id="broker-search" value={input} maxLength={200} placeholder="输入名称或曾用名" onChange={event => updateInput(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />
      {query && <>
        <section className="mt-5" aria-label="楼宇与项目">
          <h2 className="text-sm font-semibold">楼宇与项目</h2>
          {!catalog ? <p role="status" className="py-2 text-sm">正在读取楼宇与项目…</p> : <>
            {catalog.errors.length > 0 && <p role="status" className="text-sm">{catalog.errors.join('、')}读取失败。<button type="button" className={action} onClick={() => setRetry(value => value + 1)}>重试</button></p>}
            {!matched.length && !catalog.errors.length && <p className="py-2 text-sm">没有匹配的楼宇或项目。</p>}
            <ul className="divide-y divide-[var(--cd-color-border)]">
              {matched.slice(0, 20).map(item => {
                const row = (item.future ? catalog.future : catalog.stock).find(row => row.id === item.value);
                const located = Number.isFinite(row?.lng) && Number.isFinite(row?.lat);
                return <li key={`${item.future}:${item.value}`} className="py-2 text-sm">
                  <p className="break-words font-medium">{item.label}{item.future ? ' · 未来供应' : ''}</p>
                  <p className="break-words text-[var(--cd-color-text-secondary)]">{item.detail}{item.aliases.length > 0 ? ` · 曾用名：${item.aliases.join('、')}` : ''}</p>
                  <div className="flex flex-wrap gap-x-2">
                    {located ? <Link prefetch={false} className={action} href={mapBuildingHref(item.value, { future: item.future, back })}>地图详情</Link> : <span className="self-center text-sm">暂无地图坐标</span>}
                    {companyAccess && !item.future && <Link prefetch={false} className={action} href={dealHistoryHref({ id: item.value, name: item.label }, back)}>成交</Link>}
                    {!item.future && <Link prefetch={false} className={action} href={mapBuildingHref(item.value, { section: 'brochure', back })}>楼书与资料</Link>}
                  </div>
                </li>;
              })}
            </ul>
            {matched.length > 20 && <p className="text-sm">显示前 20 项，请缩小搜索范围。</p>}
          </>}
        </section>
        {companyAccess && <section className="mt-5" aria-label="企业">
          <h2 className="text-sm font-semibold">成交库企业</h2>
          {companies === undefined ? <p role="status" className="py-2 text-sm">正在查询企业…</p> : companies === null ? <p role="status" className="text-sm">企业查询失败。<button type="button" className={action} onClick={() => setRetry(value => value + 1)}>重试</button></p> :
            companies.length ? <ul className="divide-y divide-[var(--cd-color-border)]">{companies.map(item => <li key={item.company}>
              <Link prefetch={false} className={action} href={dealHistoryHref({ company: item.company }, back)}>{item.company} · 查看成交</Link>
              {item.matchedFullName && <p className="px-2 pb-2 text-sm">历史填报名称线索：{item.matchedFullName}</p>}
            </li>)}</ul> : <p className="py-2 text-sm">可查看的成交库中没有匹配企业。</p>}
        </section>}
      </>}
    </main>
  </div>;
}
