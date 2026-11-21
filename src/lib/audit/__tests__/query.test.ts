import {expect,it} from 'vitest';
import {applyAuditFilters,auditFiltersSchema} from '../query';
import {auditDefinition} from '@/src/utils/auditRegistry';
it('keeps historical lowercase critical events and conservative fallback in server-side risk filters',()=>{
 const calls:unknown[][]=[];const query:Record<string,unknown>={};
 for(const method of ['or','not','neq'])query[method]=(...args:unknown[])=>{calls.push([method,...args]);return query;};
 applyAuditFilters(query as Parameters<typeof applyAuditFilters>[0],auditFiltersSchema.parse({view:'all',excludeCodex:false,tier:'A'}));
 expect(JSON.stringify(calls)).toContain('impersonate_start');expect(JSON.stringify(calls)).toContain('DB_UPDATE');expect(JSON.stringify(calls)).toContain('action_type.ilike.*DELETE*');
 expect(auditDefinition('impersonate_start').tier).toBe('A');expect(auditDefinition('FUTURE_SENSITIVE_EXPORT').tier).toBe('A');expect(auditDefinition('EXPORT_TEMPLATE').tier).toBe('B');
 calls.length=0;applyAuditFilters(query as Parameters<typeof applyAuditFilters>[0],auditFiltersSchema.parse({view:'all',excludeCodex:false,tier:'B'}));
 expect(JSON.stringify(calls)).toContain('export_template');expect(JSON.stringify(calls)).toContain('action_type.not.ilike.*DELETE*');
});
