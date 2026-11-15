import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { auditPayloadDigest, decryptAuditContent } from './auditCrypto';
import { type AuditKeys } from './auditStore';
import { decodeIntakeDocument } from './intake';
import { decodeGeneratedArchive } from './resultArchive';
const stamp=z.iso.datetime({offset:true}),hash=z.string().regex(/^[0-9a-f]{64}$/);
const state=z.enum(['received','running','succeeded','failed','denied','cancelled','unstarted']);
const entry=z.enum(['query_submission','query_result_recovery','query_result_artifact','query_delivery_report','legacy_intake','legacy_stream']);
const eventRow = z.object({ request_id: z.uuid(), event_id: z.uuid(), sequence: z.number().int().min(1).max(2048), kind: z.string(), occurred_at: stamp, payload_digest: hash, cipher: z.unknown() });
const streamSchema = z.object({ request_id: z.uuid(), actor_id: z.uuid(), effective_user_id: z.uuid(), state, head_sequence: z.number().int().min(1).max(2048), head_hash: hash }).passthrough();
const intakeRow = z.object({ event_id: z.uuid(), request_id: z.uuid(), actor_id: z.uuid(), effective_user_id: z.uuid().nullable(), occurred_at: stamp,
  entry: entry.nullable(), content_digest: hash.nullable(), cipher: z.unknown() }).passthrough();
function equalHash(a: string, b: string) { return /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex')); }
export function readAuditDocument(cipher: unknown, context: {requestId:string;eventId:string;actorId:string;effectiveUserId:string}, digest: string, keys: AuditKeys, intake: boolean, received = false): unknown {
  const text = decryptAuditContent(cipher,context,new Map([[keys.keyId,keys.encryptionKey]]));
  if (!received && !equalHash(digest,auditPayloadDigest(text,keys.digestKey))) throw new Error('AUDIT_CONSOLE_INTEGRITY');
  const document = intake ? decodeIntakeDocument(text) : JSON.parse(text);
  if (received) {
    const value = z.object({content:z.object({submittedText:z.string(),plan:z.unknown(),metadata:z.unknown()}),redactionTypes:z.array(z.string())}).parse(document);
    const submitted = {content:{submittedText:value.content.submittedText,plan:value.content.plan,metadata:value.content.metadata},redactionTypes:value.redactionTypes};
    if (!equalHash(digest,auditPayloadDigest(JSON.stringify(submitted),keys.digestKey))) throw new Error('AUDIT_CONSOLE_INTEGRITY');
  }
  return document;
}

export function decodeAuditIntake(records: unknown, keys: AuditKeys) {
  const rows=z.array(intakeRow).max(1).parse(records),row=rows[0];
  const document=row?.cipher && row.content_digest && row.effective_user_id ? readAuditDocument(row.cipher,{requestId:row.request_id,eventId:row.event_id,actorId:row.actor_id,effectiveUserId:row.effective_user_id},row.content_digest,keys,true):null;
  return row?{id:row.event_id,requestId:row.request_id,actorId:row.actor_id,effectiveUserId:row.effective_user_id,at:row.occurred_at,entry:row.entry,
    contentState:document?'available':'unavailable',document,meaning:'submitted_attempt_not_proof_of_execution'}:null;
}
export function decodeAuditStream(id: string, rawStream: unknown, records: unknown, keys: AuditKeys) {
  const stream=rawStream===null?null:streamSchema.parse(rawStream),events=z.array(eventRow).max(2048).parse(records);
  if(stream && (stream.request_id!==id || stream.head_sequence!==events.length || events.some((e,i)=>e.request_id!==id || e.sequence!==i+1)))throw new Error('AUDIT_CONSOLE_INTEGRITY');
  const context=stream?{requestId:id,actorId:stream.actor_id,effectiveUserId:stream.effective_user_id}:null;
  const decoded=context?events.map(e=>({id:e.event_id,sequence:e.sequence,at:e.occurred_at,kind:e.kind,
    document:e.kind==='response_generated'?null:readAuditDocument(e.cipher,{...context,eventId:e.event_id},e.payload_digest,keys,false,e.kind==='received')})):[];
  const parts=events.filter(e=>e.kind==='response_generated');let archive:unknown=null,archiveState='absent';
  if(context && parts.length){try{archive=decodeGeneratedArchive(parts,context,new Map([[keys.keyId,keys]])).result;archiveState='available';}catch{archiveState='incomplete_or_invalid';}}
  return stream?{stream,events:decoded,generatedArchive:archive,archiveState,
    delivery:'inspect_delivery_events_not_proof_of_human_read',integrity:'current_database_chain_verified_not_independent_anchor'}:null;
}
