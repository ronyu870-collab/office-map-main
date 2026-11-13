import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { auditPayloadDigest, decryptAuditContent, encryptAuditContent, redactSubmittedCredentials } from '../auditCrypto';

describe('protected question/answer content', () => {
  const context = { requestId: randomUUID(), eventId: randomUUID(), actorId: randomUUID(), effectiveUserId: randomUUID() };
  const key = randomBytes(32);
  it('round-trips actual Chinese questions and rotated keys without plaintext in envelopes', () => {
    const text = 'CBD有哪些楼？请列出高度缺失和冲突记录。';
    const first = encryptAuditContent(text, context, 'old', key);
    const secondKey = randomBytes(32);
    const second = encryptAuditContent(text, context, 'new', secondKey);
    const ring = new Map([['old', key], ['new', secondKey]]);
    expect(JSON.stringify(first)).not.toContain('CBD');
    expect(decryptAuditContent(first, context, ring)).toBe(text);
    expect(decryptAuditContent(second, context, ring)).toBe(text);
    expect(encryptAuditContent(text, context, 'old', key).nonce).not.toBe(first.nonce);
  });
  it('rejects ciphertext alteration, account/request/event transplantation and unavailable keys', () => {
    const cipher = encryptAuditContent('季度查数', context, 'v1', key);
    const ring = new Map([['v1', key]]);
    expect(() => decryptAuditContent({ ...cipher, tag: '0'.repeat(32) }, context, ring)).toThrow();
    for (const field of ['requestId', 'eventId', 'actorId', 'effectiveUserId']) expect(() => decryptAuditContent(cipher, { ...context, [field]: randomUUID() }, ring)).toThrow();
    expect(() => decryptAuditContent(cipher, context, new Map())).toThrow('AUDIT_KEY_UNAVAILABLE');
    expect(() => encryptAuditContent('question', context, 'v1', new Uint8Array())).toThrow('AUDIT_KEY_UNAVAILABLE');
  });
  it('enforces UTF-8 byte limits, not JavaScript character count', () => {
    expect(() => encryptAuditContent('楼'.repeat(40000), context, 'v1', key)).toThrow('AUDIT_CONTENT_LIMIT');
  });
  it('retains business questions and redacts explicit credentials, with typed evidence', () => {
    const clean = 'CBD租金是多少？客户A的需求是2000平方米。';
    expect(redactSubmittedCredentials(clean)).toEqual({ text: clean, redactionTypes: [], redacted: false });
    const output = redactSubmittedCredentials('CBD查数 password="dont-copy"；Bearer abc.def.ghi\napi_key=sk-12345678901234567890');
    expect(output.text).toContain('CBD查数');
    expect(output.text).not.toContain('dont-copy');
    expect(output.text).not.toContain('abc.def.ghi');
    expect(output.text).not.toContain('12345678901234567890');
    expect(output.redacted).toBe(true);
  });
  it('uses a separate keyed fingerprint without storing the unredacted original', () => {
    const hashKey=randomBytes(32);
    expect(auditPayloadDigest('same request',hashKey)).toBe(auditPayloadDigest('same request',hashKey));
    expect(auditPayloadDigest('same request',hashKey)).not.toBe(auditPayloadDigest('other request',hashKey));
    expect(auditPayloadDigest('same request',hashKey)).not.toBe(auditPayloadDigest('same request',randomBytes(32)));
  });
  it('redacts JSON credential fields and pasted private key blocks while retaining the question', () => {
    const submitted = '查一下CBD。配置是 {"password":"do-not-store", "api_key": "also-secret"}\n-----BEGIN PRIVATE KEY-----\nsynthetic-key-body\n-----END PRIVATE KEY-----';
    const output = redactSubmittedCredentials(submitted);
    expect(output.text).toContain('查一下CBD');
    expect(output.text).not.toContain('do-not-store');
    expect(output.text).not.toContain('also-secret');
    expect(output.text).not.toContain('synthetic-key-body');
  });
});
