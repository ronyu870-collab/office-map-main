import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptAuditContent } from '../auditCrypto';
import { reconciliationEnvelope, reconcileQueryAudits, type ReconciliationClaim } from '../reconciliation';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const keys={keyId:'isolated-unit',encryptionKey:randomBytes(32),digestKey:randomBytes(32)};
const claim:ReconciliationClaim={request_id:id,actor_id:id,effective_user_id:id,lease_token:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  worker_ref:'repair-1',lease_until:'2026-11-13T12:00:00+00:00',due_at:'2026-11-13T11:59:00+00:00',expected_sequence:3,expected_hash:'a'.repeat(64),previous_state:'running'};
describe('persistent query execution reconciliation worker',()=>{
  it('keeps a stable event/content per claim and does not impersonate the original user as executor',()=>{
    const a=reconciliationEnvelope(claim,keys),b=reconciliationEnvelope(claim,keys);
    expect(a.p_event_id).toBe(b.p_event_id);expect(a.p_payload_digest).toBe(b.p_payload_digest);
    const text=JSON.parse(decryptAuditContent(a.p_cipher,{requestId:id,eventId:a.p_event_id,actorId:id,effectiveUserId:id},new Map([[keys.keyId,keys.encryptionKey]]))).content;
    expect(text).toMatchObject({executionOutcome:'unknown',delivery:'unconfirmed',providerCost:'unknown_not_zero',replayBusinessOperation:false,originalActorId:id,executor:{kind:'system_reconciler',workerRef:'repair-1'}});
    expect(reconciliationEnvelope({...claim,lease_token:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},keys).p_event_id).not.toBe(a.p_event_id);
  });
  it('retries an uncertain settlement with the exact same envelope and preserves a replayed result',async()=>{
    let settlements=0;
    const rpc=vi.fn((name:string,args:Record<string,unknown>)=>({abortSignal:async()=>{
      if(name==='ai_query_reconcile_claim')return {data:[claim],error:null};
      settlements++;return settlements===1?{data:null,error:{message:'lost response'}}:{data:{settled:true,replayed:true,event_id:args.p_event_id},error:null};
    }}));
    const result=await reconcileQueryAudits({rpc} as unknown as SupabaseClient,keys,'repair-1');
    expect(result.outcomes).toEqual([{requestId:id,status:'settled',replayed:true}]);expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[1][1]).toBe(rpc.mock.calls[2][1]);
  });
  it('reports integrity failures and rejects a claim assigned to another worker',async()=>{
    const rpc=vi.fn((name:string)=>({abortSignal:async()=>({data:name==='ai_query_reconcile_claim'?[claim]:{settled:false,reason:'integrity_unavailable'},error:null})}));
    expect((await reconcileQueryAudits({rpc} as unknown as SupabaseClient,keys,'repair-1')).outcomes[0].status).toBe('integrity_unavailable');
    rpc.mockClear();await expect(reconcileQueryAudits({rpc} as unknown as SupabaseClient,keys,'another-worker')).rejects.toThrow('SCOPE_MISMATCH');expect(rpc).toHaveBeenCalledOnce();
  });
});
