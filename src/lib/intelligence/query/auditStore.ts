import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { auditPayloadDigest, encryptAuditContent, redactSubmittedCredentials } from './auditCrypto';
import type { AuditPort } from './admission';
import type { VerifiedQueryIdentity } from './serverAuthority';

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

/** Real durable RPC adapter. Keys must be provisioned server-side; no fallback or browser key. */
export function createRpcAuditPort(client: SupabaseClient, identity: VerifiedQueryIdentity, keys: AuditKeys): AuditPort {
  if (keys.encryptionKey.byteLength!==32 || keys.digestKey.byteLength!==32) throw new Error('AUDIT_KEY_UNAVAILABLE');
  const sealed = (requestId: string,eventId: string,content: string) => ({
    p_payload_digest: auditPayloadDigest(content,keys.digestKey),
    p_cipher: encryptAuditContent(content,{requestId,eventId,actorId:identity.actorId,effectiveUserId:identity.effectiveUserId},keys.keyId,keys.encryptionKey),
  });
  const appendOne = async (requestId: string,kind: string,content: string) => {
    const eventId=randomUUID();
    // Audit completion is independent of the browser abort signal, with its own finite deadline.
    const { data,error }=await client.rpc('ai_query_audit_append',{
      p_request_id:requestId,p_event_id:eventId,p_kind:kind,...sealed(requestId,eventId,content),
    }).abortSignal(AbortSignal.timeout(8000));
    if(error)throw new Error('AUDIT_PERSISTENCE_UNAVAILABLE');
    receiptSchema.parse(data);
  };
  return {
    async receive(request) {
      z.uuid().parse(request.requestId);
      if(request.authority.actorId!==identity.actorId || request.authority.effectiveUserId!==identity.effectiveUserId)throw new Error('AUDIT_IDENTITY_MISMATCH');
      const eventId=firstEventId(request.requestId);
      const submitted=sanitizeAuditContent({submittedText:request.submittedText,plan:request.plan,metadata:request.metadata??null});
      const content=JSON.stringify(sanitizeAuditContent({submittedText:request.submittedText,plan:request.plan,authority:request.authority,metadata:request.metadata??null,sessionId:identity.sessionId,entry:'query_api',timezone:'Asia/Shanghai',idempotencyVersion:'submission/2'}));
      const { data,error }=await client.rpc('ai_query_audit_receive',{
        p_request_id:request.requestId,p_event_id:eventId,p_actor:identity.actorId,p_effective:identity.effectiveUserId,
        p_policy_version:request.authority.policyVersion,...sealed(request.requestId,eventId,content),
        // Session/role refresh does not change a submitted question's identity.
        // Cipher AEAD + the database event chain still bind the full first context.
        p_payload_digest:auditPayloadDigest(JSON.stringify(submitted),keys.digestKey),
      }).abortSignal(AbortSignal.timeout(8000));
      if(error)throw new Error(error.code==='22023'&&error.message==='audit idempotency conflict'?'AUDIT_IDEMPOTENCY_CONFLICT':'AUDIT_PERSISTENCE_UNAVAILABLE');
      const receipt=receiptSchema.parse(data);
      return {replayed:receipt.replayed};
    },
    async append(requestId,kind,detail) {
      const content=JSON.stringify(sanitizeAuditContent(detail));
      const bytes=Buffer.from(content,'utf8');
      if(bytes.length<=80*1024) {await appendOne(requestId,kind,content);return;}
      if(kind!=='response_generated' || bytes.length>16*1024*1024)throw new Error('AUDIT_CONTENT_LIMIT');
      // Preserve large result snapshots; never truncate or silently omit their provenance.
      const chunkSize=48*1024, count=Math.ceil(bytes.length/chunkSize), groupId=randomUUID();
      for(let index=0;index<count;index++)await appendOne(requestId,kind,JSON.stringify({payloadType:'chunk',groupId,index,count,encoding:'base64',bytes:bytes.subarray(index*chunkSize,(index+1)*chunkSize).toString('base64')}));
      await appendOne(requestId,kind,JSON.stringify({payloadType:'manifest',groupId,count,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
    },
  };
}
