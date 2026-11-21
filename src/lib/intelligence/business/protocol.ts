import { z } from 'zod';
import { quarterSchema } from '../query/contracts';
export const BUSINESS_DOMAIN = 'business-research/1';
// A field has exactly one physical source. No fallback across area or time bases.
export const profileFields = {
  district: ['行政区（目录）', null, 'text'], submarket: ['子市场（目录）', null, 'text'], grade: ['等级（目录）', null, 'text'],
  completionYear: ['建成年份（目录）', null, 'text'], leasableArea: ['可租面积（目录，非实时空置）', 'm2', 'number'],
  address: ['地址（楼书）', null, 'text'], brochureDistrict: ['行政区（楼书）', null, 'text'],
  completionDate: ['竣工日期（楼书）', null, 'text'], gfaTotal: ['总建筑面积 GFA（楼书）', 'm2', 'number'],
  gfaOffice: ['办公建筑面积（楼书）', 'm2', 'number'], standardFloorArea: ['标准层面积（楼书）', 'm2', 'number'],
  height: ['建筑高度（楼书）', 'm', 'number'], floors: ['楼层数（楼书）', 'floor', 'number'],
  floorsAbove: ['地上层数（楼书）', 'floor', 'number'], floorsBelow: ['地下层数（楼书）', 'floor', 'number'],
  parking: ['停车位（楼书）', 'space', 'number'], metro: ['地铁交通（楼书）', null, 'text'],
  leed: ['LEED（楼书）', null, 'text'], well: ['WELL（楼书）', null, 'text'], greenStandard: ['绿色建筑标准（楼书）', null, 'text'],
  propertyManagement: ['物业服务（楼书）', null, 'text'], delivery: ['交付标准（楼书）', null, 'text'],
  elevators: ['客梯数量（楼书）', 'space', 'number'], telecom: ['通信设施（楼书）', null, 'text'], hvac: ['空调系统（楼书）', null, 'text'],
  availablePeriods: ['有非草稿季度记录的期间（不保证指标有效）', null, 'text'],
} as const;
export const profileFieldNames = Object.keys(profileFields) as [keyof typeof profileFields, ...(keyof typeof profileFields)[]];
const names = z.array(z.string().trim().min(1).max(80)).min(1).max(8);
const buildingIds = z.array(z.uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length);
export const BUSINESS_TOOL_SCHEMAS = {
  query_building_dossier: z.strictObject({ buildingIds, fields: z.array(z.enum(profileFieldNames)).min(1).max(26).refine(fields => new Set(fields).size === fields.length)
    .default(['district','submarket','grade','completionYear','address','completionDate','gfaTotal','leasableArea','standardFloorArea','floors','height','parking','metro','leed','propertyManagement']) }),
  query_submarket_profile: z.strictObject({ submarkets: names }),
  query_future_supply: z.strictObject({ submarkets: names, source: z.enum(['catalog','submitted_quarter','latest_submitted']).default('catalog'), period: quarterSchema.optional() }).superRefine((p,c) => {
    if ((p.source === 'submitted_quarter') !== Boolean(p.period)) c.addIssue({code:'custom',message:'SUPPLY_EXPLICIT_PERIOD_REQUIRED'});
  }),
  query_stacking_plan: z.strictObject({ buildingIds }),
} as const;
export type BusinessToolName = keyof typeof BUSINESS_TOOL_SCHEMAS;
export const BUSINESS_TOOL_NAMES = new Set<string>(Object.keys(BUSINESS_TOOL_SCHEMAS));
export const businessPlanSchema = z.discriminatedUnion('tool', [
  BUSINESS_TOOL_SCHEMAS.query_building_dossier.extend({tool:z.literal('query_building_dossier')}),
  BUSINESS_TOOL_SCHEMAS.query_submarket_profile.extend({tool:z.literal('query_submarket_profile')}),
  BUSINESS_TOOL_SCHEMAS.query_future_supply.safeExtend({tool:z.literal('query_future_supply')}),
  BUSINESS_TOOL_SCHEMAS.query_stacking_plan.extend({tool:z.literal('query_stacking_plan')}),
]);
export type BusinessPlan = z.infer<typeof businessPlanSchema>;
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const businessSnapshotSchema = z.strictObject({ allowed:z.literal(true), version:z.literal(BUSINESS_DOMAIN),
  permission_revision:hash, export:z.boolean(), records:z.array(z.strictObject({
    id:z.string().max(100), name:z.string().max(200), buildingId:z.uuid().nullable(), editorial:z.record(z.string(),z.unknown()).optional(),
    data:z.array(z.strictObject({table:z.string().max(80),id:z.string().max(100),version:hash,
      recordedAt:z.string().nullable(),asOf:z.string().nullable(),period:quarterSchema.nullable(),
      values:z.record(z.string(),z.string().max(10000).nullable())})).max(1000),
  })).max(5000),
});
export type BusinessSnapshot = z.infer<typeof businessSnapshotSchema>;
export const businessBindingSchema = z.strictObject({plan:businessPlanSchema,permissionRevision:hash,snapshotHash:hash});
export const isBusinessResult = (r:{parameters:Readonly<Record<string,unknown>>}) => r.parameters.dataDomain === BUSINESS_DOMAIN;
