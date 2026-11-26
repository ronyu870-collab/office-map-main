import { z } from 'zod';
import { managementCapabilitySchema, modelSchema } from './config';
const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/), reason=z.string().trim().min(1).max(500);
const revision=z.uuid().nullable(), timestamp=z.iso.datetime({offset:true});
const strings=z.array(z.string().trim().min(1).max(120)).max(100), ids=z.array(z.uuid()).max(100);
const base={enabled:z.boolean(),valid_until:timestamp};
const scope={all_submarkets:z.boolean(),submarkets:strings,all_buildings:z.boolean(),building_ids:ids};
export const grantPolicies={
  management:z.strictObject({valid_until:timestamp,capabilities:z.array(managementCapabilitySchema).max(6)}),
  query:z.strictObject({...base,...scope,capabilities:z.array(z.enum(['query:catalog','query:brochure','query:quarter','export:internal'])).max(4),fields:z.array(z.enum(['height','floors','parking','totalArea','vacantArea','netEffectiveRent'])).max(6)}),
  audit_read:z.strictObject({valid_until:timestamp}),
  audit_export:z.strictObject(base),
  lease:z.strictObject({...base,...scope,sources:z.array(z.enum(['live','history'])).max(2),allow_details:z.boolean(),allow_financials:z.boolean(),allow_export:z.boolean(),min_group_size:z.number().int().min(3).max(100)}),
  business:z.strictObject({...base,...scope,modules:z.array(z.enum(['profile','submarket','supply','stacking'])).max(4),profile_fields:strings,allow_submissions:z.boolean(),allow_export:z.boolean()}),
  knowledge:z.strictObject({...base,document_ids:ids,allow_public_search:z.boolean()}),
};
export const testKindSchema=z.enum(['connection','structured','tools','stream']);
export const alertRuleSchema=z.strictObject({id,metric:z.enum(['failure_rate','p95_ms','budget_percent','unknown_percent','fallback_percent','file_failure_percent','stalled','telemetry_gap','calls_per_request','estimated_usd','consecutive_failures','configuration_failures']),
  enabled:z.boolean(),threshold:z.number().positive().max(100000),minimumSamples:z.number().int().min(1).max(10000),windowMinutes:z.number().int().min(1).max(1440),cooldownMinutes:z.number().int().min(1).max(1440)});
export const administrationInputs=[
  z.strictObject({action:z.literal('catalog'),definition:modelSchema,expectedRevision:revision,reason}),
  z.strictObject({action:z.literal('inherit'),modelId:id,reason}),
  z.strictObject({action:z.literal('approve'),modelId:id,expectedRevision:z.uuid(),reason}),
  z.strictObject({action:z.literal('registry')}),
  z.strictObject({action:z.literal('budget')}),
  z.strictObject({action:z.literal('evaluate')}),
  z.strictObject({action:z.literal('evaluations')}),
  z.strictObject({action:z.literal('simulate'),question:z.string().trim().min(1).max(2000)}),
  z.strictObject({action:z.literal('diagnostics')}),
  z.strictObject({action:z.literal('alert_rule'),rule:alertRuleSchema,expectedRevision:revision,reason}),
  z.strictObject({action:z.literal('alert_action'),alertId:z.uuid(),state:z.enum(['acknowledged','closed','silenced']),until:timestamp.nullable(),reason}),
  z.strictObject({action:z.literal('grants'),search:z.string().trim().max(100),beforeId:z.uuid().optional()}),
  z.strictObject({action:z.literal('grant'),domain:z.enum(['management','query','audit_read','audit_export','lease','business','knowledge']),targetId:z.uuid(),expectedRevision:revision,policy:z.record(z.string(),z.unknown()),reason}).superRefine((v,ctx)=>{if(!grantPolicies[v.domain].safeParse(v.policy).success)ctx.addIssue({code:'custom',message:'invalid grant policy'});}),
  z.strictObject({action:z.literal('global'),expectedRevision:z.uuid(),enabled:z.boolean(),reason}),
  z.strictObject({action:z.literal('test_run'),modelId:id,expectedRevision:z.uuid(),kind:testKindSchema,confirmed:z.literal(true),maxUsd:z.number().positive().max(.05),reason}),
] as const;
export const registrySchema=z.object({allowed:z.literal(true),models:z.array(z.object({id,definition:modelSchema,revision:z.uuid(),updated_at:timestamp})).max(100),
  tests:z.array(z.object({id:z.uuid(),model_id:id,catalog_revision:z.uuid(),kind:testKindSchema,state:z.enum(['running','passed','failed']),started_at:timestamp,finished_at:timestamp.nullable(),summary:z.record(z.string(),z.unknown())})).max(100)});
export const budgetReadSchema=z.object({allowed:z.literal(true),asOf:timestamp,totals:z.array(z.object({scope:z.string().max(150),period:z.enum(['day','month']),startsOn:z.iso.date(),occupiedUsd:z.number().nonnegative()})).max(500),unsettledAttempts:z.number().int().nonnegative()});
export type Registry=z.infer<typeof registrySchema>;
export const evaluationsSchema=z.object({allowed:z.literal(true),runs:z.array(z.object({id:z.uuid(),created_at:timestamp,configuration_version:z.uuid().nullable(),summary:z.object({suiteVersion:z.literal('ai6-control-1'),paidCalls:z.literal(0),durationMs:z.number().nonnegative(),scope:z.literal('synthetic_offline_only'),actualBilledUsd:z.null(),results:z.array(z.object({name:z.string().max(120),state:z.enum(['offline_passed','failed']),scope:z.string().max(80)})).max(30)})})).max(100)});
export type Evaluations=z.infer<typeof evaluationsSchema>;
export type AlertRule=z.infer<typeof alertRuleSchema>;
export const diagnosticsSchema=z.object({allowed:z.literal(true),asOf:timestamp,
  rules:z.array(z.object({id,definition:alertRuleSchema,revision:z.uuid()})).max(30),
  alerts:z.array(z.object({id:z.uuid(),rule_id:id,state:z.enum(['new','acknowledged','ongoing','recovered','closed','silenced']),first_at:timestamp,last_at:timestamp,recovered_at:timestamp.nullable(),silenced_until:timestamp.nullable(),observed:z.number().nullable(),sample_count:z.number().int().nonnegative()})).max(30),
  toolsHealth:z.array(z.object({name:z.string().max(120),calls:z.number().int().nonnegative(),failures:z.number().int().nonnegative(),last_success:timestamp.nullable(),last_failure:timestamp.nullable()})).max(80).default([]),
  errors:z.array(z.object({code:z.string().max(120),provider:z.string().nullable(),model:z.string().nullable(),tool:z.string().nullable(),phase:z.string().nullable(),requests:z.number().int(),first_at:timestamp,last_at:timestamp})).max(100)});
export const grantsPageSchema=z.object({allowed:z.literal(true),users:z.array(z.object({id:z.uuid(),name:z.string().max(120),role:z.string().max(30),
  management:z.record(z.string(),z.unknown()).nullable(),query:z.record(z.string(),z.unknown()).nullable(),audit_read:z.record(z.string(),z.unknown()).nullable(),audit_export:z.record(z.string(),z.unknown()).nullable(),lease:z.record(z.string(),z.unknown()).nullable(),business:z.record(z.string(),z.unknown()).nullable(),knowledge:z.record(z.string(),z.unknown()).nullable()})).max(26)});
