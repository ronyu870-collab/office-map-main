import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { assertComplete, quarterKey, quarterSchema, type FactSnapshot, type Quarter, type SourceRef } from './contracts';
import { predicateInputFields, resolveNumericFact } from './facts';
import { numericFields, type NumericField } from './registry';
import { planOutputFields, planPeriods, type QueryPlan } from './plan';
import { authorizePlan } from './admission';
import type { DataAuthority, VerifiedQueryIdentity } from './serverAuthority';

const valuesSchema=z.record(z.string(),z.union([z.string(),z.null()]));
const versionSchema=z.string().regex(/^[0-9a-f]{64}$/);
const recordSchema=z.strictObject({id:z.string().min(1),version:versionSchema,recorded_at:z.string().nullable(),values:valuesSchema});
const rawSchema=z.strictObject({
  snapshot_id:z.uuid(),database_snapshot:z.string().min(1),read_at:z.string(),expected_count:z.number().int().min(0).max(20000),complete:z.literal(true),
  periods:z.array(quarterSchema).max(40),fields:z.array(z.enum(['height','floors','parking','totalArea','vacantArea','netEffectiveRent'])),
  inventory_time:z.literal('current_catalog'),brochure_selection:z.literal('all_unresolved_record_candidates'),
  rows:z.array(z.strictObject({
    id:z.uuid(),name:z.string().min(1),submarket:z.string().nullable(),grade:z.string().nullable(),is_active:z.boolean(),tracking_scope:z.string(),version:versionSchema,
    metrics:z.array(recordSchema.extend({year:z.number().int(),quarter:z.number().int()})),brochures:z.array(recordSchema),
  })).max(20000),
});
type RawSnapshot=z.infer<typeof rawSchema>;

export function describePlanRead(plan:QueryPlan):{fields:NumericField[];periods:Quarter[]} {
  const fields=new Set<NumericField>(planOutputFields(plan));
  for (const field of predicateInputFields(plan.filter)) fields.add(field);
  const periods=planPeriods(plan).filter((p):p is Quarter=>p!==null);
  if([...fields].some(field=>numericFields[field].temporal==='quarter')&&!periods.length)throw new Error('QUERY_PERIOD_REQUIRED');
  const uniquePeriods=[...new Map(periods.map(period=>[quarterKey(period),period])).values()];
  return {fields:[...fields].sort(),periods:uniquePeriods};
}

function hash(value:unknown):string{return createHash('sha256').update(JSON.stringify(value)).digest('hex');}

function validateRaw(input:unknown,fields:readonly NumericField[],periods:readonly Quarter[]):RawSnapshot {
  const raw=rawSchema.parse(input);
  if(raw.expected_count!==raw.rows.length || new Set(raw.rows.map(row=>row.id)).size!==raw.rows.length)throw new Error('INCOMPLETE_SNAPSHOT');
  if(JSON.stringify(raw.fields)!==JSON.stringify(fields)||JSON.stringify(raw.periods)!==JSON.stringify(periods))throw new Error('SNAPSHOT_QUERY_MISMATCH');
  const quarterFields=fields.filter(field=>numericFields[field].temporal==='quarter').sort();
  const brochureFields=fields.filter(field=>numericFields[field].temporal==='source').sort();
  const periodKeys=new Set(periods.map(quarterKey));
  for(const row of raw.rows){
    if(new Set(row.metrics.map(metric=>`${metric.year}-Q${metric.quarter}`)).size!==row.metrics.length)throw new Error('DUPLICATE_METRIC_PERIOD');
    if(new Set(row.brochures.map(record=>record.id)).size!==row.brochures.length)throw new Error('DUPLICATE_BROCHURE_RECORD');
    for(const metric of row.metrics){
      if(!periodKeys.has(`${metric.year}-Q${metric.quarter}`)||JSON.stringify(Object.keys(metric.values).sort())!==JSON.stringify(quarterFields))throw new Error('SNAPSHOT_FIELD_MISMATCH');
    }
    for(const record of row.brochures)if(JSON.stringify(Object.keys(record.values).sort())!==JSON.stringify(brochureFields))throw new Error('SNAPSHOT_FIELD_MISMATCH');
    if(!quarterFields.length&&row.metrics.length || !brochureFields.length&&row.brochures.length)throw new Error('UNREQUESTED_SOURCE');
  }
  return raw;
}

export function normalizeSnapshot(input:unknown,plan:QueryPlan,authority:DataAuthority):FactSnapshot[] {
  const read=describePlanRead(plan),raw=validateRaw(input,read.fields,read.periods);
  const dataVersion=hash(raw);
  const scopeFingerprint=hash([authority.actorId,authority.effectiveUserId,authority.permissionRevision,plan.scope,plan.filter??null]);
  for(const row of raw.rows){
    if((!authority.allSubmarkets&&!authority.submarkets.includes(row.submarket??''))||(!authority.allBuildings&&!authority.buildingIds.includes(row.id))
      ||(plan.scope.submarkets&&!plan.scope.submarkets.includes(row.submarket??''))||(plan.scope.buildingIds&&!plan.scope.buildingIds.includes(row.id))
      ||(plan.scope.inventory==='tracked'&&(!row.is_active||row.tracking_scope!=='tracked')))throw new Error('SNAPSHOT_SCOPE_MISMATCH');
  }
  const toRef=(entityId:string,field:NumericField,record:z.infer<typeof recordSchema>,period:Quarter|null):SourceRef=>({
    id:`${numericFields[field].table}/${record.id}/${field}/${record.version}`,table:numericFields[field].table,recordId:record.id,field:numericFields[field].column,
    entityId,recordVersion:record.version,rawValue:record.values[field],unit:numericFields[field].unit,period,recordedAt:record.recorded_at,
    businessAsOf:null,verification:'database_only',original:null,
  });
  return (read.periods.length?read.periods:[null]).map(period=>{
    const snapshot:FactSnapshot={
      snapshotId:`${raw.snapshot_id}/${period?quarterKey(period):'catalog'}`,dataVersion,scopeFingerprint,period,
      expectedCount:raw.expected_count,complete:true,
      queryScope:{...plan.scope,filter:plan.filter??null,requestedFields:read.fields,inventoryTime:raw.inventory_time,brochureSelection:raw.brochure_selection,readAt:raw.read_at},
      rows:raw.rows.map(row=>({id:row.id,name:row.name,
        nameSource:{id:`buildings/${row.id}/name/${row.version}`,table:'buildings',recordId:row.id,field:'name',entityId:row.id,recordVersion:row.version,rawValue:row.name,unit:'text',period:null,recordedAt:null,businessAsOf:null,verification:'database_only',original:null},
        dimensions:Object.fromEntries((['submarket','grade'] as const).map(field=>[field,{value:row[field],source:{id:`buildings/${row.id}/${field}/${row.version}`,table:'buildings',recordId:row.id,field,entityId:row.id,recordVersion:row.version,rawValue:row[field],unit:'text',period:null,recordedAt:null,businessAsOf:null,verification:'database_only',original:null}}])),
        facts:Object.fromEntries(read.fields.map(field=>{
          const records=numericFields[field].temporal==='quarter'?row.metrics.filter(metric=>period&&metric.year===period.year&&metric.quarter===period.quarter):row.brochures;
          return [field,resolveNumericFact(field,row.id,records.map(record=>toRef(row.id,field,record,numericFields[field].temporal==='quarter'?period:null)),period)];
        })),
      })),
    };
    assertComplete(snapshot);return snapshot;
  });
}

export async function readQuerySnapshots(client:SupabaseClient,identity:VerifiedQueryIdentity,authority:DataAuthority,plan:QueryPlan,signal:AbortSignal):Promise<FactSnapshot[]> {
  authorizePlan(plan,authority);
  if(identity.actorId!==authority.actorId||identity.effectiveUserId!==authority.effectiveUserId||identity.sessionId!==authority.sessionId||identity.expiresAt<=Date.now())throw new Error('QUERY_DENIED');
  const read=describePlanRead(plan);
  const {data,error}=await client.rpc('ai_query_snapshot_read',{
    p_actor:identity.actorId,p_effective:identity.effectiveUserId,p_session:identity.sessionId,p_permission_revision:authority.permissionRevision,
    p_fields:read.fields,p_periods:read.periods,p_inventory:plan.scope.inventory,p_submarkets:plan.scope.submarkets??null,p_building_ids:plan.scope.buildingIds??null,
  }).abortSignal(signal);
  signal.throwIfAborted();
  if(error)throw new Error(error.code==='42501'?'QUERY_DENIED':error.code==='54000'?'QUERY_SCOPE_REQUIRES_BACKGROUND_JOB':'QUERY_READ_UNAVAILABLE');
  return normalizeSnapshot(data,plan,authority);
}
