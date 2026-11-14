import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import type {QueryAuthority} from '../admission';
import type {VerifiedQueryIdentity} from '../serverAuthority';
import {FUTURE_POLICY,futureReadSchema,validateFutureSnapshot,type FutureRead} from './contracts';

export type FutureAuthority=QueryAuthority&{sessionId:string;allSubmarkets:boolean;submarkets:readonly string[];allFutureSupplies:boolean;futureSupplyIds:readonly string[]};
const authoritySchema=z.strictObject({allowed:z.literal(true),access_policy:z.literal('admin-only/1'),future_policy:z.literal(FUTURE_POLICY),actor_id:z.uuid(),effective_user_id:z.uuid(),session_id:z.uuid(),
  policy_version:z.string().min(1),permission_revision:z.string().regex(/^[a-f0-9]{64}$/),
  capabilities:z.array(z.enum(['query:catalog','query:brochure','query:quarter','export:internal','query:submission-progress','query:submission-quality','query:future-catalog','query:future-progress','query:future-quality'])),
  fields:z.array(z.enum(['height','floors','parking','totalArea','vacantArea','netEffectiveRent'])),all_submarkets:z.boolean(),submarkets:z.array(z.string()),all_future_supplies:z.boolean(),future_supply_ids:z.array(z.uuid())});
export async function loadFutureAuthority(client:SupabaseClient,identity:VerifiedQueryIdentity,signal:AbortSignal):Promise<FutureAuthority>{
  signal.throwIfAborted();if(identity.expiresAt<=Date.now()||identity.actorId!==identity.effectiveUserId)throw new Error('QUERY_DENIED');
  const {data,error}=await client.rpc('ai_query_future_authority',{p_actor:identity.actorId,p_effective:identity.effectiveUserId,p_session:identity.sessionId}).abortSignal(signal);
  signal.throwIfAborted();if(error)throw new Error('QUERY_AUTHORITY_UNAVAILABLE');if(data?.allowed===false)throw new Error('QUERY_DENIED');
  const a=authoritySchema.safeParse(data);if(!a.success)throw new Error('QUERY_AUTHORITY_UNAVAILABLE');
  if(a.data.actor_id!==identity.actorId||a.data.effective_user_id!==identity.effectiveUserId||a.data.session_id!==identity.sessionId)throw new Error('QUERY_DENIED');
  return {actorId:identity.actorId,effectiveUserId:identity.effectiveUserId,sessionId:identity.sessionId,sessionActive:true,policyVersion:a.data.policy_version,permissionRevision:a.data.permission_revision,
    grants:a.data.capabilities,fields:a.data.fields,allSubmarkets:a.data.all_submarkets,submarkets:a.data.submarkets,allFutureSupplies:a.data.all_future_supplies,futureSupplyIds:a.data.future_supply_ids};
}
export function authorizeFutureRead(read:FutureRead,a:FutureAuthority){
  if(!a.sessionActive||a.actorId!==a.effectiveUserId||!a.grants.includes('query:future-catalog')
    ||read.mode!=='catalog'&&!a.grants.includes('query:future-progress')||read.mode==='quality'&&!a.grants.includes('query:future-quality')
    ||!a.allFutureSupplies&&!a.futureSupplyIds.length||!a.allSubmarkets&&!a.submarkets.length
    ||read.submarkets?.some(v=>!a.allSubmarkets&&!a.submarkets.includes(v))||read.futureIds?.some(v=>!a.allFutureSupplies&&!a.futureSupplyIds.includes(v)))throw new Error('QUERY_DENIED');
}
export function normalizeFutureRead(input:unknown,read:FutureRead,a:FutureAuthority,requestId:string){
  authorizeFutureRead(read,a);const s=validateFutureSnapshot(input);
  if(s.requestId!==requestId||s.mode!==read.mode||s.periodBasis!==(read.mode==='catalog'?'none':read.period?'explicit':'configured')
    ||read.period&&(s.period?.year!==read.period.year||s.period?.quarter!==read.period.quarter)
    ||s.supplies.some(r=>!a.allFutureSupplies&&!a.futureSupplyIds.includes(r.id)||!a.allSubmarkets&&!a.submarkets.includes(r.submarket??'')
      ||read.submarkets&&!read.submarkets.includes(r.submarket??'')||read.futureIds&&!read.futureIds.includes(r.id)))throw new Error('FUTURE_SCOPE_MISMATCH');
  return s;
}
/** Internal read requires durable running audit and current future scope; no public activation. */
export async function readFutureSnapshot(client:SupabaseClient,identity:VerifiedQueryIdentity,requestId:string,input:unknown,signal:AbortSignal){
  const read=futureReadSchema.parse(input);z.uuid().parse(requestId);const a=await loadFutureAuthority(client,identity,signal);authorizeFutureRead(read,a);
  const {data,error}=await client.rpc('ai_query_future_snapshot_read',{p_actor:identity.actorId,p_effective:identity.effectiveUserId,p_session:identity.sessionId,p_request_id:requestId,
    p_permission_revision:a.permissionRevision,p_mode:read.mode,p_year:read.period?.year??null,p_quarter:read.period?.quarter??null,p_submarkets:read.submarkets??null,p_future_ids:read.futureIds??null}).abortSignal(signal);
  signal.throwIfAborted();if(error)throw new Error(error.code==='42501'?'QUERY_DENIED':error.code==='54000'?'QUERY_SCOPE_REQUIRES_BACKGROUND_JOB':error.message==='SUBMISSION_PERIOD_UNAVAILABLE'?'SUBMISSION_PERIOD_UNAVAILABLE':'QUERY_READ_UNAVAILABLE');
  const s=normalizeFutureRead(data,read,a,requestId),current=await loadFutureAuthority(client,identity,signal);authorizeFutureRead(read,current);
  if(a.permissionRevision!==current.permissionRevision)throw new Error('QUERY_DENIED');return s;
}

/** Gate for first delivery and later artifacts; caller separately checks the original selection. */
export async function authorizeFutureSources(client:SupabaseClient,identity:VerifiedQueryIdentity,requestId:string,authority:FutureAuthority,sources:readonly import('../contracts').SourceRef[],signal:AbortSignal){
  signal.throwIfAborted();if(identity.expiresAt<=Date.now()||identity.actorId!==authority.actorId||identity.effectiveUserId!==authority.effectiveUserId)throw new Error('QUERY_DENIED');
  const {data,error}=await client.rpc('ai_query_future_sources_allowed',{p_actor:identity.actorId,p_effective:identity.effectiveUserId,p_session:identity.sessionId,p_request_id:requestId,p_permission_revision:authority.permissionRevision,
    p_sources:sources.map(s=>({entity_id:s.table==='app_settings'?null:s.entityId,record_id:s.recordId,source_table:s.table,field:s.field,year:s.period?.year??null,quarter:s.period?.quarter??null}))}).abortSignal(signal);
  signal.throwIfAborted();if(error||data?.source_policy!==FUTURE_POLICY)throw new Error('QUERY_READ_UNAVAILABLE');
  if(data.allowed!==true||data.permission_revision!==authority.permissionRevision)throw new Error('QUERY_DENIED');
}
