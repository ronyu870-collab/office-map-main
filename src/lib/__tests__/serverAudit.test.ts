import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { writeAuditBestEffort, withCriticalAudit, scheduleAuditBestEffort } from '@/src/lib/serverAudit';
const lifecycle = vi.hoisted(() => ({ callbacks: [] as Array<() => Promise<void>> }));
vi.mock('next/server', () => ({ after: (callback: () => Promise<void>) => lifecycle.callbacks.push(callback) }));

function clientReturning(result: unknown): SupabaseClient {
  return {
    from: vi.fn(() => ({
      insert: vi.fn(async () => result),
    })),
  } as unknown as SupabaseClient;
}

describe('writeAuditBestEffort', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('confirms successful persistence', async () => {
    const client = clientReturning({ error: null });
    await expect(writeAuditBestEffort(client, { action_type: 'TEST_ACTION' }, 'test')).resolves.toBe(true);
  });

  it('reports Supabase insert errors without throwing into the business flow', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = clientReturning({ error: { code: '42501', message: 'denied' } });

    await expect(writeAuditBestEffort(client, { action_type: 'TEST_ACTION' }, 'test')).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledWith('[audit][server] write failed', expect.objectContaining({
      context: 'test',
      code: '42501',
    }));
  });

  it('reports thrown transport failures without throwing into the business flow', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = {
      from: vi.fn(() => ({
        insert: vi.fn(async () => { throw new Error('network down'); }),
      })),
    } as unknown as SupabaseClient;

    await expect(writeAuditBestEffort(client, { action_type: 'TEST_ACTION' }, 'test')).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledWith('[audit][server] write threw', expect.objectContaining({
      context: 'test',
      message: 'network down',
    }));
  });
});

it('ordinary managed delivery registers work without waiting for a database call', async () => {
  const client = clientReturning({error:null});
  lifecycle.callbacks=[];
  scheduleAuditBestEffort(client,{action_type:'BUILDING_PHOTO_ACCESS'},'test');
  expect(client.from).not.toHaveBeenCalled();
  expect(lifecycle.callbacks).toHaveLength(1);
  await lifecycle.callbacks[0]();
  expect(client.from).toHaveBeenCalledWith('audit_logs');
  expect(()=>scheduleAuditBestEffort(client,{action_type:'DELETE_USER'},'test')).toThrow('AUDIT_REQUIRES_RELIABLE_DELIVERY');
});

it('refuses high-risk effects when durable intent fails', async () => {
  const run=vi.fn(async()=>Response.json({success:true}));
  const response=await withCriticalAudit(clientReturning({error:{code:'offline'}}),{action_type:'CREATE_USER',user_id:'actor'},'test',run);
  expect(response.status).toBe(503);expect(run).not.toHaveBeenCalled();
});

it('records the effect result once without retrying the business on audit failure', async () => {
  const error=vi.spyOn(console,'error').mockImplementation(()=>undefined);
  const client={...clientReturning({error:null}),rpc:vi.fn(async()=>({data:null,error:{code:'offline'}}))} as unknown as SupabaseClient;
  const run=vi.fn(async()=>Response.json({success:true}));
  const response=await withCriticalAudit(client,{action_type:'CHANGE_PASSWORD',user_id:'actor'},'test',run);
  expect(response.status).toBe(200);expect(run).toHaveBeenCalledTimes(1);
  expect(client.rpc).toHaveBeenCalledWith('audit_complete_operation',expect.objectContaining({p_state:'success',p_details:{}}));
  expect(error).toHaveBeenCalled();
});

it('withholds sensitive file bytes if terminal persistence fails and carries actual partial stats', async()=>{
 vi.spyOn(console,'error').mockImplementation(()=>undefined);
 const client={...clientReturning({error:null}),rpc:vi.fn(async()=>({error:{code:'offline'}}))} as unknown as SupabaseClient;
 const response=await withCriticalAudit(client,{action_type:'AUDIT_EXPORT',user_id:'actor'},'test',async record=>{record({outcome:'partial',stats:{copied:1,deleted:0}});return new Response('sensitive bytes');},true);
 expect(response.status).toBe(503);expect(await response.text()).not.toContain('sensitive bytes');
 expect(client.rpc).toHaveBeenCalledWith('audit_complete_operation',expect.objectContaining({p_details:{outcome:'partial',stats:{copied:1,deleted:0}}}));
});
