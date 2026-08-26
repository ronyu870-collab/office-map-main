'use client';

import * as React from 'react';
import { Users, TrendingUp, AlertCircle, X } from 'lucide-react';
import { getAllBrokers, getAllSubmissions } from '@/src/services/leaseTransactionSubmitService';
import { getSessionFast } from '@/src/services/Auth';
import type { LeaseTransaction } from '@/src/types/lease-transaction';
import { SubmissionDetailTable } from './SubmissionDetailTable';
import { MaskedText } from '@/src/components/demo';
import { isExcludedFromTeamView } from '@/src/config/demoMode';

interface TeamSubmissionMonitorProps {
  userRole: string;
}

interface WeekRange {
  weekNumber: number;
  startDate: Date;
  endDate: Date;
  label: string;
}

interface BrokerWeeklyStats {
  user_id: string;
  name: string;
  totalRequired: number;
  totalSubmitted: number;
  weeklyData: Map<number, number>;
}

function calculateWeeks(): { weeks: WeekRange[], currentWeekNumber: number } {
  const START_DATE = new Date('2026-05-04');
  START_DATE.setHours(0, 0, 0, 0);

  const now = new Date();
  now.setHours(23, 59, 59, 999);

  if (now < START_DATE) {
    return { weeks: [], currentWeekNumber: 0 };
  }

  const weeks: WeekRange[] = [];
  let weekNumber = 1;
  const currentWeekStart = new Date(START_DATE);
  const daysSinceStart = Math.floor((now.getTime() - START_DATE.getTime()) / (1000 * 60 * 60 * 24));
  const currentWeekNumber = Math.floor(daysSinceStart / 7) + 1;
  const totalWeeksToShow = currentWeekNumber + 10;

  for (let i = 0; i < totalWeeksToShow; i++) {
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const startLabel = `${currentWeekStart.getMonth() + 1}.${currentWeekStart.getDate()}`;
    const endLabel = `${weekEnd.getMonth() + 1}.${weekEnd.getDate()}`;

    weeks.push({
      weekNumber,
      startDate: new Date(currentWeekStart),
      endDate: weekEnd,
      label: `${startLabel}-${endLabel}`,
    });

    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    weekNumber++;
  }

  return { weeks, currentWeekNumber };
}

function isInWeek(dateStr: string, week: WeekRange): boolean {
  try {
    const date = new Date(dateStr);
    return date >= week.startDate && date <= week.endDate;
  } catch {
    return false;
  }
}

export function TeamSubmissionMonitor({ userRole }: TeamSubmissionMonitorProps) {
  const [loading, setLoading] = React.useState(true);
  const [stats, setStats] = React.useState<BrokerWeeklyStats[]>([]);
  const [allSubmissions, setAllSubmissions] = React.useState<LeaseTransaction[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [weeks, setWeeks] = React.useState<WeekRange[]>([]);
  const [currentWeekNumber, setCurrentWeekNumber] = React.useState<number>(0);
  const [filteredUserId, setFilteredUserId] = React.useState<string | null>(null);
  const [filteredUserName, setFilteredUserName] = React.useState<string>('');
  const detailTableRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setLoading(true);
        setError(null);

        const { weeks: weekRanges, currentWeekNumber: currentWeek } = calculateWeeks();
        setWeeks(weekRanges);
        setCurrentWeekNumber(currentWeek);

        const session = await getSessionFast();
        if (!session) throw new Error('未登录');

        const [brokers, rawSubmissions] = await Promise.all([
          getAllBrokers(),
          getAllSubmissions(userRole),
        ]);
        const submissions = rawSubmissions as LeaseTransaction[];

        if (cancelled) return;
        setAllSubmissions(submissions);

        const filteredBrokers = brokers.filter(broker => !isExcludedFromTeamView(broker.name));
        const aggregated: BrokerWeeklyStats[] = filteredBrokers.map((broker) => {
          const userSubmissions = submissions.filter((s) => s.submitter_id === broker.user_id);
          const weeklyData = new Map<number, number>();
          weekRanges.forEach((week) => {
            const count = userSubmissions.filter((s) => isInWeek(s.created_at || '', week)).length;
            weeklyData.set(week.weekNumber, count);
          });

          const totalRequired = Math.max(0, currentWeek - 1) * 2;
          const totalSubmitted = userSubmissions.length;

          return {
            user_id: broker.user_id,
            name: broker.name,
            totalRequired,
            totalSubmitted,
            weeklyData,
          };
        });

        aggregated.sort((a, b) => b.totalSubmitted - a.totalSubmitted);
        setStats(aggregated);
      } catch (err) {
        console.error('加载团队监控数据失败:', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userRole]);

  const filterByBroker = (broker: BrokerWeeklyStats) => {
    setFilteredUserId(broker.user_id);
    setFilteredUserName(broker.name);
    setTimeout(() => {
      detailTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const showAllSubmissions = () => {
    setFilteredUserId(null);
    setFilteredUserName('');
  };

  const displayedSubmissions = React.useMemo(() => {
    const base = filteredUserId
      ? allSubmissions.filter((s) => s.submitter_id === filteredUserId)
      : allSubmissions;
    return base.filter((s) => !isExcludedFromTeamView(s.submitter_name));
  }, [allSubmissions, filteredUserId]);

  const detailTableTitle = filteredUserId
    ? `${filteredUserName} 的成交填报明细`
    : '团队全量明细';

  const renderWeekCell = (count: number) => {
    let bgColor = 'bg-zinc-100';
    let textColor = 'text-zinc-400';

    if (count >= 2) {
      bgColor = 'bg-emerald-100';
      textColor = 'text-emerald-700';
    } else if (count === 1) {
      bgColor = 'bg-amber-100';
      textColor = 'text-amber-700';
    }

    return (
      <div className={`${bgColor} ${textColor} rounded-[4px] px-2 py-0.5 text-center text-xs font-semibold tabular-nums`}>
        {count}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="rounded-[8px] border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2.5">
          <Users className="text-zinc-400" size={17} />
          <h3 className="text-sm font-semibold text-zinc-700">团队提交监控</h3>
        </div>
        <div className="flex items-center justify-center py-10">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-200 border-t-[#003e7e]" />
          <p className="ml-3 text-xs text-zinc-500">正在加载…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[8px] border border-red-200 bg-red-50 p-5 shadow-sm">
        <div className="mb-2 flex items-center gap-2.5">
          <AlertCircle className="text-red-600" size={17} />
          <h3 className="text-sm font-semibold text-red-700">加载失败</h3>
        </div>
        <p className="text-xs text-red-600">{error}</p>
      </div>
    );
  }

  const totalBrokers = stats.length;
  const compliantCount = stats.filter((s) => (s.weeklyData.get(currentWeekNumber) ?? 0) >= 2).length;
  const complianceRate = totalBrokers > 0 ? Math.round((compliantCount / totalBrokers) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[8px] border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Users className="text-[#003e7e]" size={17} />
              <h3 className="text-sm font-semibold text-zinc-900">团队提交监控</h3>
              <span className="rounded-[4px] border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-medium text-zinc-500">周视图</span>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <TrendingUp size={14} className="text-emerald-600" />
                <span className="text-zinc-500">本周达标率</span>
                <span className="font-semibold tabular-nums text-emerald-700">{complianceRate}%</span>
              </div>
              <div className="text-zinc-400">{compliantCount} / {totalBrokers} 人</div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50">
                <th className="sticky left-0 z-10 border-r border-zinc-200 bg-zinc-50 px-4 py-2.5 text-left text-[10px] font-semibold text-zinc-500">姓名</th>
                <th className="border-r border-zinc-200 px-3 py-2.5 text-center text-[10px] font-semibold text-zinc-500">应填数量</th>
                <th className="border-r border-zinc-200 px-3 py-2.5 text-center text-[10px] font-semibold text-zinc-500">已填数量</th>
                {weeks.length === 0 ? (
                  <th className="px-3 py-2.5 text-center text-[10px] text-zinc-400">暂无周数据（统计起始：2026-05-04）</th>
                ) : (
                  weeks.map((week) => (
                    <th key={week.weekNumber} className="px-2 py-2 text-center text-[10px] font-semibold text-zinc-500" title={week.label}>
                      <div>第 {week.weekNumber} 周</div>
                      <div className="mt-0.5 text-[9px] font-normal text-zinc-400">{week.label}</div>
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr><td colSpan={3 + weeks.length} className="px-4 py-8 text-center text-zinc-400">暂无业务员数据</td></tr>
              ) : (
                stats.map((broker, idx) => (
                  <tr key={broker.user_id} className={`transition-colors hover:bg-zinc-50/70 ${idx !== stats.length - 1 ? 'border-b border-zinc-100' : ''}`}>
                    <td className="sticky left-0 z-10 whitespace-nowrap border-r border-zinc-100 bg-white px-4 py-2.5">
                      <button onClick={() => filterByBroker(broker)} className="whitespace-nowrap text-xs font-medium text-[#003e7e] underline-offset-2 transition-colors hover:underline" title="查看成交明细">
                        <MaskedText>{broker.name}</MaskedText>
                      </button>
                    </td>
                    <td className="border-r border-zinc-100 px-3 py-2.5 text-center"><span className="text-xs font-medium tabular-nums text-zinc-700">{broker.totalRequired}</span></td>
                    <td className="border-r border-zinc-100 px-3 py-2.5 text-center">
                      <span className={`text-xs font-bold tabular-nums ${broker.totalRequired === 0 ? 'text-zinc-500' : broker.totalSubmitted >= broker.totalRequired ? 'text-emerald-600' : 'text-amber-600'}`}>{broker.totalSubmitted}</span>
                    </td>
                    {weeks.length === 0 ? (
                      <td className="px-3 py-2.5 text-center text-xs text-zinc-400">-</td>
                    ) : (
                      weeks.map((week) => <td key={week.weekNumber} className="px-2 py-2 text-center" title={week.label}>{renderWeekCell(broker.weeklyData.get(week.weekNumber) || 0)}</td>)
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-zinc-200 bg-zinc-50/70 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[10px] text-zinc-500">每周目标 2 条 · 当前第 {currentWeekNumber} 周 · 应填数量按已完成周数计算 · 点击姓名查看明细</p>
            <div className="flex flex-wrap items-center gap-3 text-[10px]">
              <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded-[3px] bg-emerald-100" /><span className="text-zinc-500">已达标（≥2）</span></div>
              <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded-[3px] bg-amber-100" /><span className="text-zinc-500">待补充（=1）</span></div>
              <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded-[3px] bg-zinc-100" /><span className="text-zinc-500">未填报（=0）</span></div>
            </div>
          </div>
        </div>
      </div>

      <div ref={detailTableRef}>
        {filteredUserId && (
          <div className="mb-3 flex items-center justify-between rounded-[6px] border border-[#003e7e]/20 bg-[#003e7e]/5 px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs text-[#003e7e]">
              <AlertCircle size={15} />
              <span>当前仅显示 <strong className="font-semibold"><MaskedText>{filteredUserName}</MaskedText></strong> 的成交记录</span>
            </div>
            <button onClick={showAllSubmissions} className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#003e7e] transition hover:bg-zinc-50">
              <X size={13} /> 显示全部
            </button>
          </div>
        )}

        <SubmissionDetailTable submissions={displayedSubmissions} title={detailTableTitle} highlightUserId={filteredUserId} />
      </div>
    </div>
  );
}
