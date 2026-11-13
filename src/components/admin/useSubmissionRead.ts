import * as React from 'react';
import { supabase } from '@/src/services/supabaseClient';
import { parseSubmissionPeriod } from './submissionReliability';

/** A result belongs only to its exact filter key; stale responses never replace it. */
export function useSubmissionRead<T>(key: string, read: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const [retry, setRetry] = React.useState(0);
  const [state, setState] = React.useState<{ key: string; data?: T; error?: string }>({ key: '' });
  React.useEffect(() => {
    if (!enabled) return;
    let active = true;
    const request = new AbortController();
    setState({ key });
    void read(request.signal).then(data => { if (active) setState({ key, data }); }, error => { if (active) setState({ key, error: error instanceof Error ? error.message : '读取失败，请重试' }); });
    return () => { active = false; request.abort(); };
    // Each caller supplies every query parameter in key. The callback intentionally
    // does not retrigger a network read on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, retry]);
  const current = state.key === key ? state : { key };
  return { data: current.data, error: current.error, loading: enabled && current.data === undefined && !current.error, reload: () => setRetry(n => n + 1) };
}

export function useSubmissionPeriod() {
  const [calendarPeriod] = React.useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), quarter: Math.ceil((now.getMonth() + 1) / 3) };
  });
  const [manualPeriod, setManualPeriod] = React.useState<typeof calendarPeriod | null>(null);
  const configured = useSubmissionRead('configured-quarter', async () => {
    const { data, error } = await supabase.from('app_settings').select('key,value').in('key', ['current_submission_year', 'current_submission_quarter']);
    if (error) throw error;
    return parseSubmissionPeriod(data || []);
  });
  const defaultPeriod = configured.data ?? calendarPeriod;
  return {
    ...(manualPeriod ?? defaultPeriod),
    configured,
    ready: manualPeriod !== null || !configured.loading,
    setYear: (year: number) => setManualPeriod(previous => ({ ...(previous ?? defaultPeriod), year })),
    setQuarter: (quarter: number) => setManualPeriod(previous => ({ ...(previous ?? defaultPeriod), quarter })),
  };
}
