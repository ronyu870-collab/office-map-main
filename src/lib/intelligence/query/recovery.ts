import { isLeaseResult } from '../lease/protocol';
import { recheckLeaseResult } from '../lease/research';
import { resultViewSchema } from './presentation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authorizePlan } from './admission';
import { decryptAuditContent } from './auditCrypto';
import type { AuditKeys } from './auditStore';
import { quarterSchema } from './contracts';
import { parseQueryPlan } from './plan';
import type { QueryPlan } from './plan';
import { decodeGeneratedArchive } from './resultArchive';
import { FIELD_REGISTRY_VERSION } from './registry';
import { loadDataAuthority, type DataAuthority, type VerifiedQueryIdentity } from './serverAuthority';

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const eventSchema = z.object({ request_id: z.uuid(), event_id: z.uuid(), sequence: z.number().int().positive().safe(),
  kind: z.string(), payload_digest: hash, cipher: z.unknown() });
const readSchema = z.strictObject({ allowed: z.literal(true), state: z.enum(['received','running','succeeded','failed','denied','cancelled']),
  permission_revision: hash, head_sequence: z.number().int().positive().max(2048), head_hash: hash, events: z.array(eventSchema).max(2048) });
const sourceSchema = z.object({ table: z.enum(['buildings','building_metrics','building_brochure_data']), recordId: z.string().min(1).max(100),
  entityId: z.uuid(), field: z.string().min(1).max(80), period: quarterSchema.nullable(), original: z.null() });
const resultSchema = z.object({ resultId: z.uuid(), registryVersion: z.literal(FIELD_REGISTRY_VERSION), dataVersion: hash,
  sources: z.array(sourceSchema).max(200000) }).passthrough();
type Read = z.infer<typeof readSchema>;
function authorizeRecoveryPlan(plan:QueryPlan,authority:DataAuthority) {
  authorizePlan(plan,authority);
  if((plan.scope.submarkets && !authority.allSubmarkets && plan.scope.submarkets.some(value=>!authority.submarkets.includes(value)))
    ||(plan.scope.buildingIds && !authority.allBuildings && plan.scope.buildingIds.some(value=>!authority.buildingIds.includes(value))))throw new Error('QUERY_DENIED');
}

export async function readOwnResult(client: SupabaseClient, identity: VerifiedQueryIdentity, requestId: string, action: 'status'|'archive', signal: AbortSignal): Promise<Read> {
  if(identity.expiresAt<=Date.now())throw new Error('QUERY_DENIED');
  const {data,error}=await client.rpc('ai_query_result_read',{p_actor:identity.actorId,p_effective:identity.effectiveUserId,
    p_session:identity.sessionId,p_request_id:requestId,p_action:action}).abortSignal(signal);
  signal.throwIfAborted();
  if(error || data?.unavailable===true)throw new Error('QUERY_RECOVERY_UNAVAILABLE');
  if(data?.allowed!==true)throw new Error('QUERY_DENIED');
  return readSchema.parse(data);
}

/** The database has checked owner, current session, chain continuity and bounds.
 * Still validate the envelope before decryption and obtain current source ACLs. */
export async function recoverOwnResult(client: SupabaseClient, identity: VerifiedQueryIdentity, keys: AuditKeys,
  requestId: string, read: Read, signal: AbortSignal, options: { reauthorizedHistory?: boolean; exporting?: boolean } = {}) {
  if(read.state!=='succeeded' || read.events.length!==read.head_sequence
    || read.events.some((event,index)=>event.request_id!==requestId || event.sequence!==index+1)
    || read.events.filter(event=>event.kind==='received').length!==1
    || read.events.filter(event=>event.kind==='succeeded').length!==1
    || read.events[0].kind!=='received')throw new Error('QUERY_RECOVERY_UNAVAILABLE');
  const context={requestId,actorId:identity.actorId,effectiveUserId:identity.effectiveUserId};
  const receipt=JSON.parse(decryptAuditContent(read.events[0].cipher,{...context,eventId:read.events[0].event_id},new Map([[keys.keyId,keys.encryptionKey]])));
  let leaseProtocol = false;
  let planInput = receipt?.content?.plan;
  if (planInput?.resolution === 'server_semantic/1' || planInput?.resolution === 'server_agent/1') {
    // History calls this only after owner-checked archive access in the current
    // session. The original session remains part of the immutable audit record.
    if (!options.reauthorizedHistory && receipt?.content?.sessionId !== identity.sessionId) throw new Error('QUERY_DENIED');
    const resolvedToolEvents = read.events.filter(event => event.kind === 'tool_finished').map(event =>
      JSON.parse(decryptAuditContent(event.cipher, { ...context, eventId: event.event_id }, new Map([[keys.keyId, keys.encryptionKey]]))).content);
    const resolved = (planInput?.resolution === 'server_agent/1' ? resolvedToolEvents.reverse() : resolvedToolEvents)
      .find(value => (value?.resolution?.protocol === 'research-conversation/1' && value?.plan) || value?.resolution?.protocol === 'lease-research/1');
    if (!resolved) throw new Error('QUERY_RECOVERY_UNAVAILABLE');
    leaseProtocol = resolved.resolution.protocol === 'lease-research/1';
    planInput = resolved.plan;
  }
  if (leaseProtocol) {
    const authority = await loadDataAuthority(client, identity, signal);
    if (authority.permissionRevision !== read.permission_revision) throw new Error('QUERY_DENIED');
    const archive = decodeGeneratedArchive(read.events.filter(event => event.kind === 'response_generated'), context, new Map([[keys.keyId, keys]]));
    const result = resultViewSchema.parse(archive.result);
    if (!isLeaseResult(result)) throw new Error('QUERY_RECOVERY_UNAVAILABLE');
    const recheck = async () => {
      const current = await loadDataAuthority(client, identity, signal);
      if (current.permissionRevision !== authority.permissionRevision) throw new Error('QUERY_DENIED');
      await recheckLeaseResult(client, identity, signal, result, options.exporting);
    };
    await recheck();
    return { result: archive.result, resultId: result.resultId, redactionTypes: archive.redactionTypes, recheck };
  }
  const plan=parseQueryPlan(planInput);
  const authority=await loadDataAuthority(client,identity,signal);
  if(authority.permissionRevision!==read.permission_revision)throw new Error('QUERY_DENIED');
  authorizeRecoveryPlan(plan,authority);
  const archive=decodeGeneratedArchive(read.events.filter(event=>event.kind==='response_generated'),context,new Map([[keys.keyId,keys]]));
  const result=resultSchema.parse(archive.result);
  const params = (archive.result as { parameters?: Record<string, unknown> }).parameters;
  const exportPlans = params?.exportPlans === undefined ? []
    : z.array(z.unknown()).min(1).max(64).parse(params.exportPlans).map(parseQueryPlan);
  exportPlans.forEach(item => authorizeRecoveryPlan(item, authority));
  const sources=result.sources.map(ref=>({entity_id:ref.entityId,record_id:ref.recordId,source_table:ref.table,field:ref.field,
    year:ref.period?.year??null,quarter:ref.period?.quarter??null}));
  const recheck=async()=>{
    const current:DataAuthority=await loadDataAuthority(client,identity,signal);
    if(current.permissionRevision!==authority.permissionRevision)throw new Error('QUERY_DENIED');
    authorizeRecoveryPlan(plan,current);
    exportPlans.forEach(item => authorizeRecoveryPlan(item, current));
    const {data,error}=await client.rpc('ai_query_result_sources_allowed',{
      p_actor:identity.actorId,p_effective:identity.effectiveUserId,p_session:identity.sessionId,p_request_id:requestId,
      p_permission_revision:current.permissionRevision,p_sources:sources,
    }).abortSignal(signal);
    signal.throwIfAborted();
    if(error)throw new Error('QUERY_RECOVERY_UNAVAILABLE');
    if ((plan.operation === 'group_aggregate' || plan.operation === 'group_trend' || plan.operation === 'cross_aggregate' || plan.operation === 'cross_trend') && data?.source_policy !== 'catalog-dimensions/1') throw new Error('QUERY_RECOVERY_UNAVAILABLE');
    if(data?.allowed!==true || data.permission_revision!==current.permissionRevision)throw new Error('QUERY_DENIED');
    if (params?.leaseBindings) await recheckLeaseResult(client, identity, signal, { parameters: params }, options.exporting);
  };
  await recheck();
  // Return the exact decoded archive, not the narrowed schema projection above.
  return {result:archive.result,resultId:result.resultId,redactionTypes:archive.redactionTypes,recheck};
}
