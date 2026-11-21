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
