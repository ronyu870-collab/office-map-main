import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { auditPayloadDigest, decryptAuditContent } from './auditCrypto';

const INLINE_BYTES = 80 * 1024;
const CHUNK_BYTES = 48 * 1024;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_CHUNKS = Math.ceil(MAX_BYTES / CHUNK_BYTES);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const chunkSchema = z.strictObject({
  payloadType: z.literal('chunk'), groupId: z.uuid(), index: z.number().int().min(0).max(MAX_CHUNKS - 1),
  count: z.number().int().min(2).max(MAX_CHUNKS), encoding: z.literal('base64'),
  bytes: z.string().min(4).max(CHUNK_BYTES * 4 / 3).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
const manifestSchema = z.strictObject({
  payloadType: z.literal('manifest'), groupId: z.uuid(), count: z.number().int().min(2).max(MAX_CHUNKS),
  byteLength: z.number().int().min(INLINE_BYTES + 1).max(MAX_BYTES), sha256: digestSchema,
});
const snapshotSchema = z.strictObject({
  content: z.strictObject({ result: z.unknown() }),
  redactionTypes: z.array(z.string().min(1).max(80)).max(32),
});

/** The existing on-disk format stays compatible. Split bytes, not characters. */
export function encodeGeneratedArchive(content: string): readonly string[] {
  const bytes = Buffer.from(content, 'utf8');
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('AUDIT_CONTENT_LIMIT');
  if (bytes.length <= INLINE_BYTES) return [content];
  const count = Math.ceil(bytes.length / CHUNK_BYTES), groupId = randomUUID();
  const chunks = Array.from({ length: count }, (_, index) => JSON.stringify({
    payloadType: 'chunk', groupId, index, count, encoding: 'base64',
    bytes: bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES).toString('base64'),
  }));
  return [...chunks, JSON.stringify({ payloadType: 'manifest', groupId, count, byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') })];
}

export type GeneratedArchiveEvent = Readonly<{
  request_id: string; event_id: string; sequence: number; kind: string; payload_digest: string; cipher: unknown;
}>;
export type ArchiveKey = Readonly<{ encryptionKey: Uint8Array; digestKey: Uint8Array }>;

/** Server-only content recovery, NOT an authorization or stream-completeness gate.
 * Caller must first verify current identity/source ACLs, successful stream state,
 * and the complete event chain. Pass every response_generated event in stored
 * order; never select just the last manifest or silently sort damaged events.
 * This decoder authenticates AEAD context and each payload HMAC, but cannot
 * establish whether a whole database stream/tail was removed or rewritten. */
export function decodeGeneratedArchive(
  events: readonly GeneratedArchiveEvent[],
  context: Readonly<{ requestId: string; actorId: string; effectiveUserId: string }>,
  keys: ReadonlyMap<string, ArchiveKey>,
): { result: unknown; redactionTypes: readonly string[]; serializedContent: string; byteLength: number; sha256: string } {
  if (!events.length || events.length > MAX_CHUNKS + 1) throw new Error('AUDIT_ARCHIVE_INVALID');
  const seen = new Set<string>();
  let previous = 0, cipherBytes = 0;
  const plaintexts = events.map(event => {
    if (event.kind !== 'response_generated' || event.request_id !== context.requestId || !Number.isSafeInteger(event.sequence)
      || event.sequence <= previous || seen.has(event.event_id)) throw new Error('AUDIT_ARCHIVE_INVALID');
    previous = event.sequence; seen.add(event.event_id);
    const envelope = z.object({ keyId: z.string().max(80), ciphertext: z.string().max(192 * 1024) }).parse(event.cipher);
    cipherBytes += envelope.ciphertext.length;
    if (cipherBytes > 48 * 1024 * 1024) throw new Error('AUDIT_ARCHIVE_LIMIT');
    const material = keys.get(envelope.keyId);
    if (!material) throw new Error('AUDIT_KEY_UNAVAILABLE');
    const content = decryptAuditContent(event.cipher, { ...context, eventId: event.event_id }, new Map([[envelope.keyId, material.encryptionKey]]));
    const expected = Buffer.from(digestSchema.parse(event.payload_digest), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(auditPayloadDigest(content, material.digestKey), 'hex'))) throw new Error('AUDIT_ARCHIVE_DIGEST_MISMATCH');
    return content;
  });
  let bytes: Buffer;
  if (plaintexts.length === 1) {
    bytes = Buffer.from(plaintexts[0], 'utf8');
    if (bytes.length > INLINE_BYTES) throw new Error('AUDIT_ARCHIVE_INVALID');
  } else {
    const manifest = manifestSchema.parse(JSON.parse(plaintexts.at(-1)!));
    if (manifest.count !== plaintexts.length - 1 || manifest.count !== Math.ceil(manifest.byteLength / CHUNK_BYTES)) throw new Error('AUDIT_ARCHIVE_INCOMPLETE');
    const chunks = plaintexts.slice(0, -1).map((plaintext, index) => {
      const chunk = chunkSchema.parse(JSON.parse(plaintext));
      if (chunk.groupId !== manifest.groupId || chunk.index !== index || chunk.count !== manifest.count) throw new Error('AUDIT_ARCHIVE_INCOMPLETE');
      const decoded = Buffer.from(chunk.bytes, 'base64');
      const expectedLength = index === manifest.count - 1 ? manifest.byteLength - index * CHUNK_BYTES : CHUNK_BYTES;
      if (decoded.length !== expectedLength || decoded.toString('base64') !== chunk.bytes) throw new Error('AUDIT_ARCHIVE_INVALID');
      return decoded;
    });
    bytes = Buffer.concat(chunks, manifest.byteLength);
    if (createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new Error('AUDIT_ARCHIVE_DIGEST_MISMATCH');
  }
  // Decode only after joining bytes: a Chinese character may cross a chunk edge.
  const serializedContent = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const snapshot = snapshotSchema.parse(JSON.parse(serializedContent));
  if (!Object.hasOwn(snapshot.content, 'result')) throw new Error('AUDIT_ARCHIVE_INVALID');
  return { result: snapshot.content.result, redactionTypes: snapshot.redactionTypes,
    serializedContent, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
