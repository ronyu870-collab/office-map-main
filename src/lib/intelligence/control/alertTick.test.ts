import { afterEach,expect,it,vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const {after}=vi.hoisted(()=>({after:vi.fn()}));
vi.mock('next/server',()=>({after}));
afterEach(()=>{vi.useRealTimers();vi.resetModules();after.mockClear();});
it('schedules a bounded response callback once a minute, with no synchronous RPC or model probe',async()=>{
 vi.useFakeTimers();const {scheduleOperationalAlerts}=await import('./alertTick');
 const rpc=vi.fn(()=>({abortSignal:vi.fn(async()=>({data:{evaluated:true},error:null}))})),client={rpc} as unknown as SupabaseClient;
 scheduleOperationalAlerts(client);scheduleOperationalAlerts(client);expect(after).toHaveBeenCalledTimes(1);expect(rpc).not.toHaveBeenCalled();
 await after.mock.calls[0][0]();expect(rpc).toHaveBeenCalledExactlyOnceWith('ai_control_alert_tick',{});
 await vi.advanceTimersByTimeAsync(60001);scheduleOperationalAlerts(client);expect(after).toHaveBeenCalledTimes(2);
});
