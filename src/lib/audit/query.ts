import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
type AuditQuery=ReturnType<ReturnType<SupabaseClient['from']>['select']>;
import { AUDIT_EVENT_REGISTRY } from '@/src/utils/auditRegistry';
export const TRAIL_ACTIONS=['PAGE_VIEW','ENTER_MODULE','MAP_FILTER','SEARCH','VIEW_BUILDING','VIEW_BI_CHART','OPEN_LEASE_FORM','LOOKUP_LEASE_COMPANY_HISTORY','VIEW_USER_SUBMISSION','CLIENT_MUTATION_OBSERVED'];
export const DATABASE_ACTIONS=['ADMIN_FIELD_CHANGE','QUARTERLY_RECORD_INSERT','QUARTERLY_RECORD_UPDATE','QUARTERLY_RECORD_DELETE','DB_INSERT','DB_UPDATE','DB_DELETE','LEASE_TRANSACTION_UPDATE','LEASE_TRANSACTION_INSERT','LEASE_TRANSACTION_DELETE','METRICS_INSERT','METRICS_UPDATE','METRICS_DELETE','LEASE_EXPIRY_REVIEW_SAVE','BUILDING_INSERT','BUILDING_UPDATE','BUILDING_DELETE'];
export const FILE_ACTIONS=['OSS_FILE_ACCESS','OSS_FILE_DOWNLOAD','OSS_UPLOAD','OSS_DELETE','OSS_BATCH_DELETE','OSS_CREATE_FOLDER','OSS_MOVE','EXPORT_DATA','EXPORT_LEASE_TRANSACTIONS','EXPORT_BACKUP','EXPORT_MAP_DATA','EXPORT_REPORT','EXPORT_TABLE','EXPORT_CHART','UPLOAD_FILE','DELETE_FILE','IMPORT_DATA','SALES_MATERIAL_IMPORT','SALES_MATERIAL_ACCESS','SALES_MATERIAL_DOWNLOAD','EXPORT_BUILDING_COMPARISON','AUDIT_EXPORT'];
export const PEOPLE_ACTIONS=['CREATE_USER','DELETE_USER','UPDATE_USER','USER_PERMISSION_CHANGE','CHANGE_PASSWORD','IMPERSONATE_START','IMPERSONATE_END','impersonate_start','impersonate_end','AUDIT_ACCESS_CHANGE'];
export const HIGH_RISK_ACTIONS=[...PEOPLE_ACTIONS,'DELETE_PROJECT','DB_DELETE','BUILDING_DELETE','LEASE_TRANSACTION_DELETE','OSS_DELETE','OSS_BATCH_DELETE','ACCESS_DENIED','EXPORT_BACKUP','AUDIT_EXPORT','EXPORT_LEASE_TRANSACTIONS'];
export const HIGH_RISK_FILTER=`action_type.in.(${HIGH_RISK_ACTIONS.join(',')}),error_message.not.is.null,actor_kind.eq.unknown`;
const string=z.string().max(500).default('');
export const auditFiltersSchema=z.strictObject({
 view:z.enum(['all','user','files','admin','database','trail','security','people']).default('user'),
 users:z.array(z.string().max(320)).max(300).nullable().default(null), excludedUsers:z.array(z.string().max(320)).max(300).nullable().default(null),
 excludeCodex:z.boolean().default(true),action:string,module:string,object:string,ip:string,device:string,
 session:z.union([z.uuid(),z.literal('')]).default(''),deviceType:z.enum(['','desktop','mobile','tablet','unknown']).default(''),
 from:z.union([z.iso.datetime({offset:true}),z.literal('')]).default(''),to:z.union([z.iso.datetime({offset:true}),z.literal('')]).default(''),
 highRisk:z.boolean().default(false),tier:z.enum(['','A','B']).default(''),outcome:z.enum(['','success','failed','denied','observed']).default(''),
 targetTable:string,targetId:string,operationId:z.string().max(100).regex(/^[A-Za-z0-9:_-]*$/).default(''),
});
export type AuditFilters=z.infer<typeof auditFiltersSchema>;
/** Shared bounded server-side filter semantics for list and export. Values go through the SDK, never raw OR interpolation. */
export function applyAuditFilters(query:AuditQuery,f:AuditFilters):AuditQuery {
 if(f.view==='admin') query=query.eq('action_type','ADMIN_DATA_OPERATION');
 if(f.view==='files') query=query.in('action_type',FILE_ACTIONS);
 if(f.view==='people') query=query.in('action_type',PEOPLE_ACTIONS);
 if(f.view==='database') query=query.or(`request_source.eq.database_trigger,action_type.in.(${DATABASE_ACTIONS.join(',')})`);
 if(f.view==='trail') query=query.in('action_type',TRAIL_ACTIONS);
 if(f.view==='security'||f.highRisk) query=query.or(HIGH_RISK_FILTER);
 if(f.view==='user') {
  for(const action of new Set(['ADMIN_DATA_OPERATION',...DATABASE_ACTIONS,...TRAIL_ACTIONS,'LOGIN','LOGIN_FAILED','LOGOUT'])) query=query.neq('action_type',action);
  query=query.or('request_source.neq.database_trigger,request_source.is.null');
 }
 if(f.users)query=query.in('user_id',f.users);
 else if(f.excludedUsers)for(const id of f.excludedUsers)query=query.neq('user_id',id);
 if(f.excludeCodex&&!f.users)query=query.neq('user_id','codex');
 for(const [column,value] of [['action_type',f.action],['module',f.module],['auth_session_id',f.session],['device_type',f.deviceType]])if(value)query=query.eq(column,value);
 for(const [column,value] of [['target_name',f.object],['ip_address',f.ip],['client_device_id',f.device]])if(value.trim())query=query.ilike(column,`%${value.trim().replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_')}%`);
 if(f.targetTable==='buildings'&&/^[0-9a-f-]{36}$/i.test(f.targetId)){query=query.or(`and(target_table.eq.buildings,target_id.eq.${f.targetId}),details->>building_id.eq.${f.targetId}`);}
 else {if(f.targetTable)query=query.eq('target_table',f.targetTable);if(f.targetId)query=query.eq('target_id',f.targetId);}
 if(f.operationId)query=query.or(`details->>operation_id.eq.${f.operationId},details->>request_id.eq.${f.operationId},details->>event_group.eq.${f.operationId},event_id.eq.${f.operationId}`);
 if(f.outcome==='observed')query=query.eq('request_source','frontend');
 else if(f.outcome) {query=query.neq('request_source','frontend');query=f.outcome==='success'?query.or('details->>outcome.eq.success,request_source.eq.database_trigger'):query.eq('details->>outcome',f.outcome);}
 if(f.from)query=query.gte('occurred_at',f.from);
 if(f.to)query=query.lte('occurred_at',f.to);
 if(f.tier){
  const entries=Object.entries(AUDIT_EVENT_REGISTRY);
  const critical=entries.filter(([,d])=>d.tier==='A').flatMap(([key])=>[key,key.toLowerCase()]);
  const ordinary=entries.filter(([,d])=>d.tier!=='A').flatMap(([key])=>[key,key.toLowerCase()]);
  const words=['DELETE','PERMISSION','GRANT','REVOKE','IMPORT','PASSWORD','BACKUP','CONFIG','ROLE','EXPORT'];
  // Same conservative fallback as auditDefinition; explicit ordinary exports win.
  query=f.tier==='A'
   ?query.or(`action_type.in.(${critical.join(',')}),and(action_type.not.in.(${ordinary.join(',')}),or(${words.map(word=>`action_type.ilike.*${word}*`).join(',')}))`)
   :query.not('action_type','in',`(${critical.join(',')})`).or(`action_type.in.(${ordinary.join(',')}),and(${words.map(word=>`action_type.not.ilike.*${word}*`).join(',')})`);
 }

 return query;
}
