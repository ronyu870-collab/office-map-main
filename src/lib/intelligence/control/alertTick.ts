import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

let nextTick = 0;
/** Response work only. Database coalescing also bounds independent instances.
 * No model probes, browser timer, actor grants or business records are involved. */
export function scheduleOperationalAlerts(client: SupabaseClient) {
  if (Date.now() < nextTick) return;
  nextTick = Date.now() + 60_000;
  after(async () => {
    try {
      const result = await client.rpc('ai_control_alert_tick', {}).abortSignal(AbortSignal.timeout(3500));
      if (result.error && !(['PGRST202', '42883'].includes(result.error.code) && /ai_control_alert_tick/.test(result.error.message)))
        console.warn('AI_CONTROL_ALERT_TICK_UNAVAILABLE');
    } catch { console.warn('AI_CONTROL_ALERT_TICK_UNAVAILABLE'); }
  });
}
