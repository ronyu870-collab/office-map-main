'use client';

import * as React from 'react';
import { Users, TrendingUp, AlertCircle, ChevronDown, X } from 'lucide-react';
import { getAllBrokers, getAllSubmissions } from '@/src/services/leaseTransactionSubmitService';
import { SubmissionDetailTable } from './SubmissionDetailTable';
import { MaskedText } from '@/src/components/demo';
import { isExcludedFromTeamView } from '@/src/config/demoMode';
import { aggregateTeamWeeks, calculateTeamWeeks, type BrokerWeeklyStats, type WeekRange } from '../teamMonitoringStats';
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
  const [allWeeksVisible, setAllWeeksVisible] = React.useState(false);
  const weekTableId = React.useId();
  const weekScrollRef = React.useRef<HTMLDivElement>(null);
  const detailTableRef = React.useRef<HTMLElement>(null);
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
      <div className={`${bgColor} ${textColor} inline-block min-w-6 rounded px-2 py-0.5 text-center text-xs font-semibold tabular-nums sm:block`}>
        {count}
      </div>
    );
  };

  const totalBrokers = stats?.length ?? 0;
  const compliantCount = stats?.filter((s) => (s.weeklyData.get(currentWeekNumber) ?? 0) >= 2).length ?? 0;
  const complianceRate = totalBrokers > 0 ? Math.round((compliantCount / totalBrokers) * 100) : 0;
  const currentWeek = weeks.find((week) => week.weekNumber === currentWeekNumber);
  const compactWeekColumn = (week: WeekRange) => allWeeksVisible ? ''
    : week.weekNumber === currentWeekNumber ? 'max-sm:w-14' : 'hidden sm:table-cell';

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
          <div className="flex flex-wrap items-center justify-between gap-3 max-sm:gap-2">
            <div className="flex items-center gap-2.5">
              <Users aria-hidden="true" className="hidden text-[#003e7e] sm:block" size={17} />
              <h3 className="text-sm font-semibold text-slate-900">团队周度提交情况</h3>
            </div>
            {weeks.length > 1 && (
              <button
                type="button"
                aria-expanded={allWeeksVisible}
                aria-controls={weekTableId}
                onClick={() => {
                  if (allWeeksVisible && weekScrollRef.current) weekScrollRef.current.scrollLeft = 0;
                  setAllWeeksVisible(!allWeeksVisible);
                }}
                className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-[var(--cd-color-brand)] hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[var(--cd-color-brand)] sm:hidden"
              >
                {allWeeksVisible ? '收起各周' : '全部周次'}
                <ChevronDown aria-hidden="true" size={14} className={allWeeksVisible ? 'rotate-180' : ''} />
              </button>
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-slate-600 max-sm:w-full sm:text-[11px]">
              {currentWeek && <span className="tabular-nums sm:hidden">第 {currentWeek.weekNumber} 周 · {currentWeek.label}</span>}
              <div className="flex items-center gap-1.5 sm:gap-3">
                <TrendingUp aria-hidden="true" size={14} className="hidden text-emerald-600 sm:block" />
                <span>本周达标率 <strong className="font-semibold tabular-nums text-emerald-700">{complianceRate}%</strong></span>
                <span className="tabular-nums">{compliantCount} / {totalBrokers} 人</span>
              </div>
            </div>
          </div>
        </div>

        {allWeeksVisible && (
          <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-600 sm:hidden">左右滑动查看各周，姓名列保持可见</p>
        )}
        <div
          id={weekTableId}
          ref={weekScrollRef}
          role="region"
          aria-label="周度统计"
          tabIndex={allWeeksVisible ? 0 : undefined}
          className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--cd-color-brand)]"
        >
          <table aria-label="团队周度提交明细" className={`w-full ${allWeeksVisible ? 'min-w-max' : 'table-fixed sm:min-w-max sm:table-auto'}`}>
            <thead className="bg-slate-50/80">
              <tr className="border-b border-slate-200">
                <th scope="col" className="sticky left-0 z-10 border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-xs font-medium text-slate-600 sm:border-r sm:text-[10px] sm:font-semibold">姓名</th>
                <th scope="col" className="border-slate-200 px-2 py-2.5 text-right text-xs font-medium text-slate-600 max-sm:w-16 sm:border-r sm:px-3 sm:text-center sm:text-[10px] sm:font-semibold">应填数量</th>
                <th scope="col" className="border-slate-200 px-2 py-2.5 text-right text-xs font-medium text-slate-600 max-sm:w-16 sm:border-r sm:px-3 sm:text-center sm:text-[10px] sm:font-semibold">已填数量</th>
                {weeks.length === 0 ? (
                  <th scope="col" className="px-2 py-2.5 text-right text-xs text-slate-500 max-sm:w-16 sm:px-3 sm:text-center sm:text-[10px]">暂无周数据</th>
                ) : (
                  weeks.map((week) => (
                    <th key={week.weekNumber} scope="col" className={`px-2 py-2 text-xs font-medium text-slate-600 max-sm:pr-4 max-sm:text-right sm:text-center sm:text-[10px] sm:font-semibold ${compactWeekColumn(week)}`}>
                      {!allWeeksVisible && week.weekNumber === currentWeekNumber && <div className="sm:hidden">本周</div>}
                      <div className={!allWeeksVisible && week.weekNumber === currentWeekNumber ? 'hidden sm:block' : ''}>
                        第 {week.weekNumber} 周
                        <div className="mt-0.5 font-normal tabular-nums text-slate-500 sm:text-[10px]">{week.label}</div>
                      </div>
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr><td colSpan={3 + Math.max(1, weeks.length)} className="px-4 py-8 text-left text-xs text-slate-500 sm:text-center">暂无团队成员数据</td></tr>
              ) : (
                stats.map((broker, idx) => (
                  <tr key={broker.user_id} className={`transition-colors hover:bg-slate-50/60 ${idx !== stats.length - 1 ? 'border-b border-slate-100' : ''} ${filteredUserId === broker.user_id ? 'max-sm:bg-slate-50' : ''}`}>
                    <td className={`sticky left-0 z-10 border-slate-100 bg-white px-4 max-sm:pr-2 sm:whitespace-nowrap sm:border-r sm:py-2.5 ${allWeeksVisible ? 'max-sm:max-w-36 max-sm:border-r' : ''} ${filteredUserId === broker.user_id ? 'max-sm:bg-slate-50' : ''}`}>
                      <button type="button" aria-current={filteredUserId === broker.user_id || undefined} onClick={() => filterByBroker(broker)} className="rounded-sm text-left text-[13px] font-medium text-[var(--cd-color-brand)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--cd-color-brand)] max-sm:min-h-11 max-sm:min-w-11 max-sm:py-1.5 max-sm:underline max-sm:decoration-current/25 max-sm:underline-offset-2 max-sm:[overflow-wrap:anywhere] sm:text-[11px] sm:font-semibold [@media(pointer:coarse)]:min-h-11" title="查看成交明细"><MaskedText>{broker.name}</MaskedText></button>
                    </td>
                    <td className="border-slate-100 px-2 py-2.5 text-right sm:border-r sm:px-3 sm:text-center"><span className="text-[13px] tabular-nums text-slate-700 sm:text-[11px] sm:font-medium">{broker.totalRequired}</span></td>
                    <td className="border-slate-100 px-2 py-2.5 text-right sm:border-r sm:px-3 sm:text-center">
                      <span className={`text-[13px] tabular-nums sm:text-[11px] sm:font-bold ${broker.totalRequired === 0 ? 'text-slate-500' : broker.totalSubmitted >= broker.totalRequired ? 'text-emerald-700' : 'text-amber-700'}`}>{broker.totalSubmitted}</span>
                    </td>
                    {weeks.length === 0 ? (
                      <td className="px-3 py-2.5 text-center text-[10px] text-slate-400">-</td>
                    ) : (
                      weeks.map((week) => <td key={week.weekNumber} className={`px-2 py-2 max-sm:pr-4 max-sm:text-right sm:text-center ${compactWeekColumn(week)}`}>{renderWeekCell(broker.weeklyData.get(week.weekNumber) || 0)}</td>)
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:text-[10px]">
          <p>每周目标 2 条 · 应填数量按已结束的周计算 <span className="max-sm:block">统计起始 2026-05-04<span className="hidden sm:inline"> · 当前第 {currentWeekNumber} 周</span></span></p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded bg-emerald-100" /><span>已达标 ≥2</span></div>
            <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded bg-amber-100" /><span>待补充 1</span></div>
            <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded bg-slate-100 ring-1 ring-slate-200" /><span>未填报 0</span></div>
          </div>
        </div>
      </div>}

      {records.status !== 'ready' ? <MonitorReadStatus title="团队全量明细" label="团队明细"
        message={records.status === 'error' ? records.message : undefined} retry={retryRecords} /> : <section ref={detailTableRef} aria-label="成交明细" className="scroll-mt-[calc(var(--cd-header-height)+0.75rem)]">
        {filteredUserId && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-[#003e7e]/20 bg-[#003e7e]/5 px-4 py-1 sm:py-3">
            <div className="flex min-w-0 items-center gap-2 text-[13px] text-[#003e7e] sm:text-[11px]">
              <AlertCircle aria-hidden="true" size={15} className="hidden shrink-0 sm:block" />
              <span className="sm:hidden">已按顾问筛选</span>
              <span className="hidden [overflow-wrap:anywhere] sm:inline">当前仅显示 <strong className="font-semibold"><MaskedText>{filteredUserName}</MaskedText></strong> 的成交记录</span>
            </div>
            <button type="button" onClick={showAllSubmissions} className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-[#003e7e] hover:bg-white focus-visible:outline-2 focus-visible:outline-[var(--cd-color-brand)] max-sm:min-h-11 sm:border sm:border-slate-200 sm:bg-white sm:py-1.5 sm:text-[10px] [@media(pointer:coarse)]:min-h-11"><X aria-hidden="true" size={13} /> 显示全部</button>
          </div>
        )}

        <SubmissionDetailTable submissions={displayedSubmissions} title={detailTableTitle} highlightUserId={filteredUserId} />
      </section>}
    </div>
  );
}
