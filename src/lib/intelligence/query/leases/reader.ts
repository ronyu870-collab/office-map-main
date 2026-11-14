import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { QueryAuthority } from '../admission';
import type { VerifiedQueryIdentity } from '../serverAuthority';
import { LEASE_POLICY, leaseFieldSchema, leaseReadSchema, leaseSourceSchema, validateLeaseSnapshot, type LeaseField, type LeaseRead } from './contracts';

export type LeaseAuthority = QueryAuthority & Readonly<{
  sessionId: string; allSubmarkets: boolean; submarkets: readonly string[];
  allLeaseRecords: boolean; leaseRecordIds: readonly string[]; leaseSources: readonly ('live'|'history')[]; leaseFields: readonly LeaseField[];
}>;
const authoritySchema = z.strictObject({
  allowed: z.literal(true), access_policy: z.literal('admin-only/1'), lease_policy: z.literal(LEASE_POLICY),
  actor_id: z.uuid(), effective_user_id: z.uuid(), session_id: z.uuid(), policy_version: z.string().min(1), permission_revision: z.string().regex(/^[a-f0-9]{64}$/),
  capabilities: z.array(z.enum(['query:catalog','query:brochure','query:quarter','export:internal','query:submission-progress','query:submission-quality','query:future-catalog','query:future-progress','query:future-quality','query:leases'])),
  fields: z.array(z.enum(['height','floors','parking','totalArea','vacantArea','netEffectiveRent'])),
  all_submarkets: z.boolean(), submarkets: z.array(z.string()), all_lease_records: z.boolean(), lease_record_ids: z.array(z.string()),
  lease_sources: z.array(leaseSourceSchema), lease_fields: z.array(leaseFieldSchema),
});
export async function loadLeaseAuthority(client: SupabaseClient, identity: VerifiedQueryIdentity, signal: AbortSignal): Promise<LeaseAuthority> {
  signal.throwIfAborted();
  if (identity.expiresAt <= Date.now() || identity.actorId !== identity.effectiveUserId) throw new Error('QUERY_DENIED');
  const { data, error } = await client.rpc('ai_query_lease_authority', { p_actor: identity.actorId, p_effective: identity.effectiveUserId, p_session: identity.sessionId }).abortSignal(signal);
  signal.throwIfAborted();
  if (error) throw new Error('QUERY_AUTHORITY_UNAVAILABLE');
  if (data?.allowed === false || identity.expiresAt <= Date.now()) throw new Error('QUERY_DENIED');
  const parsed = authoritySchema.safeParse(data);
  if (!parsed.success) throw new Error('QUERY_AUTHORITY_UNAVAILABLE');
  const a = parsed.data;
  if (a.actor_id !== identity.actorId || a.effective_user_id !== identity.effectiveUserId || a.session_id !== identity.sessionId) throw new Error('QUERY_DENIED');
  return { actorId: a.actor_id, effectiveUserId: a.effective_user_id, sessionId: a.session_id, sessionActive: true,
    policyVersion: a.policy_version, permissionRevision: a.permission_revision, grants: a.capabilities, fields: a.fields,
    allSubmarkets: a.all_submarkets, submarkets: a.submarkets, allLeaseRecords: a.all_lease_records,
    leaseRecordIds: a.lease_record_ids, leaseSources: a.lease_sources, leaseFields: a.lease_fields };
}
export function authorizeLeaseRead(read: LeaseRead, a: LeaseAuthority) {
  if (!a.sessionActive || a.actorId !== a.effectiveUserId || !a.grants.includes('query:leases')
    || !a.allSubmarkets && !a.submarkets.length || !a.allLeaseRecords && !a.leaseRecordIds.length
    || read.sources.some(s => !a.leaseSources.includes(s)) || read.fields.some(f => !a.leaseFields.includes(f))
    || read.submarkets?.some(m => !a.allSubmarkets && !a.submarkets.includes(m))
    || read.recordIds?.some(id => !a.allLeaseRecords && !a.leaseRecordIds.includes(id))) throw new Error('QUERY_DENIED');
}
export function normalizeLeaseRead(input: unknown, read: LeaseRead, a: LeaseAuthority, requestId: string) {
  authorizeLeaseRead(read, a);
  const s = validateLeaseSnapshot(input), same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every(v => y.includes(v));
  if (s.requestId !== requestId || !same(s.sources, read.sources) || !same(s.fields, read.fields)
    || s.records.some(r => !a.allSubmarkets && !a.submarkets.includes(r.submarket ?? '')
      || !a.allLeaseRecords && !a.leaseRecordIds.includes(r.id)
      || read.submarkets && !read.submarkets.includes(r.submarket ?? '') || read.recordIds && !read.recordIds.includes(r.id)
      || read.companyExact && r.company?.trim().toLowerCase() !== read.companyExact.trim().toLowerCase()
      || read.building && (read.building.scope === 'tower'
        ? r.buildingId !== read.building.id || !['exact','reference'].includes(r.buildingScope)
        : !r.relatedBuildingIds.includes(read.building.id) || read.building.scope === 'project' && r.buildingScope !== 'project')))
    throw new Error('LEASE_SCOPE_MISMATCH');
  return s;
}
/** Internal only until the public query/result paths add lease dispatch. Audit must already be durable. */
export async function readLeaseSnapshot(client: SupabaseClient, identity: VerifiedQueryIdentity, requestId: string, input: unknown, signal: AbortSignal) {
  const read = leaseReadSchema.parse(input); z.uuid().parse(requestId);
  const a = await loadLeaseAuthority(client, identity, signal); authorizeLeaseRead(read, a);
  const { data, error } = await client.rpc('ai_query_lease_snapshot_read', {
    p_actor: identity.actorId, p_effective: identity.effectiveUserId, p_session: identity.sessionId,
    p_permission_revision: a.permissionRevision, p_request_id: requestId, p_sources: read.sources, p_fields: read.fields,
    p_submarkets: read.submarkets ?? null, p_record_ids: read.recordIds ?? null, p_company: read.companyExact ?? null,
    p_building_id: read.building?.id ?? null, p_building_scope: read.building?.scope ?? null,
  }).abortSignal(signal);
  signal.throwIfAborted();
  if (error) throw new Error(error.code === '42501' ? 'QUERY_DENIED' : error.code === '54000' ? 'QUERY_SCOPE_REQUIRES_BACKGROUND_JOB' : 'QUERY_READ_UNAVAILABLE');
  const s = normalizeLeaseRead(data, read, a, requestId), current = await loadLeaseAuthority(client, identity, signal);
  authorizeLeaseRead(read, current);
  if (a.permissionRevision !== current.permissionRevision) throw new Error('QUERY_DENIED');
  return s;
}
