import { describe, expect, it, vi } from 'vitest';
import { createAuditAwareFetch } from '@/src/services/supabaseAuditFetch';
import { subscribeSupabaseMutations, type SupabaseMutationNotice } from '@/src/utils/auditMutationBridge';
import { readCompareSnapshot,clearCompareSnapshot } from '@/src/services/compareSnapshot';

function successfulFetch() {
  return vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
}

async function settleAuditMicrotasks() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function capture(call: (auditedFetch: typeof fetch) => Promise<unknown>): Promise<SupabaseMutationNotice[]> {
  const notices: SupabaseMutationNotice[] = [];
  const unsubscribe = subscribeSupabaseMutations(notice => notices.push(notice));
  try {
    await call(createAuditAwareFetch(successfulFetch()));
    await settleAuditMicrotasks();
    return notices;
  } finally {
    unsubscribe();
  }
}

describe('Supabase audit-aware fetch', () => {
  it('captures successful table writes without copying the business payload', async () => {
    const notices = await capture(fetcher => fetcher('https://example.supabase.co/rest/v1/buildings?id=eq.1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret_field: 'must-not-enter-audit' }),
    }));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: 'table', target: 'buildings', operation: 'UPDATE', status: 204 });
    expect(JSON.stringify(notices[0])).not.toContain('must-not-enter-audit');
  });

  it('ignores reads, draft autosaves and internal session-id maintenance', async () => {
    const notices = await capture(async fetcher => {
      await fetcher('https://example.supabase.co/rest/v1/buildings?select=*', { method: 'GET' });
      await fetcher('https://example.supabase.co/rest/v1/update_drafts', { method: 'POST', body: '{}' });
      await fetcher('https://example.supabase.co/rest/v1/user_roles?id=eq.1', {
        method: 'PATCH',
        body: JSON.stringify({ session_id: 'internal-session' }),
      });
    });
    expect(notices).toEqual([]);
  });

  it('recognizes upserts and keeps meaningful user-role changes', async () => {
    const notices = await capture(async fetcher => {
      await fetcher('https://example.supabase.co/rest/v1/app_settings', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: '{}',
      });
      await fetcher('https://example.supabase.co/rest/v1/user_roles?id=eq.1', {
        method: 'PATCH',
        body: JSON.stringify({ role: 'admin' }),
      });
    });
    expect(notices.map(notice => notice.operation)).toEqual(['UPSERT', 'UPDATE']);
  });

  it('captures unknown RPC writes but ignores the known read-only RPC set', async () => {
    const notices = await capture(async fetcher => {
      await fetcher('https://example.supabase.co/rest/v1/rpc/get_all_tables', { method: 'POST', body: '{}' });
      await fetcher('https://example.supabase.co/rest/v1/rpc/lock_quarter', { method: 'POST', body: '{}' });
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: 'rpc', target: 'lock_quarter', operation: 'RPC' });
  });
});

it('invalidates comparison snapshots for transaction-audited writes even without an audit subscriber',async()=>{
 clearCompareSnapshot();const load=vi.fn(async()=>({version:1}));
 await readCompareSnapshot('fixture',load);await readCompareSnapshot('fixture',load);expect(load).toHaveBeenCalledTimes(1);
 const notices=await capture(fetcher=>fetcher('https://example.supabase.co/rest/v1/rpc/submit_quarterly_batch_v2',{method:'POST',body:'{}'}));
 expect(notices).toEqual([]);await readCompareSnapshot('fixture',load);expect(load).toHaveBeenCalledTimes(2);
});

it('preserves the original response body and transport failures while observation listeners fail',async()=>{
 const response=new Response('original-business-body',{status:200});const clone=vi.spyOn(response,'clone');
 const transport=vi.fn(async()=>response);const input='https://example.supabase.co/rest/v1/buildings';const init={method:'PATCH',body:'x'.repeat(100000)};
 const stop=subscribeSupabaseMutations(()=>{throw new Error('observer failure');});
 try{const actual=await createAuditAwareFetch(transport)(input,init);await settleAuditMicrotasks();expect(actual).toBe(response);expect(await actual.text()).toBe('original-business-body');expect(clone).not.toHaveBeenCalled();expect(transport).toHaveBeenCalledWith(input,init);}finally{stop();}
 const error=new TypeError('business network failure');const failed=vi.fn(async()=>{throw error;});await expect(createAuditAwareFetch(failed)(input,init)).rejects.toBe(error);
});
