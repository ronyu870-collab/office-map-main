import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { loadDataAuthority, type DataAuthority, type VerifiedQueryIdentity } from '../serverAuthority';
import { submissionReadSchema, validateSubmissionSnapshot, type SubmissionRead } from './contracts';
import type { SourceRef } from '../contracts';

/** Final delivery gate: a valid grant does not make a withdrawn source readable. */
export async function authorizeSubmissionSources(client: SupabaseClient, identity: VerifiedQueryIdentity,
  requestId: string, authority: DataAuthority, sources: readonly SourceRef[], signal: AbortSignal) {
  const { data, error } = await client.rpc('ai_query_submission_sources_allowed', {
    p_actor: identity.actorId, p_effective: identity.effectiveUserId, p_session: identity.sessionId,
    p_permission_revision: authority.permissionRevision, p_request_id: requestId,
    p_sources: sources.map(ref => ({ entity_id: ref.table === 'app_settings' ? null : ref.entityId,
      record_id: ref.recordId, source_table: ref.table, field: ref.field,
      year: ref.period?.year ?? null, quarter: ref.period?.quarter ?? null })),
  }).abortSignal(signal);
  signal.throwIfAborted();
  if (error || data?.source_policy !== 'submission-observation/1') throw new Error('QUERY_READ_UNAVAILABLE');
  if (data.allowed !== true || data.permission_revision !== authority.permissionRevision) throw new Error('QUERY_DENIED');
}

export function authorizeSubmissionRead(read: SubmissionRead, authority: DataAuthority): void {
  if (!authority.sessionActive || authority.actorId !== authority.effectiveUserId
    || !authority.grants.includes('query:catalog') || !authority.grants.includes('query:submission-progress')
    || read.quality && !authority.grants.includes('query:submission-quality')
    || read.submarkets?.some(m => !authority.allSubmarkets && !authority.submarkets.includes(m))
    || read.buildingIds?.some(id => !authority.allBuildings && !authority.buildingIds.includes(id))) throw new Error('QUERY_DENIED');
}

export function normalizeSubmissionRead(input: unknown, read: SubmissionRead, authority: DataAuthority, requestId: string) {
  authorizeSubmissionRead(read, authority);
  const s = validateSubmissionSnapshot(input);
  if (s.requestId !== requestId || s.quality !== read.quality || s.periodBasis !== (read.period ? 'explicit' : 'configured')
    || read.period && (s.period.year !== read.period.year || s.period.quarter !== read.period.quarter)
    || s.buildings.some(b => !authority.allBuildings && !authority.buildingIds.includes(b.id)
      || !authority.allSubmarkets && !authority.submarkets.includes(b.submarket ?? '')
      || read.submarkets && !read.submarkets.includes(b.submarket ?? '') || read.buildingIds && !read.buildingIds.includes(b.id))) throw new Error('SUBMISSION_SCOPE_MISMATCH');
  return s;
}

/** Internal adapter only: requires an existing durable running audit; no public activation. */
export async function readSubmissionSnapshot(client: SupabaseClient, identity: VerifiedQueryIdentity, requestId: string, input: unknown, signal: AbortSignal) {
  const read = submissionReadSchema.parse(input);
  z.uuid().parse(requestId);
  const authority = await loadDataAuthority(client, identity, signal);
  authorizeSubmissionRead(read, authority);
  const { data, error } = await client.rpc('ai_query_submission_snapshot_read', {
    p_actor: identity.actorId, p_effective: identity.effectiveUserId, p_session: identity.sessionId,
    p_permission_revision: authority.permissionRevision, p_request_id: requestId,
    p_year: read.period?.year ?? null, p_quarter: read.period?.quarter ?? null, p_quality: read.quality,
    p_submarkets: read.submarkets ?? null, p_building_ids: read.buildingIds ?? null,
  }).abortSignal(signal);
  signal.throwIfAborted();
  if (error) throw new Error(error.code === '42501' ? 'QUERY_DENIED' : error.code === '54000' ? 'QUERY_SCOPE_REQUIRES_BACKGROUND_JOB'
    : error.message === 'SUBMISSION_PERIOD_UNAVAILABLE' ? 'SUBMISSION_PERIOD_UNAVAILABLE' : 'QUERY_READ_UNAVAILABLE');
  const snapshot = normalizeSubmissionRead(data, read, authority, requestId);
  const current = await loadDataAuthority(client, identity, signal);
  authorizeSubmissionRead(read, current);
  if (current.permissionRevision !== authority.permissionRevision) throw new Error('QUERY_DENIED');
  return snapshot;
}
