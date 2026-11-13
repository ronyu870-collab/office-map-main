import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { IMPERSONATION_REQUEST_HEADER } from '@/src/lib/server/impersonationAuth';
import { auditPayloadDigest, encryptAuditContent } from './auditCrypto';
import { sanitizeAuditContent, type AuditKeys } from './auditStore';
import { readQueryBody } from './httpBody';
import { recordQueryIntake, encodeIntakeDocument } from './intake';
import { isQuerySameOrigin } from './sameOrigin';
import { verifyQueryIdentity, type VerifiedQueryIdentity } from './serverAuthority';
import { decodeAuditIntake, decodeAuditStream } from './auditConsoleDecode';
import { auditExportTargetsSchema, auditExportTargetSchema, auditExportDocumentSchema } from './auditExportView';
import type { queryHttpDependencies } from './http';
const hash=z.string().regex(/^[0-9a-f]{64}$/),stamp=z.iso.datetime({offset:true});
const inputSchema=z.discriminatedUnion('action',[
  z.strictObject({action:z.literal('export'),targets:auditExportTargetsSchema}),
  z.strictObject({action:z.literal('report'),receiptToken:z.string().min(1).max(3000)}),
]);
const resultSchema=z.object({allowed:z.literal(true),policy:z.literal('audit-export/2'),read_revision:z.uuid(),export_revision:z.uuid(),bundles:z.array(z.unknown()).max(50)});
const rawSnapshot=z.object({outcome:z.literal('allowed'),records:z.array(z.unknown()).max(2048),stream:z.unknown()});
const bundleSchema=z.object({target:auditExportTargetSchema,request_id:z.uuid(),captured_at:stamp,intake:rawSnapshot.nullable(),stream:rawSnapshot});
const receiptSchema=z.strictObject({version:z.literal('audit-export-receipt/1'),actor:z.uuid(),session:z.uuid(),prepareId:z.uuid(),digest:hash,bytes:z.number().int().min(1).max(67108864),expires:z.number().int()});
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',Vary:`Authorization, ${IMPERSONATION_REQUEST_HEADER}`};
const reply=(status:number)=>Response.json({status:status===200?'accepted':status===503?'unavailable':'denied'},{status,headers});
function mac(raw:string,keys:AuditKeys){return createHmac('sha256',keys.digestKey).update('audit-export-receipt/1:'+raw).digest('hex');}
function token(value:z.infer<typeof receiptSchema>,keys:AuditKeys){const raw=Buffer.from(JSON.stringify(value)).toString('base64url');return raw+'.'+mac(raw,keys);}
function receipt(raw:string,identity:VerifiedQueryIdentity,keys:AuditKeys){
  const [data,sig,...extra]=raw.split('.'),expected=mac(data,keys);
  if(extra.length || !/^[a-f0-9]{64}$/.test(sig??'') || !timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(expected,'hex')))throw new Error('DENIED');
  const value=receiptSchema.parse(JSON.parse(Buffer.from(data,'base64url').toString('utf8')));
  if(value.actor!==identity.actorId || value.session!==identity.sessionId || value.expires<=Date.now())throw new Error('DENIED');
  return value;
}
export async function handleAuditExport(request:Request,dependencies:ReturnType<typeof queryHttpDependencies>&{auditEnabled:boolean}):Promise<Response>{
  const {client,keys}=dependencies,eventId=randomUUID();
  let failedIdentity:VerifiedQueryIdentity|undefined;
  try{
    const body=await readQueryBody(request,keys.digestKey);
    const authHeaders=new Headers(request.headers);authHeaders.delete(IMPERSONATION_REQUEST_HEADER);
    let identity:VerifiedQueryIdentity|undefined;
    if(!body.rejection){try{identity=await verifyQueryIdentity(new Request(request.url,{headers:authHeaders}),client);}catch{/* No claimed identity. */}}
    if(!identity || body.rejection){
      await recordQueryIntake(client,keys,{requestId:eventId,body,entry:'query_submission',impersonationDenied:request.headers.has(IMPERSONATION_REQUEST_HEADER)});
      return reply(body.rejection?(body.rejection==='body_too_large'?413:400):401);
    }
    const base={p_actor:identity.actorId,p_effective:identity.effectiveUserId,p_session:identity.sessionId};
    let input:z.infer<typeof inputSchema>|undefined,report:z.infer<typeof receiptSchema>|undefined;
    try{input=inputSchema.parse(JSON.parse(body.text!));if(input.action==='report')report=receipt(input.receiptToken,identity,keys);}catch{input=undefined;}
    const valid=dependencies.auditEnabled && input && !request.headers.has(IMPERSONATION_REQUEST_HEADER)
      && isQuerySameOrigin(request) && /^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??'');
    const rpc=async(args:Record<string,unknown>)=>{
      const result=await client.rpc('ai_audit_export_control',{...base,...args}).abortSignal(AbortSignal.timeout(30000));
      if(result.error || result.data?.unavailable)throw new Error('UNAVAILABLE');return result.data;
    };
    if(valid && input?.action==='report' && report){
      const r=await rpc({p_event:eventId,p_phase:'client_dispatch',p_parent:report.prepareId,p_targets:null,p_digest:report.digest,p_bytes:report.bytes,p_cipher:null});
      if(r?.allowed!==true || !resultSchema.safeParse(r).success || identity.expiresAt<=Date.now())return reply(403);
      return reply(200);
    }
    // Receipt tokens are technical proofs and never copied into the original-text ledger.
    let loggedBody:unknown=body.text;
    try{const parsed=JSON.parse(body.text!);if(typeof parsed?.receiptToken==='string')loggedBody={...parsed,receiptToken:'[REDACTED_DELIVERY_TOKEN]'};}catch{/* Preserve malformed export input under encryption. */}
    const original=encodeIntakeDocument(sanitizeAuditContent({entry:'audit_export',rawRequest:loggedBody,inputDigest:body.digest}));
    failedIdentity=identity;
    const read=await rpc({p_event:eventId,p_phase:valid&&input?.action==='export'?'read':'invalid',p_parent:null,
      p_targets:input?.action==='export'?input.targets:[],p_digest:auditPayloadDigest(original,keys.digestKey),p_bytes:null,
      p_cipher:encryptAuditContent(original,{requestId:eventId,eventId,actorId:identity.actorId,effectiveUserId:identity.effectiveUserId},keys.keyId,keys.encryptionKey)});
    if(!valid || input?.action!=='export' || read?.allowed!==true)return reply(403);
    const data=resultSchema.parse(read);
    if(data.bundles.length!==input.targets.length)throw new Error('INCOMPLETE');
    const records=[];let decodedBytes=0;
    for(const [index,raw] of data.bundles.entries()){
      const b=bundleSchema.parse(raw),target=input.targets[index];
      if(b.target.id!==target.id || b.target.kind!==target.kind)throw new Error('MISMATCH');
      const intake=b.intake?decodeAuditIntake(b.intake.records,keys):null;
      if(target.kind==='intake' && (!intake || intake.id!==target.id || intake.requestId!==b.request_id))throw new Error('MISMATCH');
      if(target.kind==='stream' && (intake || b.request_id!==target.id))throw new Error('MISMATCH');
      const execution=decodeAuditStream(b.request_id,b.stream.stream,b.stream.records,keys);
      if(target.kind==='stream' && !execution)throw new Error('INCOMPLETE');
      const record={target,capturedAt:b.captured_at,requestId:b.request_id,intake,execution};
      decodedBytes+=Buffer.byteLength(JSON.stringify(record));if(decodedBytes>67108864)throw new Error('TOO_LARGE');
      records.push(record);
    }
    const document=auditExportDocumentSchema.parse({format:'audit-export/1',exportId:eventId,requestedBy:identity.actorId,exportedAt:new Date().toISOString(),
      purpose:'internal_audit_only',coverage:'selected_records_only',targets:input.targets,records,
      limitations:['仅包含本次明确选择的记录，不代表筛选条件下全部记录。','每条提交与关联执行分开保留；重试不证明再次执行。','回答为留存生成快照，实际交付按事件核对，不证明人类已读或磁盘已保存。','原件仅保留已有受控引用，不附原始文件；已下载内容无法远程撤回。','各记录使用各自读取时版本，不构成跨记录同一时刻的全库快照。','缺失正文、缺失回答和不完整档案保留其状态，不填补或重新生成。']});
    const bytes=Buffer.from(JSON.stringify(document,null,2)+'\n');if(bytes.length>67108864)throw new Error('TOO_LARGE');
    const digest=createHash('sha256').update(bytes).digest('hex'),prepareId=randomUUID();
    if(identity.expiresAt<=Date.now())return reply(403);
    const prepared=await rpc({p_event:prepareId,p_phase:'prepare',p_parent:eventId,p_targets:null,p_digest:digest,p_bytes:bytes.length,p_cipher:null});
    if(prepared?.allowed!==true || !resultSchema.safeParse(prepared).success || identity.expiresAt<=Date.now())return reply(403);
    const receiptToken=token({version:'audit-export-receipt/1',actor:identity.actorId,session:identity.sessionId,prepareId,digest,bytes:bytes.length,expires:Math.min(identity.expiresAt,Date.now()+5*60000)},keys);
    return new Response(bytes,{status:200,headers:{...headers,'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="ai-audit-${eventId}.json"`,
      'X-Audit-Export-Id':eventId,'X-Audit-Export-Sha256':digest,'X-Audit-Export-Receipt':receiptToken}});
  }catch{
    if(failedIdentity){
      // Best effort closure; durable database observation handles process loss or
      // another database failure. A committed prepare can never be overwritten.
      try{await client.rpc('ai_audit_export_fail',{p_export:eventId,p_actor:failedIdentity.actorId,p_session:failedIdentity.sessionId}).abortSignal(AbortSignal.timeout(5000));}catch{/* Reconciler records unknown after deadline. */}
    }
    return reply(503);
  }
}
