import { describe,it,expect,vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { operationMetadata } from './operationsProjection';
import { createRpcAuditPort, sanitizeAuditContent } from '../query/auditStore';
import { routeEvaluation } from './evaluation';
describe('production-shaped safe operational projection',()=>{
 it('unwraps the real audit sanitizer and retains only registered model metadata',()=>{
  const raw={protocol:'agent-model-attempt/1',attempt:1,mode:'quick',provider:'deepseek',model:'deepseek-flash',purpose:'agent',configurationVersion:crypto.randomUUID(),state:'completed',durationMs:30,usageStatus:'provider_reported',inputTokens:10,outputTokens:5,estimateUsd:.001,prompt:'private prompt',rawResponse:'private response',continuation:'opaque',context:{messageBytes:20,opaqueBytes:0,prompt:'private'}};
  const projected=operationMetadata('accounting',sanitizeAuditContent(raw));
  expect(projected).toMatchObject({type:'model_attempt',attempt:1,inputTokens:10,messageBytes:20});
  expect(JSON.stringify(projected)).not.toMatch(/private|opaque"|continuation|prompt/);
 });
 it('does not mistake model prose for a formal result, or a sanitized summary for a lifecycle-only record',()=>{
  expect(operationMetadata('response_generated',{content:'I completed the result'})).not.toHaveProperty('formalResult');
  expect(operationMetadata('response_generated',sanitizeAuditContent({result:{resultId:crypto.randomUUID(),table:{columns:[]}}}))).toHaveProperty('formalResult',true);
  expect(operationMetadata('accounting',sanitizeAuditContent({provider:'server_policy',durationMs:90,filesRequested:1,filesCompleted:0,formalResult:true,status:'partial',operations:{mode:'deep',budgetRejection:'attempt_limit'}}))).toMatchObject({type:'summary',status:'partial',durationMs:90,errorCode:'attempt_limit',filesCompleted:0});
 });
 it('maps incomplete execution and post-completion delivery suppression without retaining a false formal delivery',()=>{
  expect(operationMetadata('succeeded',sanitizeAuditContent({executionStatus:'limited'}))).toMatchObject({status:'incomplete'});
  expect(operationMetadata('correction',sanitizeAuditContent({delivery:'not_sent',reason:'authorization_changed_before_response'}))).toMatchObject({status:'denied',formalResult:false,filesCompleted:0});
 });
 it('does not count a technically completed but incomplete formal answer as business success',()=>{
  const project=(answerStatus:string,executionStatus='completed')=>operationMetadata('succeeded',sanitizeAuditContent({provider:'server_policy',executionStatus,answerStatus,notice:'private business text'}));
  expect(project('answered')).toMatchObject({status:'completed'});
  expect(project('partial')).toMatchObject({status:'partial',errorCode:'answer_incomplete',errorCategory:'data'});
  expect(project('unavailable')).toMatchObject({status:'incomplete',errorCode:'answer_data_unavailable',errorCategory:'data'});
  expect(project('needs_conditions')).toMatchObject({status:'clarification'});
  expect(project('answered','partial')).toMatchObject({status:'partial'});
  expect(JSON.stringify(project('partial'))).not.toContain('private business text');
 });
 it('tracks explicit legal recovery and removes success after a final authorization correction',()=>{
  expect(operationMetadata('running',{phase:'result_recovery',recoveryRequested:true})).toMatchObject({recoveryRequested:true});
  expect(operationMetadata('succeeded',{recoveryCompleted:true})).toMatchObject({status:'completed',recoveryCompleted:true});
  expect(operationMetadata('correction',{delivery:'not_sent',reason:'recovery_not_granted'})).toMatchObject({status:'denied',recoveryCompleted:false,errorCategory:'security'});
 });
 it('passes real metadata in the original mandatory audit RPC, including fragmented result archives',async()=>{
  const rpc=vi.fn(()=>({abortSignal:async()=>({data:{event_id:crypto.randomUUID(),sequence:1,event_hash:'a'.repeat(64),replayed:false},error:null})}));
  const id=crypto.randomUUID(),actor=crypto.randomUUID();
  const audit=createRpcAuditPort({rpc} as unknown as SupabaseClient,{actorId:actor,effectiveUserId:actor,sessionId:crypto.randomUUID(),expiresAt:Date.now()+10000},{keyId:'isolated',encryptionKey:new Uint8Array(32).fill(1),digestKey:new Uint8Array(32).fill(2)});
  await audit.append(id,'accounting',{protocol:'agent-model-attempt/1',provider:'deepseek',model:'deepseek-flash',attempt:1,inputTokens:20,usageStatus:'provider_reported'});
  expect(rpc.mock.calls[0]).toEqual(['ai_query_audit_append_operational',expect.objectContaining({p_metadata:expect.objectContaining({type:'model_attempt',inputTokens:20})})]);
  rpc.mockClear();await audit.append(id,'response_generated',{resultId:crypto.randomUUID(),table:{columns:[]},padding:'x'.repeat(90000)});
  expect(rpc.mock.calls.length).toBeGreaterThan(1);for(const call of rpc.mock.calls)expect(call).toEqual(['ai_query_audit_append_operational',expect.objectContaining({p_metadata:expect.objectContaining({formalResult:true})})]);
 });
 it('runs fixed evaluation cases against the production router with no model or data calls',()=>{expect(routeEvaluation().filter(r=>r.state==='failed')).toEqual([]);});
});
