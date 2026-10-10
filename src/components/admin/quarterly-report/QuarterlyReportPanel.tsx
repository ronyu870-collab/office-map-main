'use client';
import * as React from 'react';
import { Button } from '@/src/components/ui';
import { logAction } from '@/src/utils/audit';
import { useSubmissionRead, type useSubmissionPeriod } from '../useSubmissionRead';
import { loadReport } from './data';
import { formatNumber, formatRate, METHOD_NOTE, periodLabel, snapshotLabel, type Aggregate, type Report } from './model';

type PeriodControl = ReturnType<typeof useSubmissionPeriod>;
const control = 'h-8 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-white px-2 text-sm';
function sampleTitle(a: Aggregate, metric: 'rent' | 'vacancy') {
  return `有效样本：${metric === 'rent' ? a.rentCount : a.vacancyCount}栋 / 共${a.count}栋`;
}
export function MarketDashboard({ report }: { report: Report }) {
  return <div className="space-y-6">
    <p className="text-xs leading-5 text-zinc-500">{METHOD_NOTE}</p>
    {report.markets.map(group => <section key={group.key} aria-label={group.label}>
      <h3 className="mb-2 text-sm font-semibold text-[var(--cd-color-brand)]">{group.label}</h3>
      <div className="overflow-x-auto rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)]">
        <table className="w-full min-w-[850px] border-collapse text-sm tabular-nums">
          <thead className="bg-zinc-50 text-xs text-zinc-500"><tr>
            {['子市场', '本季栋数', '上季栋数', `${periodLabel(report.previous)}租金`, `${periodLabel(report.period)}租金`, '租金环比', `${periodLabel(report.previous)}空置率`, `${periodLabel(report.period)}空置率`, '变化(pp)'].map((h, i) =>
              <th key={h} scope="col" className={`px-3 py-3 font-medium whitespace-nowrap ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-zinc-100">{group.rows.map(row => <tr key={row.name} className={row.total ? 'bg-slate-50 font-medium' : 'bg-white'}>
            <th scope="row" className={`whitespace-nowrap px-3 py-2.5 text-left ${row.total ? 'font-medium' : 'font-normal'}`}>{row.name}</th>
            <td className="px-3 py-2.5 text-right">{row.current.count}</td><td className="px-3 py-2.5 text-right">{row.previous.count}</td>
            <td className="px-3 py-2.5 text-right" title={sampleTitle(row.previous, 'rent')}>{formatNumber(row.previous.rent)}</td>
            <td className="px-3 py-2.5 text-right" title={sampleTitle(row.current, 'rent')}>{formatNumber(row.current.rent)}</td>
            <td className="px-3 py-2.5 text-right">{formatRate(row.rentChange, true)}</td>
            <td className="px-3 py-2.5 text-right" title={sampleTitle(row.previous, 'vacancy')}>{formatRate(row.previous.vacancy)}</td>
            <td className="px-3 py-2.5 text-right" title={sampleTitle(row.current, 'vacancy')}>{formatRate(row.current.vacancy)}</td>
            <td className="px-3 py-2.5 text-right">{formatRate(row.vacancyChange, true, true)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>)}
    {(report.currentIssueCount > 0 || report.previousIssueCount > 0) && <p className="text-xs leading-5 text-amber-800" role="note">
      本季{report.currentIssueCount}栋、上季{report.previousIssueCount}栋数据需核查；无效指标未计入。悬停指标可查看有效样本数，本季问题在导出的「本季最新」表标注。
      {report.unclassifiedCount > 0 && ' 未识别类型的楼宇未计入分类统计。'}
    </p>}
  </div>;
}

/** One market snapshot drives both the on-screen aggregates and all four export sheets. */
export function QuarterlyReportPanel({ period, history }: { period: PeriodControl; history: React.ReactNode }) {
  const [view, setView] = React.useState<'market' | 'raw'>('market');
  const [refresh, setRefresh] = React.useState(0);
  const { year, quarter, setYear, setQuarter, configured } = period;
  const key = `${year}:Q${quarter}:${refresh}`;
  const read = useSubmissionRead(key, () => loadReport({ year, quarter }), !configured.loading);
  const [exportState, setExportState] = React.useState<{ key: string; busy: boolean; error?: string }>({ key: '', busy: false });
  const generation = React.useRef(0);
  const busyKey = React.useRef<string | null>(null);
  React.useEffect(() => () => { generation.current++; busyKey.current = null; }, [key]);
  const exporting = exportState.key === key && exportState.busy;
  const error = exportState.key === key ? exportState.error : undefined;
  const years = [...new Set([year, configured.data?.year ?? year, ...Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i)])].sort((a, b) => a - b);

  async function handleExport() {
    const report = read.data;
    if (!report || read.loading || read.error || busyKey.current === key) return;
    const request = ++generation.current;
    busyKey.current = key;
    setExportState({ key, busy: true });
    try {
      const [{ reportBytes }, { saveAs }] = await Promise.all([import('./workbook'), import('file-saver')]);
      const bytes = await reportBytes(report);
      if (generation.current !== request) return; // Quarter changed or component unmounted while preparing the file.
      const filename = `季度市场数据_${year}Q${quarter}.xlsx`;
      saveAs(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
      logAction(undefined, 'EXPORT_DATA', {
        export_type: 'quarterly_submissions', record_count: report.raw.length, latest_building_count: report.latest.length,
        file_name: filename, year, quarter, baseline_year: report.previous.year, baseline_quarter: report.previous.quarter,
        export_mode: 'quarterly_market_workbook', snapshot_at: report.capturedAt, target_name: filename,
      });
      setExportState({ key, busy: false });
    } catch (cause) {
      if (generation.current === request) setExportState({ key, busy: false, error: cause instanceof Error ? cause.message : '导出失败，请重试' });
    } finally {
      if (generation.current === request) busyKey.current = null;
    }
  }

  return <div className="flex h-full min-h-0 flex-col">
    <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
      <div className="flex items-center rounded-[var(--cd-radius-md)] bg-zinc-100 p-0.5" role="tablist" aria-label="填报数据视图">
        {([{ key: 'market', label: '市场看板' }, { key: 'raw', label: '原始记录' }] as const).map(t =>
          <button type="button" key={t.key} role="tab" aria-selected={view === t.key} onClick={() => setView(t.key)}
            className={`rounded-[var(--cd-radius-md)] px-3 py-1.5 text-sm ${view === t.key ? 'bg-white font-medium text-[var(--cd-color-brand)] shadow-sm' : 'text-zinc-500'}`}>{t.label}</button>)}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setRefresh(n => n + 1)} disabled={read.loading || configured.loading || exporting}>刷新</Button>
        <Button size="sm" variant="secondary" onClick={() => void handleExport()} disabled={!read.data || read.loading || !!read.error || exporting}
          title="导出所选季度全部人员的数据，包含季度环比、本季最新、原始记录和市场看板">{exporting ? '正在导出…' : '导出 Excel'}</Button>
      </div>
    </div>
    {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
    {read.error && <p role="alert" className="mb-2 text-sm text-red-700">数据读取失败：{read.error} <button type="button" className="underline" onClick={() => setRefresh(n => n + 1)}>重试</button></p>}
    {view === 'market' ? <>
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
        <select aria-label="统计年份" className={control} value={year} disabled={exporting} onChange={e => setYear(Number(e.target.value))}>{years.map(y => <option key={y} value={y}>{y}年</option>)}</select>
        <select aria-label="统计季度" className={control} value={quarter} disabled={exporting} onChange={e => setQuarter(Number(e.target.value))}>{[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}</select>
        <span className="text-xs text-zinc-500">租金：元/㎡/月 · 空置率：%</span>
        {read.data && <span className="ml-auto text-xs text-zinc-400">截至 {snapshotLabel(read.data.capturedAt)}（北京时间）</span>}
      </div>
      {configured.error && <p role="alert" className="mb-2 text-xs text-amber-800">默认季度读取失败，当前使用所选季度。</p>}
      <div className="min-h-0 flex-1 overflow-auto" role="tabpanel" aria-label="市场看板">
        {(read.loading || configured.loading) ? <p role="status" className="py-10 text-center text-sm text-zinc-500">正在读取季度数据…</p> : read.data ? <MarketDashboard report={read.data} /> : null}
      </div>
    </> : <>
      <p className="mb-2 text-xs text-zinc-500">人员筛选仅影响下方记录；导出始终包含所选季度全部数据。</p>
      <div key={key} className="min-h-0 flex-1" role="tabpanel" aria-label="原始记录">{history}</div>
    </>}
  </div>;
}
