import * as React from 'react';
import { supabase } from '@/src/services/supabaseClient';
import { parseSubmissionPeriod } from './submissionReliability';

/** A result belongs only to its exact filter key; stale responses never replace it. */
export function useSubmissionRead<T>(key: string, read: () => Promise<T>, enabled = true) {
  const [retry, setRetry] = React.useState(0);
  const [state, setState] = React.useState<{ key: string; data?: T; error?: string }>({ key: '' });
  React.useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState({ key });
    void read().then(data => { if (active) setState({ key, data }); }, error => { if (active) setState({ key, error: error instanceof Error ? error.message : '读取失败，请重试' }); });
    return () => { active = false; };
    // Each caller supplies every query parameter in key. The callback intentionally
    // does not retrigger a network read on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, retry]);
  const current = state.key === key ? state : { key };
  return { data: current.data, error: current.error, loading: enabled && current.data === undefined && !current.error, reload: () => setRetry(n => n + 1) };
}

export function useSubmissionPeriod() {
  const now = new Date();
  const [period, setPeriod] = React.useState({ year: now.getFullYear(), quarter: Math.ceil((now.getMonth() + 1) / 3) });
  const touched = React.useRef(false);
  const configured = useSubmissionRead('configured-quarter', async () => {
    const { data, error } = await supabase.from('app_settings').select('key,value').in('key', ['current_submission_year', 'current_submission_quarter']);
    if (error) throw error;
    return parseSubmissionPeriod(data || []);
  });
  const selected = !touched.current && configured.data ? configured.data : period;
  return { ...selected, configured, setYear: (year: number) => { const base = touched.current ? undefined : configured.data; touched.current = true; setPeriod(p => ({ ...(base || p), year })); }, setQuarter: (quarter: number) => { const base = touched.current ? undefined : configured.data; touched.current = true; setPeriod(p => ({ ...(base || p), quarter })); } };
}
