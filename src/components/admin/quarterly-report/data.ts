import { supabase } from '@/src/services/supabaseClient';
import { fetchAllSubmissionPages } from '../submissionReliability';
import { buildReport, previousPeriod, type Building, type MetricRow, type Period, type User } from './model';

export async function loadReport(period: Period) {
  const previous = previousPeriod(period);
  const capturedAt = new Date().toISOString();
  // Fix the upper submission timestamp before pagination. A later insert cannot shift these pages.
  const [submissions, previousMetrics, buildings, users] = await Promise.all([
    fetchAllSubmissionPages<MetricRow>((from, to) => supabase.from('quarterly_submissions').select('*')
      .eq('record_year', period.year).eq('record_quarter', period.quarter).lte('created_at', capturedAt)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to)),
    fetchAllSubmissionPages<MetricRow>((from, to) => supabase.from('building_metrics')
      .select('id,building_id,record_year,record_quarter,created_at,updated_at,total_area,net_effective_rent,vacant_area,vacancy_rate')
      .eq('record_year', previous.year).eq('record_quarter', previous.quarter).order('id').range(from, to)),
    fetchAllSubmissionPages<Building>((from, to) => supabase.from('buildings').select('id,name,grade,submarket,sort_order').order('id').range(from, to)),
    fetchAllSubmissionPages<User>((from, to) => supabase.from('user_roles').select('user_id,chinese_name,full_name').order('user_id').range(from, to)),
  ]);
  // No user/assignment filter, current-activity filter, draft fallback or cross-quarter carry-forward.
  return buildReport({ period, submissions, previousMetrics, buildings, users, capturedAt });
}
