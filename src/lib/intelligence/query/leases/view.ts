import { z } from 'zod';
import { leaseReadSchema, type LeaseRead } from './contracts';
import { quarterSchema } from '../contracts';
export const leaseViewSchema = z.enum(['catalog','summary','face_rent','effective_rent','industry','sub_industry','demand_type','submarket','quarter_trend']);
export type LeaseView = z.infer<typeof leaseViewSchema>;
export const leaseRangeSchema=z.strictObject({start:quarterSchema,end:quarterSchema}).refine(r=>{const n=(r.end.year-r.start.year)*4+r.end.quarter-r.start.quarter;return n>=1&&n<40;},'LEASE_TREND_REQUIRES_2_TO_40_QUARTERS');
export const leaseSelectionSchema = z.strictObject({ view: leaseViewSchema, period: quarterSchema.nullable(), read: leaseReadSchema, range:leaseRangeSchema.optional() });
export type LeaseSelection = z.infer<typeof leaseSelectionSchema>;
export const leaseScopeSchema = leaseReadSchema.extend({ inventory: z.literal('leases'), buildingIds: z.never().optional() });
export function leaseReadFromScope(scope: z.infer<typeof leaseScopeSchema>): LeaseRead {
  return leaseReadSchema.parse({sources:scope.sources,fields:scope.fields,
    ...(scope.submarkets!==undefined?{submarkets:scope.submarkets}:{}),...(scope.recordIds!==undefined?{recordIds:scope.recordIds}:{}),
    ...(scope.companyExact!==undefined?{companyExact:scope.companyExact}:{}),...(scope.building!==undefined?{building:scope.building}:{})});
}
export const leaseGroupLabels={industry:'行业',sub_industry:'子行业',demand_type:'需求类型',submarket:'子市场'} as const;
export const isLeaseGroup=(view:LeaseView):view is keyof typeof leaseGroupLabels=>view in leaseGroupLabels;
export const leaseRequiredFields = (view: LeaseView) => ['summary','submarket','quarter_trend'].includes(view) ? ['area_sqm'] as const
  : view==='industry'||view==='sub_industry'||view==='demand_type'?['area_sqm',view] as const
  : view === 'face_rent' || view === 'effective_rent' ? ['area_sqm', view] as const : [];
export function validateLeaseSelection(s: LeaseSelection) {
  if (leaseRequiredFields(s.view).some(f => !s.read.fields.includes(f))) throw new Error('LEASE_VIEW_FIELD_REQUIRED');
  if(s.view==='quarter_trend'){if(s.period!==null||!s.range)throw new Error('LEASE_TREND_RANGE_REQUIRED');leaseRangeSchema.parse(s.range);}
  else if(s.range)throw new Error('LEASE_RANGE_ONLY_FOR_TREND');
}
export const leaseAnswerSchema = z.strictObject({ paragraphs: z.array(z.string().max(10000)).min(1).max(12) });
export const leaseSourceLabel = { live: '日常成交', history: '历史成交' } as const;
export const leaseNatureLabel = { estimated: '估算', not_marked_estimated: '未标估算', unknown: '估算状态未知' } as const;
