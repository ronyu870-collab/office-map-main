import { z } from 'zod';
import { leaseReadSchema, type LeaseRead } from './contracts';
import { quarterSchema } from '../contracts';
export const leaseViewSchema = z.enum(['catalog','summary','face_rent','effective_rent']);
export type LeaseView = z.infer<typeof leaseViewSchema>;
export const leaseSelectionSchema = z.strictObject({ view: leaseViewSchema, period: quarterSchema.nullable(), read: leaseReadSchema });
export type LeaseSelection = z.infer<typeof leaseSelectionSchema>;
export const leaseScopeSchema = leaseReadSchema.extend({ inventory: z.literal('leases'), buildingIds: z.never().optional() });
export function leaseReadFromScope(scope: z.infer<typeof leaseScopeSchema>): LeaseRead {
  return leaseReadSchema.parse({sources:scope.sources,fields:scope.fields,
    ...(scope.submarkets!==undefined?{submarkets:scope.submarkets}:{}),...(scope.recordIds!==undefined?{recordIds:scope.recordIds}:{}),
    ...(scope.companyExact!==undefined?{companyExact:scope.companyExact}:{}),...(scope.building!==undefined?{building:scope.building}:{})});
}
export const leaseRequiredFields = (view: LeaseView) => view === 'summary' ? ['area_sqm'] as const
  : view === 'face_rent' || view === 'effective_rent' ? ['area_sqm', view] as const : [];
export function validateLeaseSelection(s: LeaseSelection) {
  if (leaseRequiredFields(s.view).some(f => !s.read.fields.includes(f))) throw new Error('LEASE_VIEW_FIELD_REQUIRED');
}
export const leaseAnswerSchema = z.strictObject({ paragraphs: z.array(z.string().max(10000)).min(1).max(12) });
export const leaseSourceLabel = { live: '日常成交', history: '历史成交' } as const;
export const leaseNatureLabel = { estimated: '估算', not_marked_estimated: '未标估算', unknown: '估算状态未知' } as const;
