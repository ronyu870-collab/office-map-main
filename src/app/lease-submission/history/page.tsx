'use client';

import * as React from 'react';
import Link from 'next/link';

import { getSessionFast } from '@/src/services/Auth';
import { Badge, Button, LoadingState } from '@/src/components/ui';

type LeaseReadRecord = {
  read_id: string;
  record_source: 'live' | 'history';
  building_id: string | null;
  building_match_scope: 'exact' | 'project' | 'unmapped';
  related_building_ids: string[];
  company: string | null;
  industry: string | null;
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
  quality_status: string | null;
};

function fmtNumber(value: number | null) {
  return value == null ? '-' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function associationLabel(scope: LeaseReadRecord['building_match_scope']) {
  if (scope === 'exact') return '精确楼宇';
  if (scope === 'project') return '项目级';
  return '待映射';
}

export default function LeaseHistoryPage() {
  const [company, setCompany] = React.useState('');
  const [building, setBuilding] = React.useState('');
  const [yearFrom, setYearFrom] = React.useState('2015');
  const [yearTo, setYearTo] = React.useState(String(new Date().getFullYear()));
  const [records, setRecords] = React.useState<LeaseReadRecord[]>([]);
  const [count, setCount] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await getSessionFast();
      const token = session?.session?.access_token;
      if (!token) throw new Error('登录状态异常，请重新登录');

      const params = new URLSearchParams({ limit: '100' });
      if (company.trim()) params.set('company', company.trim());
      if (building.trim()) params.set('building', building.trim());
      if (yearFrom) params.set('year_from', yearFrom);
      if (yearTo) params.set('year_to', yearTo);

      const response = await fetch(`/api/lease-transactions/read?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '查询失败');
      setRecords(body.records ?? []);
      setCount(body.count ?? 0);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '查询失败');
      setRecords([]);
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, [building, company, yearFrom, yearTo]);

  React.useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-[var(--cd-color-workspace)] text-[var(--cd-color-text-primary)]">
      <header className="sticky top-0 z-20 border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold">租赁成交数据库</h1>
              <Badge tone="neutral">实时 + 历史</Badge>
            </div>
            <p className="mt-1 text-[11px] text-[var(--cd-color-text-secondary)]">统一读取 2015 至今成交；“项目级”表示已确认到项目，但没有把历史成交伪精确到当前某一塔楼。</p>
          </div>
          <Link href="/lease-submission" className="text-xs font-medium text-[var(--cd-color-brand)] hover:underline">返回成交填报</Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-3 p-4 sm:p-6">
        <section className="grid gap-2 rounded-lg border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-3 sm:grid-cols-5">
          <input value={company} onChange={e => setCompany(e.target.value)} placeholder="公司名称" className="h-9 rounded-md border border-[var(--cd-color-border)] bg-white px-3 text-xs" />
          <input value={building} onChange={e => setBuilding(e.target.value)} placeholder="楼宇名称" className="h-9 rounded-md border border-[var(--cd-color-border)] bg-white px-3 text-xs" />
          <input value={yearFrom} onChange={e => setYearFrom(e.target.value)} inputMode="numeric" placeholder="起始年份" className="h-9 rounded-md border border-[var(--cd-color-border)] bg-white px-3 text-xs" />
          <input value={yearTo} onChange={e => setYearTo(e.target.value)} inputMode="numeric" placeholder="结束年份" className="h-9 rounded-md border border-[var(--cd-color-border)] bg-white px-3 text-xs" />
          <Button type="button" size="sm" onClick={() => void load()}>查询</Button>
        </section>

        <section className="overflow-hidden rounded-lg border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--cd-color-border)] px-4 py-3">
            <div className="text-xs font-semibold">成交记录</div>
            <div className="text-[11px] text-[var(--cd-color-text-secondary)]">共 {count.toLocaleString('zh-CN')} 条，当前显示前 {Math.min(100, records.length)} 条</div>
          </div>
          {loading ? <div className="p-6"><LoadingState label="正在读取成交数据库" rows={5} /></div> : error ? (
            <div className="p-8 text-center text-xs text-red-600">{error}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-[11px]">
                <thead className="bg-[var(--cd-color-surface-alt)] text-[10px] text-[var(--cd-color-text-secondary)]">
                  <tr>{['来源','公司','楼宇','商圈','行业','需求','面积㎡','表面租金','有效租金','租期(月)','年份','季度','楼宇关联'].map(label => <th key={label} className="border-b border-[var(--cd-color-border)] px-3 py-2.5 text-left font-semibold">{label}</th>)}</tr>
                </thead>
                <tbody>
                  {records.map(row => (
                    <tr key={row.read_id} className="border-b border-[var(--cd-color-border)]/60 last:border-0 hover:bg-[var(--cd-color-surface-alt)]/60">
                      <td className="px-3 py-2.5"><Badge tone={row.record_source === 'live' ? 'success' : 'neutral'}>{row.record_source === 'live' ? '实时' : '历史'}</Badge></td>
                      <td className="max-w-48 truncate px-3 py-2.5 font-medium">{row.company || '-'}</td>
                      <td className="max-w-48 truncate px-3 py-2.5">{row.new_building || '-'}</td>
                      <td className="px-3 py-2.5">{row.sub_market || '-'}</td>
                      <td className="px-3 py-2.5">{row.industry || '-'}</td>
                      <td className="px-3 py-2.5">{row.demand_type || '-'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtNumber(row.area_sqm)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtNumber(row.face_rent)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtNumber(row.effective_rent)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtNumber(row.lease_term_months)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{row.transaction_year ?? '-'}</td>
                      <td className="px-3 py-2.5">{row.transaction_quarter || '-'}</td>
                      <td className="px-3 py-2.5"><Badge tone={row.building_match_scope === 'exact' ? 'success' : 'neutral'}>{associationLabel(row.building_match_scope)}</Badge></td>
                    </tr>
                  ))}
                  {records.length === 0 && <tr><td colSpan={13} className="px-4 py-12 text-center text-xs text-[var(--cd-color-text-secondary)]">没有符合条件的成交记录</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
