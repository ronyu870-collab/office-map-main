import assert from 'node:assert/strict';
import test from 'node:test';
import { reliableSourceGaps,unawaitedServerAuditCalls } from './audit-coverage-policy.mjs';
test('critical routes cannot pass through an audit keyword or ordinary managed task',()=>{
 const path='src/app/api/admin/create-user/route.ts';
 assert.ok(reliableSourceGaps(path,"// audit_logs\nawait writeAuditBestEffort(client,{action_type:'CREATE_USER'});").length);
 assert.ok(reliableSourceGaps(path,"scheduleAuditBestEffort(client,{action_type:'CREATE_USER'});").length);
 assert.deepEqual(reliableSourceGaps(path,'return await withCriticalAudit(client,payload,context,run);'),[]);
});
test('managed ordinary summaries need no awaited network write while reliable effects cannot be detached',()=>{
 assert.deepEqual(unawaitedServerAuditCalls("scheduleAuditBestEffort(client,{action_type:'BUILDING_PHOTO_ACCESS'});"),[]);
 assert.deepEqual(unawaitedServerAuditCalls('await withCriticalAudit(client,payload,context,run);'),[]);
 assert.deepEqual(unawaitedServerAuditCalls('return withCriticalAudit(client,payload,context,run);'),[]);
 assert.deepEqual(unawaitedServerAuditCalls('void withCriticalAudit(client,payload,context,run);'),['withCriticalAudit']);
});
test('transactional stacking contracts include both mutations and export evidence',()=>{
 const path='src/app/api/stacking-plan/[buildingId]/route.ts';
 assert.ok(reliableSourceGaps(path,"await client.rpc('stacking_plan_space_save',payload)").length);
 assert.deepEqual(reliableSourceGaps(path,"client.rpc('stacking_plan_space_save',p);client.rpc('stacking_plan_source_attach',p);client.from('stacking_plan_export_events').insert(p)"),[]);
});
