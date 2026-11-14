import { z } from 'zod';

export const LEASE_POLICY = 'lease-observation/1';
export const leaseFieldKeys = ['area_sqm','face_rent','effective_rent','lease_term_months','industry','sub_industry','demand_type','source_evidence'] as const;
export const leaseFieldSchema = z.enum(leaseFieldKeys);
export type LeaseField = z.infer<typeof leaseFieldSchema>;
export const leaseSourceSchema = z.enum(['live','history']);
const recordId = z.string().min(6).max(512).regex(/^(live|history):[^\u0000-\u001f\u007f]+$/);
const unique = <T,>(values: T[]) => new Set(values).size === values.length;
export const leaseReadSchema = z.strictObject({
  sources: z.array(leaseSourceSchema).min(1).max(2).refine(unique),
  fields: z.array(leaseFieldSchema).max(8).refine(unique),
  submarkets: z.array(z.string().trim().min(1).max(80)).min(1).max(30).refine(unique).optional(),
  recordIds: z.array(recordId).min(1).max(500).refine(unique).optional(),
  companyExact: z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/).optional(),
  building: z.strictObject({ id: z.uuid(), scope: z.enum(['tower','project','related']) }).optional(),
});
export type LeaseRead = z.infer<typeof leaseReadSchema>;
const text = z.string().nullable(), time = z.iso.datetime({ offset: true });
export const leaseRecordSchema = z.strictObject({
  id: recordId, source: leaseSourceSchema, sourceRecordId: z.uuid(), sourceUid: text,
  company: text, buildingName: text, submarket: text, buildingId: z.uuid().nullable(),
  buildingScope: z.enum(['exact','reference','project','unmapped']), relatedBuildingIds: z.array(z.uuid()).refine(unique),
  date: text, year: z.number().int().nullable(), quarter: text, precision: z.enum(['date','quarter','year','unknown']),
  periodStart: text, periodEnd: text, periodSource: text, quality: text, createdAt: time.nullable(),
  values: z.record(z.string(), text), estimates: z.record(z.string(), text), termRaw: text,
  evidence: z.strictObject({ file: text, sheet: text, row: z.number().int().nullable() }).nullable(),
  version: z.string().regex(/^[a-f0-9]{64}$/),
});
export const leaseSnapshotSchema = z.strictObject({
  policy: z.literal(LEASE_POLICY), snapshotId: z.uuid(), requestId: z.uuid(), databaseSnapshot: z.string().min(1), readAt: time,
  complete: z.literal(true), expected: z.number().int().min(0).max(20000), uniqueIds: z.number().int().min(0), uniqueSources: z.number().int().min(0),
  sources: z.array(leaseSourceSchema).min(1).max(2).refine(unique), fields: z.array(leaseFieldSchema).max(8).refine(unique),
  records: z.array(leaseRecordSchema).max(20000),
});
export type LeaseSnapshot = z.infer<typeof leaseSnapshotSchema>;
export type LeaseRecord = z.infer<typeof leaseRecordSchema>;
const keysMatch = (keys: string[], expected: readonly string[]) => keys.length === expected.length && keys.every(k => expected.includes(k));
export function validateLeaseSnapshot(input: unknown): LeaseSnapshot {
  const s = leaseSnapshotSchema.parse(input);
  if (s.expected !== s.records.length || s.uniqueIds !== s.expected || s.uniqueSources !== s.expected
    || new Set(s.records.map(r => r.id)).size !== s.expected
    || new Set(s.records.map(r => `${r.source}/${r.sourceRecordId}`)).size !== s.expected) throw new Error('INCOMPLETE_LEASE_SNAPSHOT');
  const fields = s.fields.filter(k => k !== 'source_evidence'), estimates = s.fields.filter(k => k === 'face_rent' || k === 'effective_rent');
  for (const r of s.records) {
    if (!s.sources.includes(r.source) || r.id !== `${r.source}:${r.source === 'live' ? r.sourceRecordId : r.sourceUid}`
      || r.source === 'live' && r.sourceUid !== null || r.source === 'history' && !r.sourceUid) throw new Error('LEASE_IDENTITY_MISMATCH');
    if (r.buildingScope === 'exact' || r.buildingScope === 'reference') {
      if (!r.buildingId || r.relatedBuildingIds.length !== 1 || r.relatedBuildingIds[0] !== r.buildingId) throw new Error('LEASE_BUILDING_SCOPE_MISMATCH');
    } else if (r.buildingId !== null || (r.buildingScope === 'unmapped' ? r.relatedBuildingIds.length !== 0 : r.relatedBuildingIds.length === 0)) throw new Error('LEASE_BUILDING_SCOPE_MISMATCH');
    if (!keysMatch(Object.keys(r.values), fields) || !keysMatch(Object.keys(r.estimates), estimates)
      || r.source === 'history' && Object.values(r.estimates).some(v => v !== null)
      || (!s.fields.includes('lease_term_months') || r.source === 'live') && r.termRaw !== null
      || (!s.fields.includes('source_evidence') || r.source === 'live') && r.evidence !== null) throw new Error('LEASE_FIELD_SCOPE_MISMATCH');
  }
  return s;
}
