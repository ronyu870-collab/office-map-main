import { isExcludedFromTeamView } from '@/src/config/demoMode';
import type { LeaseTransaction } from '@/src/types/lease-transaction';

export interface TeamBroker {
  user_id: string;
  name: string;
}

interface WeekRange {
  weekNumber: number;
  startDate: Date;
  endDate: Date;
  label: string;
}

export interface BrokerWeeklyStats extends TeamBroker {
  totalRequired: number;
  totalSubmitted: number;
  weeklyData: Map<number, number>;
}

export function calculateTeamWeeks(asOf = new Date()): { weeks: WeekRange[]; currentWeekNumber: number } {
  const startDate = new Date('2026-05-04');
  startDate.setHours(0, 0, 0, 0);
  const now = new Date(asOf);
  now.setHours(23, 59, 59, 999);
  if (now < startDate) return { weeks: [], currentWeekNumber: 0 };

  const weeks: WeekRange[] = [];
  const weekStart = new Date(startDate);
  const daysSinceStart = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const currentWeekNumber = Math.floor(daysSinceStart / 7) + 1;

  for (let weekNumber = 1; weekNumber <= currentWeekNumber + 10; weekNumber++) {
    const endDate = new Date(weekStart);
    endDate.setDate(endDate.getDate() + 6);
    endDate.setHours(23, 59, 59, 999);
    weeks.push({
      weekNumber, startDate: new Date(weekStart), endDate,
      label: `${weekStart.getMonth() + 1}.${weekStart.getDate()}-${endDate.getMonth() + 1}.${endDate.getDate()}`,
    });
    weekStart.setDate(weekStart.getDate() + 7);
  }
  return { weeks, currentWeekNumber };
}

export function aggregateTeamWeeks(
  brokers: TeamBroker[],
  submissions: Pick<LeaseTransaction, 'submitter_id' | 'created_at'>[],
  weeks: WeekRange[],
  currentWeek: number,
): BrokerWeeklyStats[] {
  const totalRequired = Math.max(0, currentWeek - 1) * 2;
  const activeBrokers = brokers.filter(({ name }) => !isExcludedFromTeamView(name));
  const counts = new Map(activeBrokers.map(({ user_id }) => [user_id, { total: 0, weekly: new Map<number, number>() }]));
  const bounds = weeks.map(({ startDate, endDate, weekNumber }) => ({ start: startDate.getTime(), end: endDate.getTime(), weekNumber }));

  for (const submission of submissions) {
    const owner = submission.submitter_id ? counts.get(submission.submitter_id) : undefined;
    if (!owner) continue;
    owner.total++;
    if (!submission.created_at || bounds.length === 0) continue;
    const timestamp = Date.parse(submission.created_at);
    if (!Number.isFinite(timestamp)) continue;

    // Find the first week whose inclusive end is at or after this timestamp.
    let low = 0;
    let high = bounds.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (timestamp > bounds[middle].end) low = middle + 1;
      else high = middle;
    }
    const week = bounds[low];
    if (week && timestamp >= week.start) {
      owner.weekly.set(week.weekNumber, (owner.weekly.get(week.weekNumber) ?? 0) + 1);
    }
  }

  return activeBrokers.map((broker) => {
    const { total, weekly } = counts.get(broker.user_id)!;
    return { ...broker, totalRequired, totalSubmitted: total, weeklyData: weekly };
  }).sort((a, b) => b.totalSubmitted - a.totalSubmitted);
}
