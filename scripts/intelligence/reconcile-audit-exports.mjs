// Explicitly local, one bounded batch. No ambient production URL or content key.
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
assert.equal(process.env.AI_EXPORT_RECONCILE_ALLOW_LOCAL,'disposable');
const url=new URL(process.env.AI_EXPORT_RECONCILE_URL??'');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));assert.ok(['http:','https:'].includes(url.protocol));
assert.equal(url.username,'');assert.equal(url.password,'');assert.equal(url.search,'');assert.equal(url.hash,'');assert.equal(url.pathname,'/');
const secret=process.env.AI_EXPORT_RECONCILE_SECRET;assert.ok(secret);
const worker=process.env.AI_EXPORT_RECONCILE_WORKER??'isolated-export-operator';assert.match(worker,/^[A-Za-z0-9_.:-]{1,120}$/);
const client=createClient(url.href,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const settled=await client.rpc('ai_audit_export_reconcile',{p_worker:worker,p_limit:20}).abortSignal(AbortSignal.timeout(30000));
if(settled.error || settled.data?.policy!=='audit-export-lifecycle/1')throw new Error('Export reconciliation unavailable');
const counts=await client.rpc('ai_audit_export_overview',{p_since:new Date(Date.now()-86400000).toISOString()}).abortSignal(AbortSignal.timeout(30000));
if(counts.error || counts.data?.policy!=='audit-export-lifecycle/1')throw new Error('Export overview unavailable');
console.log(JSON.stringify({reconciliation:settled.data,overview:counts.data}));
if(settled.data.outcomes.some(x=>x.state==='integrity_unavailable') || counts.data.missing_operations || counts.data.missing_history)process.exitCode=1;
