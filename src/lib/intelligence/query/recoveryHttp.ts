import { documentMetadata,readDocumentBytes } from '../knowledge/research';
import { isKnowledgeResult } from '../knowledge/protocol';
import { isResearchResult } from '../research/workspace';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IMPERSONATION_REQUEST_HEADER } from '@/src/lib/server/impersonationAuth';
import type { AuditPort, QueryAuthority } from './admission';
import { createRpcAuditPort } from './auditStore';
import { queryHttpDependencies } from './http';
import { readQueryBody } from './httpBody';
import { readOwnResult, recoverOwnResult } from './recovery';
import { loadDataAuthority, verifyQueryIdentity, type VerifiedQueryIdentity } from './serverAuthority';
import { isQuerySameOrigin } from './sameOrigin';
import { prepareDelivery } from './deliveryToken';
import { artifactInputSchema, buildResultArtifact, type ArtifactInput } from './artifacts';
import { recordQueryIntake } from './intake';
import { prepareQueryJsonResponse } from './jsonResponse';
import { buildingContextInputSchema } from './buildingCards';
import { readBuildingContext } from './buildingContext';
import { artifactContentDisposition } from './artifactFilename';

const documentInputSchema=z.strictObject({requestId:z.uuid(),resultId:z.uuid(),sourceId:z.string().min(1).max(200),action:z.literal('original')});
const inputSchema=z.strictObject({requestId:z.uuid(),action:z.enum(['status','recover'])});
const json=(body:unknown,status:number,extraHeaders:Record<string,string>={})=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store',
  Vary:`Authorization, ${IMPERSONATION_REQUEST_HEADER}`,'X-Content-Type-Options':'nosniff',...extraHeaders}});

/** Control requests have their own durable audit; they never execute a new query. */
export async function handleResultRecovery(request:Request,dependencies:ReturnType<typeof queryHttpDependencies>,mode:'recover'|'artifact'|'buildings'|'document'='recover'):Promise<Response> {
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
    await recordQueryIntake(client,keys,{requestId:attemptId,body,identity,
      entry:mode==='artifact'||mode==='document'?'query_result_artifact':'query_result_recovery',impersonationDenied});
    if(body.rejection)return json({attemptId,status:'rejected',error:'请求未完整接收。'},body.rejection==='body_too_large'?413:400);
    if(!identity)return json({attemptId,status:'denied',error:'登录状态无效，请重新登录。'},401);
    audit=createRpcAuditPort(client,identity,keys);
    const pending:QueryAuthority={actorId:identity.actorId,effectiveUserId:identity.effectiveUserId,sessionActive:false,
      policyVersion:'http-receipt/1:authorization-pending',permissionRevision:'not_evaluated',grants:[],fields:[]};
    await audit.receive({requestId:attemptId,submittedText:body.text!,plan:null,authority:pending,
      metadata:{rawRequest:body.text,entry:mode==='artifact'||mode==='document'?'query_result_artifact':'query_result_recovery',impersonationDenied}});received=true;
    let input:z.infer<typeof inputSchema>|ArtifactInput|z.infer<typeof buildingContextInputSchema>|z.infer<typeof documentInputSchema>;
    try{input=mode==='document'?documentInputSchema.parse(JSON.parse(body.text!)):mode==='artifact'?artifactInputSchema.parse(JSON.parse(body.text!)):mode==='buildings'?buildingContextInputSchema.parse(JSON.parse(body.text!)):inputSchema.parse(JSON.parse(body.text!));}catch{throw new Error('QUERY_DENIED');}
    if(!dependencies.enabled || impersonationDenied || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??'')
      || !isQuerySameOrigin(request))throw new Error('QUERY_DENIED');
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(30000)]),verified=identity;
    const authority=await loadDataAuthority(client,verified,signal);
    if((input.action==='export'||input.action==='copy')&&!authority.grants.includes('export:internal'))throw new Error('QUERY_DENIED');
    await audit.append(attemptId,'running',{authority,sourceRequestId:input.requestId,action:input.action});
    const record=await readOwnResult(client,verified,input.requestId,input.action!=='status'?'archive':'status',signal);
    if(record.permission_revision!==authority.permissionRevision)throw new Error('QUERY_DENIED');
    const restored=input.action!=='status'&&record.state==='succeeded'
      ?await recoverOwnResult(client,verified,keys,input.requestId,record,signal,{reauthorizedHistory:mode!=='recover',exporting:mode==='artifact'&&(input.action==='export'||input.action==='copy')}):null;
    let artifact=mode==='artifact'&&restored?await buildResultArtifact(restored.result,input as ArtifactInput):null;
    if(mode==='document'){
      const p=documentInputSchema.parse(input);if(!restored || !(isKnowledgeResult(restored.result as {parameters:Record<string,unknown>}) || isResearchResult(restored.result as {parameters:Record<string,unknown>})) || restored.resultId!==p.resultId)throw new Error('QUERY_DENIED');
      const view=restored.result as import('./result').QueryResult;
      const source=view.sources.find(s=>s.id===p.sourceId);if(!source?.original || source.table!=='building_sales_materials')throw new Error('QUERY_DENIED');
      const metadata=await documentMetadata(client,verified,signal,[source.original.documentId]);const doc=metadata.documents[0];
      if(doc.version!==source.original.version)throw new Error('QUERY_DENIED');
      const bytes=await readDocumentBytes(client,verified,signal,doc);
      const extension:Record<string,string>={'application/pdf':'pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx','application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx'};
      if(!extension[doc.mime])throw new Error('KNOWLEDGE_FORMAT_UNSUPPORTED');
      artifact={type:'download',bytes,contentType:doc.mime,filename:'内部资料原件.'+extension[doc.mime],sha256:doc.sha256,resultDigest:view.dataVersion};
    }
    if(mode==='artifact'&&!artifact)throw new Error('QUERY_RESULT_NOT_READY');
    const buildingContext=mode==='buildings'&&restored?await readBuildingContext(client,restored.result,input as z.infer<typeof buildingContextInputSchema>,signal):null;
    if(mode==='buildings'&&!buildingContext)throw new Error('QUERY_RESULT_NOT_READY');
    if (buildingContext && 'photoId' in input && input.photoId) {
      if (!input.buildingId || buildingContext.buildings.length !== 1 || buildingContext.buildings[0].id !== input.buildingId
        || buildingContext.buildings[0].photo?.id !== input.photoId) throw new Error('QUERY_DENIED');
      const { GET: loadPhoto } = await import('@/src/app/api/map/building-photos/route');
      const photoUrl = new URL('/api/map/building-photos', request.url);
      photoUrl.searchParams.set('building_id', input.buildingId); photoUrl.searchParams.set('photo_id', input.photoId); photoUrl.searchParams.set('preview', '1');
      const headers = new Headers(request.headers); headers.delete('content-type'); headers.delete('accept');headers.set('x-reading-entry','ai_query');headers.set('x-reading-id',attemptId);headers.set('x-reading-origin-id',input.requestId);
      const photoResponse = await loadPhoto(new Request(photoUrl, { headers, signal }));
      if (!photoResponse.ok) throw new Error('QUERY_READ_UNAVAILABLE');
      buildingContext.photoAccess = await photoResponse.json();
    }
    const responseBody=buildingContext?{attemptId,...buildingContext}:artifact?.type==='chart'?{attemptId,requestId:input.requestId,status:'ready',chart:artifact.chart,resultDigest:artifact.resultDigest}
      :artifact?.type==='copy'?{attemptId,requestId:input.requestId,status:'ready',resultId:artifact.resultId,format:artifact.format,text:artifact.text,resultDigest:artifact.resultDigest}
      :restored?{attemptId,requestId:input.requestId,status:'ready',result:restored.result,redactionTypes:restored.redactionTypes}
      :{attemptId,requestId:input.requestId,status:record.state};
    const bodySha256=artifact?.type==='download'?artifact.sha256:createHash('sha256').update(JSON.stringify(responseBody)).digest('hex');
    await audit.append(attemptId,'response_generated',{result:{kind:'recovery_reference',sourceRequestId:input.requestId,
      sourceHeadSequence:record.head_sequence,sourceHeadHash:record.head_hash,resultId:restored?.resultId??null,bodySha256,state:record.state,
      ...(buildingContext?{buildingMetadata:{version:'building-context/1',metadataReadAt:buildingContext.metadataReadAt,
        resultId:buildingContext.resultId,total:buildingContext.total,offset:buildingContext.offset,hasMore:buildingContext.hasMore,
        buildings:buildingContext.buildings,...(buildingContext.photoAccess?{photoSource:{sourceUrl:buildingContext.photoAccess.source_url,
          sourceName:buildingContext.photoAccess.source_name,attribution:buildingContext.photoAccess.attribution_text??null,
          licenseUrl:buildingContext.photoAccess.license_url??null,isPreview:buildingContext.photoAccess.is_preview}}:{})}}:{}),
      ...(artifact?{artifact:artifact.type==='chart'?{kind:'chart',spec:artifact.chart,resultDigest:artifact.resultDigest}
        :artifact.type==='copy'?{kind:'copy',format:artifact.format,text:artifact.text,resultDigest:artifact.resultDigest,rendererVersion:'result-copy/1'}
        :{kind:'download',format:mode==='document'?'document_original':(input as ArtifactInput & {format:string}).format,filename:artifact.filename,bytes:artifact.bytes.byteLength,resultDigest:artifact.resultDigest,rendererVersion:mode==='document'?'document-original/1':'result-chart/1',chart:'chart' in input?input.chart:null}}:{})}});
    await audit.append(attemptId,'succeeded',{delivery:'not_yet_sent'});terminal=true;
    const deliveryHeaders=await prepareDelivery(audit,keys,verified,{requestId:attemptId,bodySha256,
      kind:artifact?.type==='download'?'download':artifact?.type==='chart'?'chart':artifact?.type==='copy'?'copy':restored?'result':'status',
      resultId:restored?.resultId??null,itemCount:artifact?.type==='chart'?artifact.chart.points.length:restored?(restored.result as {table:{rows:unknown[]}}).table.rows.length:0},
      {httpStatus:200,sourceRequestId:input.requestId});
    const jsonResponse = artifact?.type === 'download' ? null : await prepareQueryJsonResponse(request, responseBody, deliveryHeaders);
    if(restored)await restored.recheck();
    const final=await readOwnResult(client,verified,input.requestId,'status',signal);
    if(final.permission_revision!==authority.permissionRevision)throw new Error('QUERY_DENIED');
    // A status response describes the observed version; normal progress during
    // the request is not an authorization failure. A restored archive must be
    // stable through delivery; changed streams require a fresh recovery attempt.
    if(restored && (final.head_hash!==record.head_hash || final.head_sequence!==record.head_sequence))throw new Error('QUERY_RESULT_CHANGED');
    if(artifact?.type==='download')return new Response(new Uint8Array(artifact.bytes),{status:200,headers:{
      'Content-Type':artifact.contentType,'Content-Disposition':artifactContentDisposition(artifact.filename),
      'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',Vary:`Authorization, ${IMPERSONATION_REQUEST_HEADER}`,
      'X-Query-Result-Id':input.action==='export'||input.action==='original'?input.resultId:'','X-Artifact-Sha256':artifact.sha256,'X-Audit-Attempt-Id':attemptId,...deliveryHeaders,
    }});
    return jsonResponse!;
  }catch(error){
    const denied=error instanceof Error&&error.message==='QUERY_DENIED';
    const changed=error instanceof Error&&error.message==='QUERY_RESULT_CHANGED';
    const unsupported=mode==='artifact'&&error instanceof Error&&/^(?:CHART_|ARTIFACT_|XLSX_|REPORT_)/.test(error.message);
    if(audit&&received){
      try{await audit.append(attemptId,terminal?'correction':denied?'denied':'failed',{delivery:'not_sent',reason:denied?'recovery_not_granted':changed?'recovery_stream_changed':unsupported?'artifact_unsupported':'recovery_unavailable'});}
      catch{return json({attemptId,status:'unavailable',error:'审计服务暂不可用，未交付结果。'},503);}
    }
    return json({attemptId,status:denied?'denied':changed?'changed':unsupported?'unsupported':'unavailable',error:denied?'无法访问此请求。':changed?'请求状态已更新，请重试恢复。':unsupported?'这个结果不支持所选图表或导出规格，请调整后重试。':'结果暂不可恢复，请稍后重试。'},denied?403:changed?409:unsupported?422:503);
  }
}
