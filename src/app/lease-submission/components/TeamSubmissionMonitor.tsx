'use client';

import * as React from 'react';
import { Users, TrendingUp, AlertCircle, X } from 'lucide-react';
import { getAllBrokers, getAllSubmissions } from '@/src/services/leaseTransactionSubmitService';
import { SubmissionDetailTable } from './SubmissionDetailTable';
import { MaskedText } from '@/src/components/demo';
import { isExcludedFromTeamView } from '@/src/config/demoMode';
import { aggregateTeamWeeks, calculateTeamWeeks, type BrokerWeeklyStats } from '../teamMonitoringStats';
import { Button, LoadingState } from '@/src/components/ui';

interface TeamSubmissionMonitorProps {
  userRole: string;
}

type ReadState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

function useMonitorRead<T>(read: (signal: AbortSignal) => Promise<T>) {
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState<ReadState<T>>({ status: 'loading' });

  React.useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ status: 'ready', data });
    }, (error: unknown) => {
      if (!controller.signal.aborted) {
        setState({ status: 'error', message: error instanceof Error ? error.message : '加载失败' });
      }
    });
    return () => controller.abort();
  }, [read, attempt]);

  return { state, retry: () => {
    setState({ status: 'loading' });
    setAttempt(previous => previous + 1);
  } };
}

async function readDirectory(signal: AbortSignal) {
  return getAllBrokers({ signal });
}

function MonitorReadStatus({ title, label, message, retry }: {
  title: string; label: string; message?: string; retry: () => void;
}) {
  return (
    <section className="rounded-lg border border-[#d9e0e8] bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {message === undefined ? <LoadingState label={`正在加载${label}…`} rows={0} /> : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p role="alert" className="text-sm text-rose-700">{message}</p>
          <Button size="sm" variant="ghost" onClick={retry}>重试{label}</Button>
        </div>
      )}
    </section>
  );
}

export function TeamSubmissionMonitor({ userRole }: TeamSubmissionMonitorProps) {
  const readSubmissions = React.useCallback((signal: AbortSignal) => getAllSubmissions(userRole, { signal }), [userRole]);
  const { state: directory, retry: retryDirectory } = useMonitorRead(readDirectory);
  const { state: records, retry: retryRecords } = useMonitorRead(readSubmissions);
  const [{ weeks, currentWeekNumber }] = React.useState(calculateTeamWeeks);
  const [filteredUserId, setFilteredUserId] = React.useState<string | null>(null);
  const [filteredUserName, setFilteredUserName] = React.useState<string>('');
  const detailTableRef = React.useRef<HTMLDivElement>(null);
  const scrollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (scrollTimer.current !== null) clearTimeout(scrollTimer.current); }, []);

  const brokers = directory.status === 'ready' ? directory.data : null;
  const allSubmissions = records.status === 'ready' ? records.data : null;
  const stats = React.useMemo(() => brokers && allSubmissions
    ? aggregateTeamWeeks(brokers, allSubmissions, weeks, currentWeekNumber) : null,
  [brokers, allSubmissions, weeks, currentWeekNumber]);

  const filterByBroker = (broker: BrokerWeeklyStats) => {
    setFilteredUserId(broker.user_id);
    setFilteredUserName(broker.name);
    if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      scrollTimer.current = null;
      detailTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const showAllSubmissions = () => {
    setFilteredUserId(null);
    setFilteredUserName('');
  };

  const displayedSubmissions = React.useMemo(() => allSubmissions?.filter((submission) => (
    (!filteredUserId || submission.submitter_id === filteredUserId) && !isExcludedFromTeamView(submission.submitter_name)
  )) ?? [], [allSubmissions, filteredUserId]);

  const detailTableTitle = filteredUserId
    ? `${filteredUserName} 的成交填报明细`
    : '团队全量明细';

  const renderWeekCell = (count: number) => {
    let bgColor = 'bg-slate-100';
    let textColor = 'text-slate-400';

    if (count >= 2) {
      bgColor = 'bg-emerald-100';
      textColor = 'text-emerald-700';
    } else if (count === 1) {
      bgColor = 'bg-amber-100';
      textColor = 'text-amber-700';
    }

    return (
      <div className={`${bgColor} ${textColor} rounded px-2 py-0.5 text-center text-xs font-semibold tabular-nums`}>
        {count}
      </div>
    );
  };

  const totalBrokers = stats?.length ?? 0;
  const compliantCount = stats?.filter((s) => (s.weeklyData.get(currentWeekNumber) ?? 0) >= 2).length ?? 0;
  const complianceRate = totalBrokers > 0 ? Math.round((compliantCount / totalBrokers) * 100) : 0;

  return (
    <div className="space-y-4">
      {stats === null ? (
        directory.status !== 'ready' ? <MonitorReadStatus title="团队周度提交情况" label="人员目录"
          message={directory.status === 'error' ? directory.message : undefined} retry={retryDirectory} /> : (
          <section className="rounded-lg border border-[#d9e0e8] bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">团队周度提交情况</h3>
            <p className="mt-2 text-sm text-slate-600">{records.status === 'error' ? '重新加载团队明细后可查看统计。' : '成交记录返回后显示统计。'}</p>
          </section>
        )
      ) : <div className="overflow-hidden rounded-lg border border-[#d9e0e8] bg-white shadow-[0_1px_3px_rgba(23,32,51,0.03)]">
        <div className="border-b border-slate-200/80 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Users className="text-[#003e7e]" size={17} />
              <h3 className="text-sm font-semibold text-slate-900">团队周度提交情况</h3>
            </div>
            <div className="flex items-center gap-4 text-[11px]">
              <div className="flex items-center gap-1.5">
                <TrendingUp size={14} className="text-emerald-600" />
                <span className="text-slate-500">本周达标率</span>
                <span className="font-semibold tabular-nums text-emerald-700">{complianceRate}%</span>
              </div>
              <div className="text-slate-400">{compliantCount} / {totalBrokers} 人</div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead className="bg-slate-50/80">
              <tr className="border-b border-slate-200">
                <th className="sticky left-0 z-10 border-r border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500">姓名</th>
                <th className="border-r border-slate-200 px-3 py-2.5 text-center text-[10px] font-semibold text-slate-500">应填数量</th>
                <th className="border-r border-slate-200 px-3 py-2.5 text-center text-[10px] font-semibold text-slate-500">已填数量</th>
                {weeks.length === 0 ? (
                  <th className="px-3 py-2.5 text-center text-[10px] text-slate-400">暂无周数据（统计起始：2026-05-04）</th>
                ) : (
                  weeks.map((week) => (
                    <th key={week.weekNumber} className="px-2 py-2 text-center text-[10px] font-semibold text-slate-500" title={week.label}>
                      <div>第 {week.weekNumber} 周</div>
                      <div className="mt-0.5 text-[10px] font-normal text-slate-400">{week.label}</div>
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr><td colSpan={3 + weeks.length} className="px-4 py-10 text-center text-[11px] text-slate-400">暂无团队成员数据</td></tr>
              ) : (
                stats.map((broker, idx) => (
                  <tr key={broker.user_id} className={`transition-colors hover:bg-slate-50/60 ${idx !== stats.length - 1 ? 'border-b border-slate-100' : ''}`}>
                    <td className="sticky left-0 z-10 whitespace-nowrap border-r border-slate-100 bg-white px-4 py-2.5">
                      <button onClick={() => filterByBroker(broker)} className="whitespace-nowrap text-[11px] font-semibold text-[#003e7e] transition hover:underline" title="查看成交明细"><MaskedText>{broker.name}</MaskedText></button>
                    </td>
                    <td className="border-r border-slate-100 px-3 py-2.5 text-center"><span className="text-[11px] font-medium tabular-nums text-slate-700">{broker.totalRequired}</span></td>
                    <td className="border-r border-slate-100 px-3 py-2.5 text-center">
                      <span className={`text-[11px] font-bold tabular-nums ${broker.totalRequired === 0 ? 'text-slate-500' : broker.totalSubmitted >= broker.totalRequired ? 'text-emerald-600' : 'text-amber-600'}`}>{broker.totalSubmitted}</span>
                    </td>
                    {weeks.length === 0 ? (
                      <td className="px-3 py-2.5 text-center text-[10px] text-slate-400">-</td>
                    ) : (
                      weeks.map((week) => <td key={week.weekNumber} className="px-2 py-2 text-center" title={week.label}>{renderWeekCell(broker.weeklyData.get(week.weekNumber) || 0)}</td>)
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50/60 px-4 py-3 text-[10px] text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p>每周目标 2 条 · 统计起始 2026-05-04 · 当前第 {currentWeekNumber} 周 · 应填数量按已完成周计算</p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded bg-emerald-100" /><span>已达标（≥2）</span></div>
            <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded bg-amber-100" /><span>待补充（1）</span></div>
            <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded bg-slate-100 ring-1 ring-slate-200" /><span>未填报（0）</span></div>
          </div>
        </div>
      </div>}

      {records.status !== 'ready' ? <MonitorReadStatus title="团队全量明细" label="团队明细"
        message={records.status === 'error' ? records.message : undefined} retry={retryRecords} /> : <div ref={detailTableRef}>
        {filteredUserId && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#003e7e]/20 bg-[#003e7e]/5 px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] text-[#003e7e]">
              <AlertCircle size={15} />
              <span>当前仅显示 <strong className="font-semibold"><MaskedText>{filteredUserName}</MaskedText></strong> 的成交记录</span>
            </div>
            <button onClick={showAllSubmissions} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-medium text-[#003e7e] transition hover:bg-slate-50"><X size={13} /> 显示全部</button>
          </div>
        )}

        <SubmissionDetailTable submissions={displayedSubmissions} title={detailTableTitle} highlightUserId={filteredUserId} />
      </div>}
    </div>
  );
}
