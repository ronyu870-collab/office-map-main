import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { auditPayloadDigest, encryptAuditContent } from '../auditCrypto';
import { decodeGeneratedArchive, encodeGeneratedArchive, type GeneratedArchiveEvent } from '../resultArchive';
import { sanitizeAuditContent } from '../auditStore';

describe('authenticated generated-result archive recovery', () => {
  const context = { requestId: randomUUID(), actorId: randomUUID(), effectiveUserId: randomUUID() };
  const material = { encryptionKey: randomBytes(32), digestKey: randomBytes(32) };
  const rotated = { encryptionKey: randomBytes(32), digestKey: randomBytes(32) };
  const keys = new Map([['first', material], ['rotated', rotated]]);
  const seal = (parts: readonly string[], rotate = false): GeneratedArchiveEvent[] => parts.map((content, index) => {
    const eventId = randomUUID(), keyId = rotate && index % 2 ? 'rotated' : 'first';
    const key = keys.get(keyId)!;
    return { request_id: context.requestId, event_id: eventId, sequence: index + 3, kind: 'response_generated',
      payload_digest: auditPayloadDigest(content, key.digestKey), cipher: encryptAuditContent(content, { ...context, eventId }, keyId, key.encryptionKey) };
  });
  const content = (value: unknown) => JSON.stringify({ content: { result: value }, redactionTypes: [] });
  const large = content({ rows: Array.from({ length: 6000 }, (_, index) => ({ name: '中文楼宇😀' + index, value: index % 7 ? null : 0 })) });
  const read = (parts: readonly string[]) => decodeGeneratedArchive(seal(parts), context, keys);

  it('recovers inline and chunked results byte-for-byte, including Chinese, zero and unknown', () => {
    for (const serialized of [content({ height: null, rent: 170, vacancy: 0.175, zero: 0 }), large]) {
      const result = read(encodeGeneratedArchive(serialized));
      expect(result.serializedContent).toBe(serialized);
      expect(result.result).toEqual(JSON.parse(serialized).content.result);
      expect(result.byteLength).toBe(Buffer.byteLength(serialized));
      expect(result.sha256).toBe(createHash('sha256').update(serialized).digest('hex'));
    }
  });

  it('reads the original pre-decoder chunk format without rewriting stored snapshots', () => {
    const bytes = Buffer.from(large), groupId = randomUUID(), size = 48 * 1024, count = Math.ceil(bytes.length / size);
    const legacy = Array.from({ length: count }, (_, index) => JSON.stringify({ payloadType: 'chunk', groupId, index, count,
      encoding: 'base64', bytes: bytes.subarray(index * size, (index + 1) * size).toString('base64') }));
    legacy.push(JSON.stringify({ payloadType: 'manifest', groupId, count, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
    expect(read(legacy).serializedContent).toBe(large);
  });

  it('requires every encryption and HMAC key used by the archive', () => {
    const events = seal(encodeGeneratedArchive(large), true);
    expect(decodeGeneratedArchive(events, context, keys).serializedContent).toBe(large);
    expect(() => decodeGeneratedArchive(events, context, new Map([['first', material]]))).toThrow('AUDIT_KEY_UNAVAILABLE');
    expect(() => decodeGeneratedArchive(events, context, new Map([['first', { ...material, digestKey: randomBytes(32) }], ['rotated', rotated]]))).toThrow('AUDIT_ARCHIVE_DIGEST_MISMATCH');
  });

  it('rejects missing manifests, missing chunks, duplicate chunks and reversed order', () => {
    const parts = encodeGeneratedArchive(large);
    for (const damaged of [[], parts.slice(0, -1), parts.slice(1), [parts[0], ...parts], [...parts].reverse(), [parts.at(-1)!]]) {
      expect(() => read(damaged)).toThrow();
    }
  });

  it('rejects foreign groups, incorrect counts/length/digest and noncanonical base64', () => {
    const parts = encodeGeneratedArchive(large);
    const chunk = JSON.parse(parts[0]), manifest = JSON.parse(parts.at(-1)!);
    for (const change of [{ groupId: randomUUID() }, { index: 1 }, { count: chunk.count + 1 }, { bytes: chunk.bytes + '\n' }, { bytes: chunk.bytes.slice(4) }]) {
      expect(() => read([JSON.stringify({ ...chunk, ...change }), ...parts.slice(1)])).toThrow();
    }
    for (const change of [{ byteLength: manifest.byteLength - 1 }, { count: manifest.count + 1 }, { sha256: '0'.repeat(64) }, { extra: true }]) {
      expect(() => read([...parts.slice(0, -1), JSON.stringify({ ...manifest, ...change })])).toThrow();
    }
  });

  it('rejects request, actor, effective identity and event transplantation', () => {
    const events = seal([content({ value: 170 })]);
    for (const field of ['requestId', 'actorId', 'effectiveUserId']) {
      expect(() => decodeGeneratedArchive(events, { ...context, [field]: randomUUID() }, keys)).toThrow();
    }
    expect(() => decodeGeneratedArchive([{ ...events[0], event_id: randomUUID() }], context, keys)).toThrow();
    expect(() => decodeGeneratedArchive([{ ...events[0], kind: 'received' }], context, keys)).toThrow();
    expect(() => decodeGeneratedArchive([{ ...events[0], payload_digest: '0'.repeat(64) }], context, keys)).toThrow('AUDIT_ARCHIVE_DIGEST_MISMATCH');
    const cipher = events[0].cipher as { tag: string };
    expect(() => decodeGeneratedArchive([{ ...events[0], cipher: { ...cipher, tag: '0'.repeat(32) } }], context, keys)).toThrow();
  });

  it('rejects duplicate IDs and corrupt sequence order without sorting them into plausibility', () => {
    const events = seal(encodeGeneratedArchive(large));
    for (const change of [{ sequence: 0 }, { sequence: 3 }, { sequence: 4.5 }, { event_id: events[0].event_id }]) {
      expect(() => decodeGeneratedArchive([events[0], { ...events[1], ...change }, ...events.slice(2)], context, keys)).toThrow();
    }
  });

  it('rejects invalid UTF-8 even when a new manifest correctly hashes the damaged bytes', () => {
    const parts = [...encodeGeneratedArchive(large)];
    const first = JSON.parse(parts[0]), broken = Buffer.from(first.bytes, 'base64'); broken[100] = 0xff;
    parts[0] = JSON.stringify({ ...first, bytes: broken.toString('base64') });
    const manifest = JSON.parse(parts.at(-1)!);
    const bytes = Buffer.concat(parts.slice(0, -1).map(part => Buffer.from(JSON.parse(part).bytes, 'base64')));
    parts[parts.length - 1] = JSON.stringify({ ...manifest, sha256: createHash('sha256').update(bytes).digest('hex') });
    expect(() => read(parts)).toThrow();
  });

  it('keeps existing credential redaction evidence and does not invent original plaintext', () => {
    const snapshot = JSON.stringify(sanitizeAuditContent({ result: { answer: 'CBD季度租金170 password="synthetic-secret"' } }));
    const restored = read(encodeGeneratedArchive(snapshot));
    expect(restored.serializedContent).toBe(snapshot);
    expect(restored.serializedContent).not.toContain('synthetic-secret');
    expect(restored.redactionTypes).toContain('explicit_credential');
  });

  it('bounds result bytes and event counts and rejects unrelated decrypted envelopes', () => {
    expect(() => encodeGeneratedArchive('')).toThrow('AUDIT_CONTENT_LIMIT');
    expect(() => encodeGeneratedArchive('x'.repeat(16 * 1024 * 1024 + 1))).toThrow('AUDIT_CONTENT_LIMIT');
    expect(() => decodeGeneratedArchive(Array(344).fill(seal([content(null)])[0]), context, keys)).toThrow('AUDIT_ARCHIVE_INVALID');
    for (const invalid of ['null', '{"content":{},"redactionTypes":[]}', '{"content":{"result":1},"redactionTypes":[],"extra":1}']) {
      expect(() => read([invalid])).toThrow();
    }
  });
});
