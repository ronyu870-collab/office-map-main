import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { IMPERSONATION_REQUEST_HEADER } from '@/src/lib/server/impersonationAuth';
import { auditPayloadDigest, decryptAuditContent, encryptAuditContent } from './auditCrypto';
import { sanitizeAuditContent, type AuditKeys } from './auditStore';
import { readQueryBody } from './httpBody';
import type { queryHttpDependencies } from './http';
import { recordQueryIntake, decodeIntakeDocument, encodeIntakeDocument } from './intake';
import { decodeGeneratedArchive } from './resultArchive';
import { isQuerySameOrigin } from './sameOrigin';
import { verifyQueryIdentity, type VerifiedQueryIdentity } from './serverAuthority';

const stamp = z.iso.datetime({ offset: true });
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const entry = z.enum(['query_submission','query_result_recovery','query_result_artifact','query_delivery_report','legacy_intake','legacy_stream']);
const state = z.enum(['received','running','succeeded','failed','denied','cancelled','unstarted']);
export const auditConsoleInput = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('list'), from: stamp, to: stamp, actorId: z.uuid().optional(), state: state.optional(),
    entry: entry.optional(), keyword: z.string().trim().min(1).max(200).optional(), cursor: z.string().max(3000).optional() }),
  z.strictObject({ action: z.literal('intake'), id: z.uuid() }),
  z.strictObject({ action: z.literal('stream'), id: z.uuid() }),
]);
type Input = z.infer<typeof auditConsoleInput>;
const pageRow = z.object({ record_id: z.uuid(), request_id: z.uuid(), occurred_at: stamp, actor_id: z.uuid(), effective_user_id: z.uuid(),
  kind: z.enum(['intake','stream']), entry, related_state: state, cipher: z.unknown(), payload_digest: hash.nullable(), event_id: z.uuid().optional() });
const eventRow = z.object({ request_id: z.uuid(), event_id: z.uuid(), sequence: z.number().int().min(1).max(2048), kind: z.string(), occurred_at: stamp, payload_digest: hash, cipher: z.unknown() });
const streamSchema = z.object({ request_id: z.uuid(), actor_id: z.uuid(), effective_user_id: z.uuid(), state, head_sequence: z.number().int().min(1).max(2048), head_hash: hash }).passthrough();
const intakeRow = z.object({ event_id: z.uuid(), request_id: z.uuid(), actor_id: z.uuid(), effective_user_id: z.uuid().nullable(), occurred_at: stamp,
  entry: entry.nullable(), content_digest: hash.nullable(), cipher: z.unknown() }).passthrough();
const reply = (value: unknown, status: number) => Response.json(value, { status, headers: {
  'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',Vary:`Authorization, ${IMPERSONATION_REQUEST_HEADER}`,
} });

function equalHash(a: string, b: string) { return /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex')); }
function readDocument(cipher: unknown, context: {requestId:string;eventId:string;actorId:string;effectiveUserId:string}, digest: string, keys: AuditKeys, intake: boolean, received = false): unknown {
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
function question(document: unknown, intake: boolean): string {
  const value = z.object({content:z.record(z.string(),z.unknown())}).parse(document).content;
  if (!intake) return z.string().parse(value.submittedText);
  if (value.entry === 'query_delivery_report') return '客户端交付回执';
  const raw = z.object({rawRequest:z.string()}).parse(value.payload).rawRequest;
  try { const body = JSON.parse(raw); if (typeof body?.question === 'string') return body.question; } catch { /* Malformed submitted text is itself the original question. */ }
  return raw;
}
const cursorSchema = z.strictObject({ version:z.literal('audit-page/1'),actor:z.uuid(),session:z.uuid(),query:hash,revision:z.uuid(),
  beforeTime:stamp,beforeId:z.uuid(),unreadable:z.number().int().nonnegative(),expires:z.number().int() });
function queryDigest(input: Extract<Input,{action:'list'}>, keys: AuditKeys) {
  return auditPayloadDigest(JSON.stringify({from:input.from,to:input.to,actorId:input.actorId??null,state:input.state??null,entry:input.entry??null,keyword:input.keyword??null}),keys.digestKey);
}
function cursorMac(data: string, keys: AuditKeys) { return createHmac('sha256',keys.digestKey).update('audit-page/1:'+data).digest('hex'); }
function decodeCursor(token: string, input: Extract<Input,{action:'list'}>, identity: VerifiedQueryIdentity, keys: AuditKeys) {
  const [data,signature,...extra] = token.split('.');
  if (extra.length || !signature || !equalHash(signature,cursorMac(data,keys))) throw new Error('AUDIT_CONSOLE_DENIED');
  const value = cursorSchema.parse(JSON.parse(Buffer.from(data,'base64url').toString('utf8')));
  if (value.actor!==identity.actorId || value.session!==identity.sessionId || value.query!==queryDigest(input,keys) || value.expires<=Date.now()) throw new Error('AUDIT_CONSOLE_DENIED');
  return value;
}

/** Server-only audit read service. A search page scans at most 50 candidates;
 * continuation is explicit even when zero candidates match the plaintext term. */
export async function handleAuditConsole(request: Request, dependencies: ReturnType<typeof queryHttpDependencies> & {auditEnabled:boolean}): Promise<Response> {
  const accessId = randomUUID(), {client,keys} = dependencies;
  try {
    const body = await readQueryBody(request,keys.digestKey);
    const headers = new Headers(request.headers);headers.delete(IMPERSONATION_REQUEST_HEADER);
    let identity: VerifiedQueryIdentity | undefined;
    if (!body.rejection) { try { identity = await verifyQueryIdentity(new Request(request.url,{headers}),client); } catch { /* No forged actor. */ } }
    if (!identity || body.rejection) {
      await recordQueryIntake(client,keys,{requestId:accessId,body,entry:'query_submission',impersonationDenied:false});
      return reply({status:body.rejection?'rejected':'denied'},body.rejection?(body.rejection==='body_too_large'?413:400):401);
    }
    let input:Input|undefined, cursor:z.infer<typeof cursorSchema>|undefined;
    try {
      input=auditConsoleInput.parse(JSON.parse(body.text!));
      if (input.action==='list') {
        const span=Date.parse(input.to)-Date.parse(input.from);
        if(span<=0 || span>31*86400000 || Date.parse(input.to)>Date.now()+60000)throw new Error();
        if(input.cursor)cursor=decodeCursor(input.cursor,input,identity,keys);
      }
    } catch { input=undefined; }
    const valid = dependencies.auditEnabled && input && !request.headers.has(IMPERSONATION_REQUEST_HEADER)
      && isQuerySameOrigin(request) && /^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??'');
    const filter = !valid || !input ? {action:'invalid'} : input.action==='list' ? {action:input.action,from:input.from,to:input.to,
      actorId:input.actorId??null,state:input.state??null,entry:input.entry??null,beforeTime:cursor?.beforeTime??null,beforeId:cursor?.beforeId??null} : input;
    const logged = encodeIntakeDocument(sanitizeAuditContent({rawRequest:body.text,entry:'audit_console',requestId:accessId,
      inputDigest:body.digest,impersonationRequested:request.headers.has(IMPERSONATION_REQUEST_HEADER)}));
    const context = {requestId:accessId,eventId:accessId,actorId:identity.actorId,effectiveUserId:identity.effectiveUserId};
    const base = {p_actor:identity.actorId,p_effective:identity.effectiveUserId,p_session:identity.sessionId};
    const read = await client.rpc('ai_audit_console_read',{...base,p_access_id:accessId,p_filter:filter,
      p_content_digest:auditPayloadDigest(logged,keys.digestKey),p_cipher:encryptAuditContent(logged,context,keys.keyId,keys.encryptionKey),
    }).abortSignal(AbortSignal.timeout(25000));
    if(read.error || read.data?.unavailable)throw new Error('AUDIT_CONSOLE_UNAVAILABLE');
    if(!valid || !input || read.data?.allowed!==true)return reply({status:'denied'},403);
    const value=z.object({allowed:z.literal(true),revision:z.uuid(),records:z.array(z.unknown()).max(2048),stream:z.unknown(),has_more:z.boolean()}).parse(read.data);
    if(cursor && cursor.revision!==value.revision)return reply({status:'denied'},403);
    let response:unknown, returned:string[];
    if(input.action==='list') {
      const rows=z.array(pageRow).max(50).parse(value.records), items=[];
      let unreadable=0;
      for(const row of rows) {
        let text:string|null=null, contentState='available';
        if(!row.cipher || !row.payload_digest) {contentState='unavailable';unreadable++;}
        else { try {text=question(readDocument(row.cipher,{requestId:row.request_id,eventId:row.kind==='intake'?row.record_id:row.event_id!,actorId:row.actor_id,effectiveUserId:row.effective_user_id},row.payload_digest,keys,row.kind==='intake',row.kind==='stream'),row.kind==='intake');}
          catch {contentState='integrity_unavailable';unreadable++;} }
        if(input.keyword && (text===null || !text.normalize('NFKC').toLocaleLowerCase().includes(input.keyword.normalize('NFKC').toLocaleLowerCase())))continue;
        items.push({id:row.record_id,requestId:row.request_id,kind:row.kind,at:row.occurred_at,actorId:row.actor_id,effectiveUserId:row.effective_user_id,
          entry:row.entry,relatedExecutionState:row.related_state,contentState,excerpt:text?.slice(0,400)??null,truncated:(text?.length??0)>400});
      }
      let nextCursor:string|null=null;
      if(value.has_more && rows.length) {
        const last=rows.at(-1)!;
        const data=Buffer.from(JSON.stringify({version:'audit-page/1',actor:identity.actorId,session:identity.sessionId,query:queryDigest(input,keys),revision:value.revision,
          beforeTime:last.occurred_at,beforeId:last.record_id,unreadable:(cursor?.unreadable??0)+unreadable,expires:Math.min(identity.expiresAt,Date.now()+15*60000)})).toString('base64url');
        nextCursor=data+'.'+cursorMac(data,keys);
      }
      returned=items.map(item=>item.id);response={status:'ready',accessId,items,scanned:rows.length,unreadable,nextCursor,
        searchComplete:!value.has_more && (cursor?.unreadable??0)+unreadable===0,totalUnreadable:(cursor?.unreadable??0)+unreadable,totalMatches:null,semantics:'attempts_and_legacy_streams'};
    } else if(input.action==='intake') {
      const rows=z.array(intakeRow).max(1).parse(value.records), row=rows[0];
      const document=row?.cipher && row.content_digest && row.effective_user_id ? readDocument(row.cipher,{requestId:row.request_id,eventId:row.event_id,actorId:row.actor_id,effectiveUserId:row.effective_user_id},row.content_digest,keys,true):null;
      returned=row?[row.event_id]:[];response={status:'ready',accessId,record:row?{id:row.event_id,requestId:row.request_id,actorId:row.actor_id,effectiveUserId:row.effective_user_id,at:row.occurred_at,entry:row.entry,
        contentState:document?'available':'unavailable',document,meaning:'submitted_attempt_not_proof_of_execution'}:null};
    } else {
      const stream=value.stream===null?null:streamSchema.parse(value.stream), events=z.array(eventRow).max(2048).parse(value.records);
      if(stream && (stream.request_id!==input.id || stream.head_sequence!==events.length || events.some((e,i)=>e.request_id!==input.id || e.sequence!==i+1)))throw new Error('AUDIT_CONSOLE_INTEGRITY');
      const context=stream?{requestId:input.id,actorId:stream.actor_id,effectiveUserId:stream.effective_user_id}:null;
      const decoded=context?events.map(e=>({id:e.event_id,sequence:e.sequence,at:e.occurred_at,kind:e.kind,
        document:e.kind==='response_generated'?null:readDocument(e.cipher,{...context,eventId:e.event_id},e.payload_digest,keys,false,e.kind==='received')})):[];
      const parts=events.filter(e=>e.kind==='response_generated');let archive:unknown=null,archiveState='absent';
      if(context && parts.length) {try{archive=decodeGeneratedArchive(parts,context,new Map([[keys.keyId,keys]])).result;archiveState='available';}catch{archiveState='incomplete_or_invalid';}}
      returned=stream?[stream.request_id]:[];response={status:'ready',accessId,record:stream?{stream,events:decoded,generatedArchive:archive,archiveState,
        delivery:'inspect_delivery_events_not_proof_of_human_read',integrity:'current_database_chain_verified_not_independent_anchor'}:null};
    }
    if(identity.expiresAt<=Date.now())return reply({status:'denied'},403);
    const prepared=await client.rpc('ai_audit_console_prepare',{...base,p_access_id:randomUUID(),p_parent:accessId,p_returned:returned,
      p_response_digest:createHash('sha256').update(JSON.stringify(response)).digest('hex'),
    }).abortSignal(AbortSignal.timeout(10000));
    if(prepared.error)throw new Error('AUDIT_CONSOLE_UNAVAILABLE');
    if(prepared.data?.allowed!==true || identity.expiresAt<=Date.now())return reply({status:'denied'},403);
    return reply(response,200);
  } catch { return reply({status:'unavailable'},503); }
}
