import { z } from 'zod';
import { localizedTextSchema, scopeSchema, slideContentSchema } from '../contracts/content';
import { layoutIdSchema } from '../contracts/scene';
import { quarterSchema } from '@/src/lib/intelligence/query/contracts';
import { parseQueryPlan } from '@/src/lib/intelligence/query/plan';
const text = z.string().trim().min(1).max(4000), label = text.max(160), id = z.uuid();
const translated = localizedTextSchema;
const list = z.array(text).max(30);
const photo = z.strictObject({ id, version: z.number().int().positive() });
export const businessProfileSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('corporate'), coverage: z.enum(['global','china','regional','city','business-line']),
    fallbackFor: z.array(scopeSchema).max(30), brief: translated, detailed: translated,
    capabilities: z.array(translated).max(30), honors: z.array(translated).max(30),
    metrics: z.array(z.strictObject({ label: translated, value: z.number().finite().nullable(), unit: z.string().max(60) })).max(30), photos: z.array(photo).max(10) }),
  z.strictObject({ kind: z.literal('team'), employeeAccountId: id.nullable(), name: translated, position: translated,
    team: label, expertise: list, experience: translated, qualifications: list, representativeProjects: list,
    projectRole: translated, reportsToAssetId: id.nullable(), caseAssetIds: z.array(id).max(30), photo: photo.nullable() }),
  z.strictObject({ kind: z.literal('case'), project: translated, city: label, submarket: label.nullable(), propertyType: label, serviceType: label,
    clientIndustry: label, clientType: label, scale: z.strictObject({ value: z.number().nonnegative().finite().nullable(), unit: z.string().max(60) }),
    background: translated, challenge: translated, strategy: translated, process: translated, outcome: translated,
    occurredOn: z.iso.date(), buildingId: id.nullable(), teamAssetIds: z.array(id).max(30), photos: z.array(photo).max(10),
    disclosureMode: z.enum(['named','anonymous']), internalClientName: label.nullable(),
    displayApproved: z.boolean(), display: slideContentSchema, briefDisplay: slideContentSchema.optional() }),
  z.strictObject({ kind: z.literal('research'), topic: z.enum(['macro','city-economy','policy','office-market','regional','supply-demand','view','outlook','custom']),
    evidenceType: z.enum(['published-report','historical-view','current-data','forecast','custom-analysis']),
    methodology: translated, content: slideContentSchema }),
  z.strictObject({ kind: z.literal('custom'), typeCode: z.string().regex(/^[a-z0-9-]+$/).max(100), content: slideContentSchema }),
]);
export type BusinessProfile = z.infer<typeof businessProfileSchema>;
export const recipeSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/).max(100), revision: z.number().int().nonnegative(), categoryId: id,
  names: translated, description: text, enabled: z.boolean(),
  accepts: z.array(z.enum(['corporate','team','case','research','custom'])).min(1).max(5),
  strategy: z.enum(['overview','metrics','capabilities','team','roles','organization','case-detail','case-brief','case-portfolio','track-record','public-projects','research','content']),
  layoutId: layoutIdSchema, maxAssets: z.number().int().min(1).max(30),
});
export type BusinessRecipe = z.infer<typeof recipeSchema>;
export const dynamicIds = ['building-profile','project-comparison','rent-comparison','vacancy-comparison','rent-trend','vacancy-trend','building-submarket','quarter-market-summary','lease-representatives','lease-area-distribution','lease-industry-distribution','competition-map','stacking-plan'] as const;
const aggregateFilterSchema = z.unknown().transform((filter, ctx) => {
  try {
    return parseQueryPlan({ operation: 'aggregate', metric: 'rent', scope: { inventory: 'tracked' },
      period: { year: 2000, quarter: 1 }, filter }).filter;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid market aggregate filter' });
    return z.NEVER;
  }
});
export const dynamicParametersSchema = z.strictObject({
  templateId: z.enum(dynamicIds), buildingIds: z.array(id).max(20), targetBuildingId: id.optional(),
  submarkets: z.array(z.string().trim().min(1).max(80)).max(30), inventory: z.enum(['tracked','all_authorized']),
  period: quarterSchema, start: quarterSchema, end: quarterSchema,
  fields: z.array(z.enum(['height','floors','parking','totalArea','vacantArea','netEffectiveRent'])).max(6),
  direction: z.enum(['asc','desc']), chart: z.enum(['bar','column','line','table']),
  from: z.iso.date(), to: z.iso.date(), leaseSource: z.enum(['live','history','combined']),
  measure: z.enum(['count','area']),
  aggregateMetrics: z.array(z.enum(['rent','vacancy','totalArea'])).min(1).max(3)
    .refine(metrics => new Set(metrics).size === metrics.length).optional(),
  aggregateFilter: aggregateFilterSchema.optional(),
}).refine(p => p.templateId === 'quarter-market-summary' || !p.aggregateMetrics && !p.aggregateFilter);
export type DynamicParameters = z.infer<typeof dynamicParametersSchema>;
export const generationPartSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.enum(['static','semi-dynamic']), templateId: z.string().min(1).max(100), assetIds: z.array(id).min(1).max(30),
    length: z.enum(['brief','detailed']), allowFallback: z.boolean(), variant: z.enum(['standard','alternate']), title: label.optional() }),
  z.strictObject({ mode: z.literal('dynamic'), parameters: dynamicParametersSchema, researchAssetId: id.optional(), title: label.optional() }),
]);
export const generationSchema = z.strictObject({ action: z.literal('generate'), projectId: id, title: label, scope: scopeSchema,
  language: z.enum(['zh','en']), themeId: z.string().min(1).max(100), themeVersion: z.number().int().positive(),
  parts: z.array(generationPartSchema).min(1).max(20), parentProjectId: id.optional(),
});
export type Generation = z.infer<typeof generationSchema>;
export const businessCommandSchema = z.discriminatedUnion('action', [
  generationSchema,
  z.strictObject({ action: z.literal('profile_save'), assetId: id, expectedVersion: z.number().int().positive(), profile: businessProfileSchema }),
  z.strictObject({ action: z.literal('recipe_save'), recipe: recipeSchema }),
  z.strictObject({ action: z.literal('restore'), projectId: id, sourceProjectId: id, title: label }),
]);
export const businessReadSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('catalog') }),
  z.strictObject({ action: z.literal('buildings'), q: z.string().trim().max(120).default(''), offset: z.coerce.number().int().min(0).max(10000).default(0) }),
  z.strictObject({ action: z.literal('profile'), assetId: id, version: z.coerce.number().int().positive().optional() }),
  z.strictObject({ action: z.literal('search'), kind: z.enum(['corporate','team','case','research','custom']).optional(), q: z.string().trim().max(120).optional(),
    region: label.optional(), city: label.optional(), line: label.optional(), language: z.enum(['zh','en']).optional(),
    service: label.optional(), property: label.optional(), tag: label.optional(), minimumScale: z.coerce.number().nonnegative().optional(), maximumScale: z.coerce.number().nonnegative().optional(), before: id.optional() }),
  z.strictObject({ action: z.literal('generation'), projectId: id }),
  z.strictObject({ action: z.literal('compare'), projectId: id, otherProjectId: id }),
]);
/** Reserved for phase 6. No provider or executable prompt in the interface. */
export const assistedInputSchema = z.strictObject({ protocol: z.literal('pitch-assisted/1'), facts: z.array(id).min(1).max(30),
  draft: slideContentSchema.refine(c => c.blocks.every(b => b.kind === 'insight'), 'Only evidence-bound insights'), status: z.literal('requires-independent-authorization') });
