import { operationMetadata } from '../control/operationsProjection';
import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { auditPayloadDigest, encryptAuditContent, redactSubmittedCredentials } from './auditCrypto';
import type { AuditPort } from './admission';
import type { VerifiedQueryIdentity } from './serverAuthority';
import { encodeGeneratedArchive } from './resultArchive';
import { relativeQuarterContextSchema } from './relativeQuarter';

export type AuditKeys = { keyId: string; encryptionKey: Uint8Array; digestKey: Uint8Array };
const receiptSchema = z.object({ event_id: z.uuid(), sequence: z.number().int().positive(), event_hash: z.string().regex(/^[0-9a-f]{64}$/), replayed: z.boolean() });

function firstEventId(requestId: string): string {
  const bytes = createHash('sha256').update(`ai-query-received:${requestId}`).digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|128; bytes[8]=(bytes[8]&63)|128;
  const hex=bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function sanitizeAuditContent(input: unknown): { content: unknown; redactionTypes: string[] } {
  const types = new Set<string>();
  let nodes=0;
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes>1000000 || depth>32) throw new Error('AUDIT_CONTENT_COMPLEXITY_LIMIT');
    if (typeof value==='string') {
      const redacted=redactSubmittedCredentials(value);
      redacted.redactionTypes.forEach(type=>types.add(type));
      return redacted.text;
    }
    if (value===null || typeof value==='number' || typeof value==='boolean') return value;
    if (Array.isArray(value)) return value.map(item=>visit(item,depth+1));
    if (typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,child])=>{
      if (/^(password|passwd|api[_ -]?key|secret[_ -]?key|access[_ -]?token|refresh[_ -]?token|密码)$/i.test(key)) {
        types.add('credential_field'); return [key,'[已脱敏:credential_field]'];
      }
      if (key==='rawRequest' && typeof child==='string') {
        try {
          const decoded=JSON.parse(child);
          const clean=visit(decoded,depth+1);
          // Decode JSON escapes before masking credentials inside question strings.
          // Preserve exact formatting if nothing was redacted; otherwise retain
          // canonical redacted JSON, while ingress keeps the original keyed digest.
          if(JSON.stringify(decoded)!==JSON.stringify(clean))return [key,JSON.stringify(clean)];
        } catch { /* Malformed JSON still follows bounded plain-text masking. */ }
      }
      return [key,visit(child,depth+1)];
    }));
    throw new Error('AUDIT_CONTENT_NOT_JSON');
  };
  return { content: visit(input,0), redactionTypes: [...types].sort() };
}

/** Server-created resolution metadata is not a new user submission on a retry.
 * Preserve the first resolved plan in encrypted content; bind idempotency to the
 * complete original request and grammar version, not a moving calendar quarter. */
export function submissionIdentityContent(request: { submittedText: string; plan: unknown; metadata?: unknown }) {
  const metadata = request.metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    && 'questionTimeResolution' in metadata) {
    z.object({ relation: z.literal('initial_question_submission'), grammarVersion: z.string().min(1),
      rawRequest: z.string(), questionTimeResolution: relativeQuarterContextSchema }).parse(metadata);
    const stable = { ...metadata };
    delete stable.questionTimeResolution;
    return sanitizeAuditContent({ submittedText: request.submittedText,
      plan: { resolution: 'server_relative_question/1' }, metadata: stable });
  }
  return sanitizeAuditContent({ submittedText: request.submittedText, plan: request.plan, metadata: metadata ?? null });
}

/** Real durable RPC adapter. Keys must be provisioned server-side; no fallback or browser key. */
export function createRpcAuditPort(client: SupabaseClient, identity: VerifiedQueryIdentity, keys: AuditKeys): AuditPort {
  let operational:boolean|undefined;
  const persist=async(name:'ai_query_audit_receive'|'ai_query_audit_append',args:Record<string,unknown>,metadata?:unknown)=>{
    const extended=name+'_operational';
    if(operational!==false){
      const result=await client.rpc(extended,{...args,...(name==='ai_query_audit_append'?{p_metadata:metadata??null}:{})}).abortSignal(AbortSignal.timeout(8000));
      if(!result.error){operational=true;return result;}
      if(result.error.code!=='PGRST202'||!result.error.message.includes(extended))return result;
      operational=false;
    }
    return client.rpc(name,args).abortSignal(AbortSignal.timeout(8000));
  };
  if (keys.encryptionKey.byteLength!==32 || keys.digestKey.byteLength!==32) throw new Error('AUDIT_KEY_UNAVAILABLE');
  const sealed = (requestId: string,eventId: string,content: string) => ({
    p_payload_digest: auditPayloadDigest(content,keys.digestKey),
    p_cipher: encryptAuditContent(content,{requestId,eventId,actorId:identity.actorId,effectiveUserId:identity.effectiveUserId},keys.keyId,keys.encryptionKey),
  });
  const appendOne = async (requestId: string,kind: string,content: string, projected?:unknown) => {
    const eventId=randomUUID();
    // Audit completion is independent of the browser abort signal, with its own finite deadline.
    let metadata:unknown=null;
    try{metadata=projected??operationMetadata(kind as Parameters<typeof operationMetadata>[0],JSON.parse(content));}catch{console.warn('AI_OPERATIONS_PROJECTION_UNAVAILABLE');}
    const { data,error }=await persist('ai_query_audit_append',{
      p_request_id:requestId,p_event_id:eventId,p_kind:kind,...sealed(requestId,eventId,content),
    },metadata);
    if(error)throw new Error('AUDIT_PERSISTENCE_UNAVAILABLE');
    receiptSchema.parse(data);
  };
  return {
    async receive(request) {
      z.uuid().parse(request.requestId);
      if(request.authority.actorId!==identity.actorId || request.authority.effectiveUserId!==identity.effectiveUserId)throw new Error('AUDIT_IDENTITY_MISMATCH');
      const eventId=firstEventId(request.requestId);
      const submitted=submissionIdentityContent(request);
      const content=JSON.stringify(sanitizeAuditContent({submittedText:request.submittedText,plan:request.plan,authority:request.authority,metadata:request.metadata??null,sessionId:identity.sessionId,entry:'query_api',timezone:'Asia/Shanghai',idempotencyVersion:'submission/3'}));
      const { data,error }=await persist('ai_query_audit_receive',{
        p_request_id:request.requestId,p_event_id:eventId,p_actor:identity.actorId,p_effective:identity.effectiveUserId,
        p_policy_version:request.authority.policyVersion,...sealed(request.requestId,eventId,content),
        // Session/role refresh does not change a submitted question's identity.
        // Cipher AEAD + the database event chain still bind the full first context.
        p_payload_digest:auditPayloadDigest(JSON.stringify(submitted),keys.digestKey),
      });
      if(error)throw new Error(error.code==='22023'&&error.message==='audit idempotency conflict'?'AUDIT_IDEMPOTENCY_CONFLICT':'AUDIT_PERSISTENCE_UNAVAILABLE');
      const receipt=receiptSchema.parse(data);
      return {replayed:receipt.replayed};
    },
    async append(requestId,kind,detail) {
      const content=JSON.stringify(sanitizeAuditContent(detail));
      const bytes=Buffer.from(content,'utf8');
      if(bytes.length<=80*1024) {await appendOne(requestId,kind,content);return;}
      if(kind!=='response_generated')throw new Error('AUDIT_CONTENT_LIMIT');
      const projected=operationMetadata(kind,detail);
      for(const part of encodeGeneratedArchive(content))await appendOne(requestId,kind,part,projected);
    },
  };
}
