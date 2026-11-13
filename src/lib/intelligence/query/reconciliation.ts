import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditKeys } from './auditStore';
import { auditPayloadDigest, encryptAuditContent } from './auditCrypto';

const claimSchema = z.strictObject({ request_id: z.uuid(), actor_id: z.uuid(), effective_user_id: z.uuid(), lease_token: z.uuid(),
  worker_ref: z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/), lease_until: z.iso.datetime({ offset: true }), due_at: z.iso.datetime({ offset: true }),
  expected_sequence: z.number().int().nonnegative().safe(), expected_hash: z.string().regex(/^[a-f0-9]{64}$/), previous_state: z.enum(['received','running']) });
export type ReconciliationClaim = z.infer<typeof claimSchema>;
export function reconciliationEnvelope(claim: ReconciliationClaim, keys: AuditKeys) {
  const value = claimSchema.parse(claim);
  // The same claim retries the same event/content. A different lease receives a
  // different ID, so an expired worker cannot finish a replacement's operation.
  const bytes = createHash('sha256').update(`query-reconcile/1:${value.request_id}:${value.lease_token}`).digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128;
  const h=bytes.toString('hex'),eventId=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  const content=JSON.stringify({content:{reason:'execution_inactivity_expired',executionOutcome:'unknown',delivery:'unconfirmed',
    providerCost:'unknown_not_zero',executor:{kind:'system_reconciler',workerRef:value.worker_ref,leaseToken:value.lease_token},
    originalActorId:value.actor_id,originalEffectiveUserId:value.effective_user_id,expectedSequence:value.expected_sequence,
    expectedHash:value.expected_hash,previousState:value.previous_state,dueAt:value.due_at,policyVersion:'query-reconcile/1',
    replayBusinessOperation:false},redactionTypes:[]});
  return {p_request_id:value.request_id,p_lease_token:value.lease_token,p_worker_ref:value.worker_ref,p_event_id:eventId,
    p_payload_digest:auditPayloadDigest(content,keys.digestKey),
    p_cipher:encryptAuditContent(content,{requestId:value.request_id,eventId,actorId:value.actor_id,effectiveUserId:value.effective_user_id},keys.keyId,keys.encryptionKey)};
}
/** One bounded run. Persistent DB queue survives this process; never replay a
 * query/model call or infer business success from a partial generated result. */
export async function reconcileQueryAudits(client: SupabaseClient, keys: AuditKeys, workerRef: string, limit=20) {
  z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/).parse(workerRef); z.number().int().min(1).max(100).parse(limit);
  if(keys.encryptionKey.byteLength!==32||keys.digestKey.byteLength!==32)throw new Error('AUDIT_KEY_UNAVAILABLE');
  const claimed=await client.rpc('ai_query_reconcile_claim',{p_worker_ref:workerRef,p_limit:limit}).abortSignal(AbortSignal.timeout(10000));
  if(claimed.error)throw new Error('AUDIT_RECONCILE_UNAVAILABLE');
  const claims=z.array(claimSchema).max(limit).parse(claimed.data);
  const outcomes:{requestId:string;status:'settled'|'stale'|'integrity_unavailable'|'unavailable';replayed?:boolean}[]=[];
  for(const claim of claims){
    if(claim.worker_ref!==workerRef)throw new Error('AUDIT_RECONCILE_SCOPE_MISMATCH');
    const payload=reconciliationEnvelope(claim,keys);
    let outcome: typeof outcomes[number] = {requestId:claim.request_id,status:'unavailable'};
    for(let attempt=0;attempt<2;attempt++){
      const resolved=await client.rpc('ai_query_reconcile_settle',payload).abortSignal(AbortSignal.timeout(10000));
      if(resolved.error)continue;
      const value=z.discriminatedUnion('settled',[
        z.strictObject({settled:z.literal(true),replayed:z.boolean(),event_id:z.uuid()}),
        z.strictObject({settled:z.literal(false),reason:z.enum(['stale','integrity_unavailable'])}),
      ]).parse(resolved.data);
      if(value.settled&&value.event_id!==payload.p_event_id)throw new Error('AUDIT_RECONCILE_SCOPE_MISMATCH');
      outcome=value.settled?{requestId:claim.request_id,status:'settled',replayed:value.replayed}:{requestId:claim.request_id,status:value.reason};break;
    }
    outcomes.push(outcome);
  }
  return {claimed:claims.length,outcomes};
}
