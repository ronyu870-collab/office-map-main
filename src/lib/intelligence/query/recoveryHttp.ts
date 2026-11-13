import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IMPERSONATION_REQUEST_HEADER } from '@/src/lib/server/impersonationAuth';
import type { AuditPort, QueryAuthority } from './admission';
import { createRpcAuditPort } from './auditStore';
import { queryHttpDependencies } from './http';
import { readQueryBody } from './httpBody';
import { readOwnResult, recoverOwnResult } from './recovery';
import { loadDataAuthority, verifyQueryIdentity, type VerifiedQueryIdentity } from './serverAuthority';

const inputSchema=z.strictObject({requestId:z.uuid(),action:z.enum(['status','recover'])});
const json=(body:unknown,status:number)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store',
  Vary:`Authorization, ${IMPERSONATION_REQUEST_HEADER}`,'X-Content-Type-Options':'nosniff'}});

/** Control requests have their own durable audit; they never execute a new query. */
export async function handleResultRecovery(request:Request,dependencies:ReturnType<typeof queryHttpDependencies>):Promise<Response> {
  const attemptId=randomUUID(),{client,keys}=dependencies;
  let audit:AuditPort|undefined,received=false,terminal=false;
  try {
    const body=await readQueryBody(request,keys.digestKey);
    let identity:VerifiedQueryIdentity|undefined,impersonationDenied=false;
    if(!body.rejection){
      const headers=new Headers(request.headers);headers.delete(IMPERSONATION_REQUEST_HEADER);
      try{
        identity=await verifyQueryIdentity(new Request(request.url,{headers}),client);
        if(request.headers.has(IMPERSONATION_REQUEST_HEADER)){
          try{identity=await verifyQueryIdentity(request,client);}catch{impersonationDenied=true;}
        }
      }catch{/* Unverified callers never acquire an audit identity. */}
    }
    const ingress=await client.rpc('ai_query_record_ingress',{p_event_id:randomUUID(),p_request_id:attemptId,
      p_actor:identity?.actorId??null,p_session:identity?.sessionId??null,p_reason:body.rejection??(identity?'request_received':'unauthenticated'),
      p_bytes:body.bytesObserved,p_complete:body.complete,p_digest:body.digest,p_digest_scope:body.digestScope}).abortSignal(AbortSignal.timeout(8000));
    if(ingress.error)throw new Error('AUDIT_PERSISTENCE_UNAVAILABLE');
    if(body.rejection)return json({attemptId,status:'rejected',error:'请求未完整接收。'},body.rejection==='body_too_large'?413:400);
    if(!identity)return json({attemptId,status:'denied',error:'登录状态无效，请重新登录。'},401);
    audit=createRpcAuditPort(client,identity,keys);
    const pending:QueryAuthority={actorId:identity.actorId,effectiveUserId:identity.effectiveUserId,sessionActive:false,
      policyVersion:'http-receipt/1:authorization-pending',permissionRevision:'not_evaluated',grants:[],fields:[]};
    await audit.receive({requestId:attemptId,submittedText:body.text!,plan:null,authority:pending,
      metadata:{rawRequest:body.text,entry:'query_result_recovery',impersonationDenied}});received=true;
    let input:z.infer<typeof inputSchema>;
    try{input=inputSchema.parse(JSON.parse(body.text!));}catch{throw new Error('QUERY_DENIED');}
    if(!dependencies.enabled || impersonationDenied || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??'')
      || (request.headers.get('origin') && request.headers.get('origin')!==new URL(request.url).origin))throw new Error('QUERY_DENIED');
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(30000)]),verified=identity;
    const authority=await loadDataAuthority(client,verified,signal);
    await audit.append(attemptId,'running',{authority,sourceRequestId:input.requestId,action:input.action});
    const record=await readOwnResult(client,verified,input.requestId,input.action==='recover'?'archive':'status',signal);
    if(record.permission_revision!==authority.permissionRevision)throw new Error('QUERY_DENIED');
    const restored=input.action==='recover'&&record.state==='succeeded'
      ?await recoverOwnResult(client,verified,keys,input.requestId,record,signal):null;
    const responseBody=restored?{attemptId,requestId:input.requestId,status:'ready',result:restored.result,redactionTypes:restored.redactionTypes}
      :{attemptId,requestId:input.requestId,status:record.state};
    const bodySha256=createHash('sha256').update(JSON.stringify(responseBody)).digest('hex');
    await audit.append(attemptId,'response_generated',{result:{kind:'recovery_reference',sourceRequestId:input.requestId,
      sourceHeadSequence:record.head_sequence,sourceHeadHash:record.head_hash,resultId:restored?.resultId??null,bodySha256,state:record.state}});
    await audit.append(attemptId,'succeeded',{delivery:'not_yet_sent'});terminal=true;
    await audit.append(attemptId,'delivery_receipt',{phase:'response_prepared',bodySha256,httpStatus:200,clientReceipt:'unconfirmed',sourceRequestId:input.requestId});
    if(restored)await restored.recheck();
    const final=await readOwnResult(client,verified,input.requestId,'status',signal);
    if(final.permission_revision!==authority.permissionRevision)throw new Error('QUERY_DENIED');
    // A status response describes the observed version; normal progress during
    // the request is not an authorization failure. A restored archive must be
    // stable through delivery; changed streams require a fresh recovery attempt.
    if(restored && (final.head_hash!==record.head_hash || final.head_sequence!==record.head_sequence))throw new Error('QUERY_RESULT_CHANGED');
    return json(responseBody,200);
  }catch(error){
    const denied=error instanceof Error&&error.message==='QUERY_DENIED';
    const changed=error instanceof Error&&error.message==='QUERY_RESULT_CHANGED';
    if(audit&&received){
      try{await audit.append(attemptId,terminal?'correction':denied?'denied':'failed',{delivery:'not_sent',reason:denied?'recovery_not_granted':changed?'recovery_stream_changed':'recovery_unavailable'});}
      catch{return json({attemptId,status:'unavailable',error:'审计服务暂不可用，未交付结果。'},503);}
    }
    return json({attemptId,status:denied?'denied':changed?'changed':'unavailable',error:denied?'无法访问此请求。':changed?'请求状态已更新，请重试恢复。':'结果暂不可恢复，请稍后重试。'},denied?403:changed?409:503);
  }
}
