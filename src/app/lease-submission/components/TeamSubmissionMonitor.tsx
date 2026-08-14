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
  totalRequired: number; // 应填数量（从5月4日开始到现在的周数 * 2）
  totalSubmitted: number; // 已填数量（从5月4日开始的总提交数）
  weeklyData: Map<number, number>; // 每周的提交数量
}

/**
 * 计算从起始日期（2026-05-04）开始的所有周
 * 包括：已经过去的周 + 当前周 + 未来几周（预留显示）
 * 
 * @returns { weeks: WeekRange[], currentWeekNumber: number }
 */
function calculateWeeks(): { weeks: WeekRange[], currentWeekNumber: number } {
  const START_DATE = new Date('2026-05-04'); // Week 1 起始日期
  START_DATE.setHours(0, 0, 0, 0);
  
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  
  // 如果当前日期还没到起始日期，返回空数组
  if (now < START_DATE) {
    return { weeks: [], currentWeekNumber: 0 };
  }
  
  const weeks: WeekRange[] = [];
  let weekNumber = 1;
  const currentWeekStart = new Date(START_DATE);
  
  // 计算当前是第几周
  const daysSinceStart = Math.floor((now.getTime() - START_DATE.getTime()) / (1000 * 60 * 60 * 24));
  const currentWeekNumber = Math.floor(daysSinceStart / 7) + 1;
  
  // 显示从 Week 1 到当前周 + 未来 10 周
  const totalWeeksToShow = currentWeekNumber + 10;
  
  for (let i = 0; i < totalWeeksToShow; i++) {
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    
    // 格式化日期标签
    const startLabel = `${currentWeekStart.getMonth() + 1}.${currentWeekStart.getDate()}`;
    const endLabel = `${weekEnd.getMonth() + 1}.${weekEnd.getDate()}`;

    weeks.push({
      weekNumber,
      startDate: new Date(currentWeekStart),
      endDate: weekEnd,
      label: `${startLabel}-${endLabel}`,
    });
    
    // 移动到下一周
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    weekNumber++;
  }
  
  // 正序排列：Week 1, Week 2, Week 3...
  return { weeks, currentWeekNumber };
}

/**
 * 判断日期是否在指定周内
 */
function isInWeek(dateStr: string, week: WeekRange): boolean {
  try {
    const date = new Date(dateStr);
    return date >= week.startDate && date <= week.endDate;
  } catch {
    return false;
  }
}

/**
 * 团队提交监控面板 - 周视图模式
 *
 * 功能：
 * - 表格列：姓名 | 应填数量 | 已填数量 | Week 1 | Week 2 | ... | Week N
 * - 应填数量 = 周数 * 2（每周目标2条）
 * - 已填数量 = 从5月4日开始的总提交数
 * - 每周单元格显示该周的提交数量，颜色编码：>= 2 绿色，= 1 黄色，= 0 灰色
 * - 鼠标悬停在 Week 列头显示具体日期范围
 */
export function TeamSubmissionMonitor({ userRole }: TeamSubmissionMonitorProps) {
  const [loading, setLoading] = React.useState(true);
  const [stats, setStats] = React.useState<BrokerWeeklyStats[]>([]);
  const [allSubmissions, setAllSubmissions] = React.useState<LeaseTransaction[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [weeks, setWeeks] = React.useState<WeekRange[]>([]);
  const [currentWeekNumber, setCurrentWeekNumber] = React.useState<number>(0);

  // 明细表过滤状态
  const [filteredUserId, setFilteredUserId] = React.useState<string | null>(null);
  const [filteredUserName, setFilteredUserName] = React.useState<string>('');

  // 用于滚动到明细表的 ref
  const detailTableRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setLoading(true);
        setError(null);

        // 计算周范围
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

        // 保留全量数据供明细表使用
        setAllSubmissions(submissions);

        // 过滤掉演示/测试账号
        const filteredBrokers = brokers.filter(broker => !isExcludedFromTeamView(broker.name));

        // 聚合统计
        const aggregated: BrokerWeeklyStats[] = filteredBrokers.map((broker) => {
          const userSubmissions = submissions.filter(
            (s) => s.submitter_id === broker.user_id
          );

          // 计算每周的提交数量
          const weeklyData = new Map<number, number>();
          weekRanges.forEach((week) => {
            const count = userSubmissions.filter((s) =>
              isInWeek(s.created_at || '', week)
            ).length;
            weeklyData.set(week.weekNumber, count);
          });

          // 🔥 应填数量 = 已完成周数 * 2（当前周未结束不计入要求）
          const totalRequired = Math.max(0, currentWeek - 1) * 2;
          // 已填数量 = 从起始日期开始的总提交数
          const totalSubmitted = userSubmissions.length;

          return {
            user_id: broker.user_id,
            name: broker.name,
            totalRequired,
            totalSubmitted,
            weeklyData,
          };
        });

        // 按已填数量降序排序
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

  // 打开某个 Broker 的明细（过滤显示）
  const filterByBroker = (broker: BrokerWeeklyStats) => {
    setFilteredUserId(broker.user_id);
    setFilteredUserName(broker.name);
    // 平滑滚动到明细表
    setTimeout(() => {
      detailTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  // 显示全部明细
  const showAllSubmissions = () => {
    setFilteredUserId(null);
    setFilteredUserName('');
  };

  // 计算要显示的明细数据（过滤演示账号）
  const displayedSubmissions = React.useMemo(() => {
    const base = filteredUserId
      ? allSubmissions.filter((s) => s.submitter_id === filteredUserId)
      : allSubmissions;
    return base.filter((s) => !isExcludedFromTeamView(s.submitter_name));
  }, [allSubmissions, filteredUserId]);

  // 计算明细表标题
  const detailTableTitle = filteredUserId
    ? `${filteredUserName} 的成交填报明细`
    : '团队全量明细';

  // 渲染周单元格
  const renderWeekCell = (count: number) => {
    let bgColor = 'bg-gray-100'; // 未填报
    let textColor = 'text-gray-400';
    
    if (count >= 2) {
      bgColor = 'bg-emerald-100'; // 已达标
      textColor = 'text-emerald-700';
    } else if (count === 1) {
      bgColor = 'bg-amber-100'; // 待补充
      textColor = 'text-amber-700';
    }
    
    return (
      <div className={`${bgColor} ${textColor} rounded px-2 py-0.5 text-center text-sm font-semibold tabular-nums`}>
        {count}
      </div>
    );
  };

  // 加载状态
  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-100/50 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <Users className="text-gray-400" size={20} />
          <h3 className="text-base font-semibold text-gray-700">团队提交监控</h3>
        </div>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-[#003e7e]"></div>
          <p className="ml-3 text-sm text-gray-500">加载中...</p>
        </div>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          <AlertCircle className="text-red-600" size={20} />
          <h3 className="text-base font-semibold text-red-700">加载失败</h3>
        </div>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  // 计算当周达标率（当周提交 >= 2 的人数 / 总人数）
  const totalBrokers = stats.length;
  const compliantCount = stats.filter((s) => (s.weeklyData.get(currentWeekNumber) ?? 0) >= 2).length;
  const complianceRate =
    totalBrokers > 0 ? Math.round((compliantCount / totalBrokers) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* ========== 上半部分：团队提交监控周视图 ========== */}
      <div className="rounded-2xl border border-gray-100/50 bg-white shadow-sm overflow-hidden">
        {/* 头部 */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Users className="text-[#003e7e]" size={20} />
              <h3 className="text-base font-semibold text-gray-900">团队提交监控</h3>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                周视图
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <TrendingUp size={16} className="text-emerald-600" />
                <span className="text-gray-600">达标率</span>
                <span className="font-semibold text-emerald-600">{complianceRate}%</span>
              </div>
              <div className="text-gray-500">
                {compliantCount} / {totalBrokers} 人
              </div>
            </div>
          </div>
        </div>

        {/* 表格 */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 border-r border-gray-100">
                  姓名
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500 border-r border-gray-100">
                  应填数量
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500 border-r border-gray-100">
                  已填数量
                </th>
                {/* Week 列正序显示：Week 1, Week 2, Week 3... */}
                {weeks.length === 0 ? (
                  <th className="px-3 py-3 text-center text-xs text-gray-400">
                    暂无周数据（统计起始：2026-05-04）
                  </th>
                ) : (
                  weeks.map((week) => (
                    <th
                      key={week.weekNumber}
                      className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                      title={week.label}
                    >
                      <div>W{week.weekNumber}</div>
                      <div className="text-[10px] font-normal normal-case text-gray-400">{week.label}</div>
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr>
                  <td colSpan={3 + weeks.length} className="px-4 py-8 text-center text-gray-500">
                    暂无业务员数据
                  </td>
                </tr>
              ) : (
                stats.map((broker, idx) => (
                  <tr
                    key={broker.user_id}
                    className={`transition-colors hover:bg-gray-50/50 ${
                      idx !== stats.length - 1 ? 'border-b border-gray-100' : ''
                    }`}
                  >
                    {/* 姓名列 - 固定在左侧 */}
                    <td className="sticky left-0 z-10 bg-white px-4 py-3 border-r border-gray-100 whitespace-nowrap">
                      <button
                        onClick={() => filterByBroker(broker)}
                        className="font-medium text-sm text-[#003e7e] underline-offset-2 hover:underline transition-colors whitespace-nowrap"
                        title="查看成交明细"
                      >
                        <MaskedText>{broker.name}</MaskedText>
                      </button>
                    </td>
                    
                    {/* 应填数量 */}
                    <td className="px-3 py-3 text-center border-r border-gray-100">
                      <span className="text-sm font-medium text-gray-700 tabular-nums">
                        {broker.totalRequired}
                      </span>
                    </td>
                    
                    {/* 已填数量 */}
                    <td className="px-3 py-3 text-center border-r border-gray-100">
                      <span
                        className={`text-sm font-bold tabular-nums ${
                          broker.totalRequired === 0
                            ? 'text-gray-500'
                            : broker.totalSubmitted >= broker.totalRequired
                            ? 'text-emerald-600'
                            : 'text-amber-600'
                        }`}
                      >
                        {broker.totalSubmitted}
                      </span>
                    </td>
                    
                    {/* 各周数据 - 正序显示：Week 1, Week 2, Week 3... */}
                    {weeks.length === 0 ? (
                      <td className="px-3 py-3 text-center text-gray-400 text-xs">
                        -
                      </td>
                    ) : (
                      weeks.map((week) => (
                        <td key={week.weekNumber} className="px-2 py-2 text-center" title={week.label}>
                          {renderWeekCell(broker.weeklyData.get(week.weekNumber) || 0)}
                        </td>
                      ))
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 底部说明 */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              💡 每周目标：2 条 · 统计起始：2026-05-04 · 当前第 {currentWeekNumber} 周 · 应填数量 = 当前周数 × 2 · 点击姓名查看明细
            </p>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-emerald-100"></div>
                <span className="text-gray-600">已达标 (≥2)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-amber-100"></div>
                <span className="text-gray-600">待补充 (=1)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-gray-100"></div>
                <span className="text-gray-600">未填报 (=0)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ========== 下半部分：团队全量明细表 ========== */}
      <div ref={detailTableRef}>
        {/* 过滤提示条（当过滤时显示） */}
        {filteredUserId && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-[#003e7e]/20 bg-[#003e7e]/5 px-5 py-3.5">
            <div className="flex items-center gap-2.5 text-sm text-[#003e7e]">
              <AlertCircle size={18} />
              <span>
                当前仅显示 <strong className="font-semibold"><MaskedText>{filteredUserName}</MaskedText></strong> 的成交记录
              </span>
            </div>
            <button
              onClick={showAllSubmissions}
              className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-[#003e7e] shadow-sm transition hover:bg-gray-50"
            >
              <X size={16} />
              显示全部
            </button>
          </div>
        )}

        <SubmissionDetailTable
          submissions={displayedSubmissions}
          title={detailTableTitle}
          highlightUserId={filteredUserId}
        />
      </div>
    </div>
  );
}
