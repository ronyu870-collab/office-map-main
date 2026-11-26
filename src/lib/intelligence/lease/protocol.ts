import { z } from 'zod';
export const LEASE_DOMAIN = 'lease-research/1';
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(s + 'T00:00:00Z'); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
});
export const leaseFinancialFields = ['liveFaceRent', 'historyFaceRent', 'liveEffectiveRent', 'historyEffectiveRent', 'historyManagementFee', 'leaseMonths', 'fitOutMonths', 'freeMonths'] as const;
export const leaseDetailFields = ['building', 'submarket', 'industry', 'period', 'precision', 'identity', 'source', 'area', ...leaseFinancialFields] as const;
export const leasePlanSchema = z.strictObject({
  source: z.enum(['live', 'history', 'combined']), from: day, to: day,
  mode: z.enum(['aggregate', 'details']).default('aggregate'),
  groupBy: z.enum(['total', 'quarter', 'building', 'industry', 'submarket', 'area_band']).default('total'),
  submarkets: z.array(z.string().trim().min(1).max(80)).min(1).max(30).optional(),
  buildingIds: z.array(z.uuid()).min(1).max(100).optional(),
  buildingName: z.string().trim().min(1).max(100).optional(),
  industry: z.string().trim().min(1).max(100).optional(),
  industries: z.array(z.string().trim().min(1).max(100)).min(1).max(30).optional(),
  fields: z.array(z.enum(leaseDetailFields)).min(1).max(18).optional(),
  sort: z.enum(['area', 'count', 'period']).default('area'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  topN: z.number().int().min(1).max(1000).optional(),
}).superRefine((p, ctx) => {
  if (p.industry && p.industries) ctx.addIssue({ code: 'custom', message: 'LEASE_AMBIGUOUS_INDUSTRY_FILTER' });
  if (p.from > p.to || Number(p.to.slice(0, 4)) - Number(p.from.slice(0, 4)) > 20) ctx.addIssue({ code: 'custom', message: 'LEASE_INVALID_PERIOD' });
  if (p.mode === 'aggregate' && p.fields) ctx.addIssue({ code: 'custom', message: 'LEASE_AGGREGATE_FIELDS_FIXED' });
  if (p.mode === 'details' && (p.sort === 'count' || p.groupBy !== 'total')) ctx.addIssue({ code: 'custom', message: 'LEASE_INVALID_DETAIL_GROUP' });
});
export type LeasePlan = z.infer<typeof leasePlanSchema>;
const scalar = z.string().nullable();
export const leaseRowSchema = z.strictObject({
  id: z.string().regex(/^(live|history):[0-9a-f-]{36}$/), source: z.enum(['live', 'history']),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/), buildingId: z.uuid().nullable(),
  building: scalar, alias: scalar, match: z.enum(['exact', 'project', 'reference', 'unmapped']),
  submarket: scalar, industry: scalar, start: scalar, end: scalar,
  precision: z.enum(['date', 'quarter', 'year', 'unknown']), area: scalar, quality: scalar,
  financials: z.strictObject({ faceRent: scalar.optional(), effectiveRent: scalar.optional(), managementFee: scalar.optional(),
    leaseMonths: scalar.optional(), fitOutMonths: scalar.optional(), freeMonths: scalar.optional() }),
});
export type LeaseRow = z.infer<typeof leaseRowSchema>;
export const leaseSnapshotSchema = z.strictObject({
  allowed: z.literal(true), version: z.literal(LEASE_DOMAIN), permission_revision: z.string().regex(/^[0-9a-f]{64}$/),
  sources: z.array(z.enum(['live', 'history'])).min(1).max(2), details: z.boolean(), financials: z.boolean(), export: z.boolean(), minGroupSize: z.number().int().min(3).max(100),
  rows: z.array(leaseRowSchema).max(20000), links: z.array(z.strictObject({ live: z.string(), history: z.string(),
    liveFingerprint: z.string().regex(/^[0-9a-f]{64}$/), historyFingerprint: z.string().regex(/^[0-9a-f]{64}$/), revision: z.uuid() })).max(20000),
});
export type LeaseSnapshot = z.infer<typeof leaseSnapshotSchema>;
export const leaseBindingSchema = z.strictObject({ plan: leasePlanSchema, permissionRevision: z.string().regex(/^[0-9a-f]{64}$/),
  snapshotHash: z.string().regex(/^[0-9a-f]{64}$/) });
export function isLeaseResult(result: { parameters: Readonly<Record<string, unknown>> }): boolean {
  return result.parameters.dataDomain === LEASE_DOMAIN;
}
