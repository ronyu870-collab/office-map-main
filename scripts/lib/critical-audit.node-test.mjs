import {test} from 'node:test';
import assert from 'node:assert/strict';
import {criticalImport} from './critical-audit.mjs';
test('CLI critical import saves intent first and preserves unknown completion without replay',async()=>{
 let effects=0,fail=true;const calls=[];
 const client={from:()=>({insert:async row=>{calls.push(row);return{error:fail?{}:null};}}),rpc:async()=>({error:{code:'offline'},data:null})};
 const payload={actor_id:'verified',action_type:'SALES_MATERIAL_IMPORT',target_id:'material',details:{source_sha256:'synthetic'}};
 await assert.rejects(criticalImport(client,payload,async()=>{effects++;}),/尚未开始/);assert.equal(effects,0);
 fail=false;const result=await criticalImport(client,payload,async()=>{effects++;return{id:'material'};});
 assert.equal(effects,1);assert.equal(result.audit_pending,true);assert.equal(result.operation_id,calls[1].id);
});
