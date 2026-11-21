import {expect,it} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import {applyAuditFilters,auditFiltersSchema} from '../query';
import {auditOutcome,auditDefinition} from '@/src/utils/auditRegistry';
it('keeps historical lowercase critical events and conservative fallback in the actual SDK filter URL',async()=>{
 const requests:URL[]=[];
 const client=createClient('https://example.supabase.co','synthetic',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async input=>{
  requests.push(new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url));return Response.json([]);
 }}});
 await applyAuditFilters(client.from('audit_logs').select('id'),auditFiltersSchema.parse({view:'all',excludeCodex:false,tier:'A'}));
 const critical=requests[0].searchParams.get('or');expect(critical).toContain('impersonate_start');expect(critical).toContain('DB_UPDATE');expect(critical).toContain('action_type.ilike.*DELETE*');
 expect(auditDefinition('impersonate_start').tier).toBe('A');expect(auditDefinition('FUTURE_SENSITIVE_EXPORT').tier).toBe('A');expect(auditDefinition('EXPORT_TEMPLATE').tier).toBe('B');
 await applyAuditFilters(client.from('audit_logs').select('id'),auditFiltersSchema.parse({view:'all',excludeCodex:false,tier:'B'}));
 const ordinary=requests[1].searchParams.get('or');expect(ordinary).toContain('export_template');expect(ordinary).toContain('action_type.not.ilike.*DELETE*');
});

it('does not present a durably recorded partial business result as full success',()=>{
 expect(auditOutcome({request_source:'server',details:{outcome:'success',business_outcome:'partial'}})).toBe('部分完成');
 expect(auditOutcome({request_source:'server',details:{outcome:'success',business_outcome:'failed'}})).toBe('失败');
 expect(auditOutcome({request_source:'frontend',details:{outcome:'success',business_outcome:'partial'}})).toBe('客户端报告');
});
it('finds all canonical downloads, photos and content observations in files and correlates their stages',async()=>{
 const requests:URL[]=[];
 const client=createClient('https://example.supabase.co','synthetic',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async input=>{requests.push(new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url));return Response.json([]);}}});
 await applyAuditFilters(client.from('audit_logs').select('id'),auditFiltersSchema.parse({view:'files',excludeCodex:false,operationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}));
 const actions=requests[0].searchParams.get('action_type')!;
 for(const action of ['BUILDING_PHOTO_ACCESS','BUILDING_PHOTO_DOWNLOAD','VIEW_BUILDING_PHOTO','VIEW_MATERIAL_CONTENT','SALES_MATERIAL_DOWNLOAD','OSS_FILE_DOWNLOAD','STACKING_PLAN_EXPORT','STACKING_PLAN_ORIGINAL_DOWNLOAD'])expect(actions).toContain(action);
 expect(requests[0].searchParams.get('or')).toContain('details->>correlation_id.eq.');
});
