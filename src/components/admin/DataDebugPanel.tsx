'use client';

import * as React from 'react';
import { useMemo, useState, useEffect } from 'react';
import { supabase } from '@/src/services/supabaseClient';
import type { BuildingWithMetrics, BuildingMetric } from '@/src/types';
import type { SidebarFilterState } from '@/src/components/SidebarFilter';
import { Button, ErrorState } from '@/src/components/ui';
import { DebugFilter } from './DebugFilter';
import { filterBuildings } from '@/src/utils/filterBuildings';
import { computeDebugStats, type DebugStatsResult, type BuildingContribution } from '@/src/utils/debugStats';

function toFiniteNumber(input: unknown): number {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  const n = typeof input === 'string' ? Number(input.trim()) : Number(input);
  return Number.isFinite(n) ? n : NaN;
}

function formatNum(n: number | null, decimals = 1): string {
  if (n === null || !Number.isFinite(n)) return '-';
  return n.toFixed(decimals);
}

function formatPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '-';
  return (n * 100).toFixed(1) + '%';
}

// ─── Breakdown Card ──────────────────────────────────────────────────────────

function BreakdownCard({ title, formula, numerator, denominator, result, excludedCount, contributions, valueFormatter, isPercentage }: {
  title: string;
  formula: string;
  numerator: number;
  denominator: number;
  result: number | null;
  excludedCount: number;
  contributions: BuildingContribution[];
  valueFormatter: (n: number | null) => string;
  isPercentage?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const includedContribs = contributions.filter(c => title.includes('租金') ? !c.excludedFromRent : !c.excludedFromVacancy);
  const excludedContribs = contributions.filter(c => title.includes('租金') ? c.excludedFromRent : c.excludedFromVacancy);

  return (
    <div className="overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
      <div className="border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-5 py-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-800">{title}</h3>
          <span className="text-lg font-bold text-[var(--cd-color-brand)]">{isPercentage ? formatPct(result) : valueFormatter(result)}</span>
        </div>
        <p className="text-[11px] text-zinc-500 mt-1 font-mono">{formula}</p>
      </div>
      <div className="flex items-center gap-6 border-b border-[var(--cd-color-border)] px-5 py-3 text-xs">
        <div><span className="text-zinc-500">分子 Σ：</span><span className="font-semibold text-zinc-800">{numerator.toFixed(1)}</span></div>
        <div><span className="text-zinc-500">分母 Σ：</span><span className="font-semibold text-zinc-800">{denominator.toFixed(1)}</span></div>
        <div><span className="text-zinc-500">参与楼宇：</span><span className="font-semibold text-zinc-800">{includedContribs.length}</span></div>
        {excludedCount > 0 && <div><span className="text-red-500">排除：</span><span className="font-semibold text-red-600">{excludedCount}</span></div>}
      </div>
      <div className="px-5 py-3">
        <button onClick={() => setExpanded(!expanded)}
          className="text-xs font-medium text-[var(--cd-color-brand)] hover:underline">
          {expanded ? '收起贡献明细 ▲' : '展开贡献明细 ▼'}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-zinc-100">
          <div className="max-h-[400px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-zinc-600">项目名称</th>
                  <th className="px-3 py-2 text-left font-semibold text-zinc-600">子市场</th>
                  <th className="px-3 py-2 text-right font-semibold text-zinc-600">总面积</th>
                  <th className="px-3 py-2 text-right font-semibold text-zinc-600">净有效租金</th>
                  <th className="px-3 py-2 text-right font-semibold text-zinc-600">租金×面积</th>
                  <th className="px-3 py-2 text-left font-semibold text-zinc-600">数据期</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {includedContribs.map(c => (
                  <tr key={c.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-1.5 text-zinc-800 font-medium">{c.name}</td>
                    <td className="px-3 py-1.5 text-zinc-600">{c.submarket}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-700 tabular-nums">{c.totalArea?.toFixed(0) ?? '-'}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-700 tabular-nums">{c.netEffectiveRent?.toFixed(1) ?? '-'}</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-[var(--cd-color-brand)]">{c.rentContribution?.toFixed(1) ?? '-'}</td>
                    <td className="px-3 py-1.5 text-zinc-500">{c.metricYear ?? '-'}Q{c.metricQuarter ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {excludedContribs.length > 0 && (
            <div className="border-t border-red-100 bg-red-50/30">
              <div className="px-5 py-2 text-xs font-semibold text-red-600">被排除的楼宇（{excludedContribs.length}）</div>
              <div className="max-h-[200px] overflow-auto">
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-red-50">
                    {excludedContribs.map(c => (
                      <tr key={c.id} className="hover:bg-red-50">
                        <td className="px-3 py-1.5 text-zinc-800">{c.name}</td>
                        <td className="px-3 py-1.5 text-zinc-600">{c.submarket}</td>
                        <td className="px-3 py-1.5 text-red-600">{c.excludeReason}</td>
                        <td className="px-3 py-1.5 text-zinc-500">{c.metricYear ?? '-'}Q{c.metricQuarter ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export function DataDebugPanel() {
  const [allBuildings, setAllBuildings] = useState<BuildingWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filterState, setFilterState] = useState<SidebarFilterState | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const { data, error } = await supabase
        .from('buildings')
        .select(`id, name, submarket, grade, city, district, location_lng, location_lat,
          completion_year, leed_certification, owner, property_management,
          building_metrics(id, building_id, total_area, asking_rent, management_fee, face_rent,
            rent_free_period, net_effective_rent, vacancy_rate, vacant_area, record_year, record_quarter)`)
        .eq('is_active', true)
        .eq('tracking_scope', 'tracked')
        .abortSignal(controller.signal);
      if (controller.signal.aborted) return;
      if (error) {
        setLoadFailed(true);
        setLoading(false);
        return;
      }
      const rows = Array.isArray(data) ? data : [];
      const buildings: BuildingWithMetrics[] = [];
      for (const r of rows) {
        const lng = toFiniteNumber(r.location_lng);
        const lat = toFiniteNumber(r.location_lat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        const metricsRaw: Record<string, unknown>[] = Array.isArray(r.building_metrics) ? r.building_metrics : [];
        const metrics: BuildingMetric[] = metricsRaw
          .map((rm: Record<string, unknown>) => ({
            id: String(rm.id ?? ''), building_id: String(rm.building_id ?? ''),
            total_area: toFiniteNumber(rm.total_area), asking_rent: toFiniteNumber(rm.asking_rent),
            management_fee: toFiniteNumber(rm.management_fee), face_rent: toFiniteNumber(rm.face_rent),
            rent_free_period: toFiniteNumber(rm.rent_free_period), net_effective_rent: toFiniteNumber(rm.net_effective_rent),
            vacancy_rate: toFiniteNumber(rm.vacancy_rate), vacant_area: toFiniteNumber(rm.vacant_area),
            record_year: toFiniteNumber(rm.record_year), record_quarter: toFiniteNumber(rm.record_quarter),
          }))
          .filter((m: BuildingMetric) => m.id !== '' && m.building_id !== '');
        buildings.push({
          id: String(r.id ?? ''), name: String(r.name ?? ''), submarket: String(r.submarket ?? ''),
          grade: String(r.grade ?? ''), city: String(r.city ?? ''), district: String(r.district ?? ''),
          location_lng: lng, location_lat: lat, completion_year: String(r.completion_year ?? ''),
          leed_certification: String(r.leed_certification ?? ''),
          owner: r.owner ? String(r.owner) : undefined,
          property_management: r.property_management ? String(r.property_management) : undefined,
          metrics,
        });
      }
      setAllBuildings(buildings.filter(b => b.id !== '' && b.name !== ''));
      setLoading(false);
    })().catch(() => {
      if (controller.signal.aborted) return;
      setLoadFailed(true);
      setLoading(false);
    });
    return () => controller.abort();
  }, [attempt]);

  // Extract filter options from data
  const filterOptions = useMemo(() => {
    const districts = Array.from(new Set(allBuildings.map(b => b.district).filter(Boolean))).sort();
    const submarkets = Array.from(new Set(allBuildings.map(b => b.submarket).filter(Boolean))).sort();
    const leeds = Array.from(new Set(allBuildings.map(b => b.leed_certification || 'NULL'))).sort();
    return { districts, submarkets, leeds };
  }, [allBuildings]);

  // Apply filter
  const filteredBuildings = useMemo(() => {
    if (!filterState) return allBuildings;
    return filterBuildings(allBuildings, filterState);
  }, [allBuildings, filterState]);

  // Compute debug stats
  const stats: DebugStatsResult | null = useMemo(() => {
    if (filteredBuildings.length === 0) return null;
    return computeDebugStats(filteredBuildings);
  }, [filteredBuildings]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-400">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent mx-auto mb-3" />
          <span className="text-sm">加载楼宇数据…</span>
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState title="楼宇数据加载失败" action={
          <Button variant="secondary" onClick={() => {
            setLoading(true);
            setLoadFailed(false);
            setAttempt(value => value + 1);
          }}>重试</Button>
        } />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      <DebugFilter
        districts={filterOptions.districts}
        submarkets={filterOptions.submarkets}
        leeds={filterOptions.leeds}
        onFilterChange={setFilterState}
      />
      <main className="w-full min-w-0 flex-1 bg-zinc-50/50 p-4 md:w-auto md:overflow-y-auto md:p-6">
        {!stats ? (
          <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
            无匹配数据，请调整筛选条件
          </div>
        ) : (
          <div className="max-w-[1200px] mx-auto space-y-5">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="加权平均租金" value={formatNum(stats.weightedRent.result, 1)} unit="元/㎡/月" />
              <SummaryCard label="空置率" value={formatPct(stats.vacancyRate.result)} unit="" />
              <SummaryCard label="项目数量" value={String(stats.projectCount)} unit="栋" />
              <SummaryCard label="LEED认证" value={String(stats.leedCount)} unit="栋" />
            </div>

            {/* Weighted Rent Breakdown */}
            <BreakdownCard
              title="加权平均租金"
              formula={stats.weightedRent.formula}
              numerator={stats.weightedRent.numerator}
              denominator={stats.weightedRent.denominator}
              result={stats.weightedRent.result}
              excludedCount={stats.weightedRent.excludedCount}
              contributions={stats.weightedRent.contributions}
              valueFormatter={n => formatNum(n, 1)}
            />

            {/* Vacancy Rate Breakdown */}
            <BreakdownCard
              title="空置率"
              formula={stats.vacancyRate.formula}
              numerator={stats.vacancyRate.numerator}
              denominator={stats.vacancyRate.denominator}
              result={stats.vacancyRate.result}
              excludedCount={stats.vacancyRate.excludedCount}
              contributions={stats.vacancyRate.contributions}
              valueFormatter={n => formatNum(n, 1)}
              isPercentage
            />

            {/* Submarket Breakdown */}
            <div className="overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
              <div className="border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-5 py-4">
                <h3 className="text-sm font-bold text-zinc-800">子市场汇总</h3>
              </div>
              <div className="max-h-[400px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-semibold text-zinc-600">子市场</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-zinc-600">项目数</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-zinc-600">加权平均租金</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-zinc-600">空置率</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-zinc-600">总面积</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-zinc-600">空置面积</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {stats.submarkets.map(s => (
                      <tr key={s.submarket} className="hover:bg-zinc-50">
                        <td className="px-4 py-2 text-zinc-800 font-medium">{s.submarket}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-zinc-700">{s.buildingCount}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-[var(--cd-color-brand)]">{formatNum(s.avgRent, 1)}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-zinc-700">{formatPct(s.vacancyRate)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-zinc-600">{s.totalArea.toFixed(0)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-zinc-600">{s.vacantArea.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* LEED Buildings */}
            {stats.leedBuildings.length > 0 && (
              <div className="overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
                <div className="border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-5 py-4">
                  <h3 className="text-sm font-bold text-zinc-800">LEED认证楼宇（{stats.leedBuildings.length}）</h3>
                </div>
                <div className="max-h-[300px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-semibold text-zinc-600">项目名称</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-zinc-600">子市场</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-zinc-600">LEED等级</th>
                        <th className="px-4 py-2.5 text-right font-semibold text-zinc-600">净有效租金</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {stats.leedBuildings.map(b => (
                        <tr key={b.id} className="hover:bg-zinc-50">
                          <td className="px-4 py-2 text-zinc-800 font-medium">{b.name}</td>
                          <td className="px-4 py-2 text-zinc-600">{b.submarket}</td>
                          <td className="px-4 py-2 font-semibold text-zinc-700">{b.leedCertification}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-zinc-700">{b.netEffectiveRent?.toFixed(1) ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function SummaryCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-4">
      <p className="mb-1 text-xs font-medium text-[var(--cd-color-text-secondary)]">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-[var(--cd-color-brand)]">{value}</span>
        {unit && <span className="text-xs text-zinc-500">{unit}</span>}
      </div>
    </div>
  );
}

export default DataDebugPanel;
