import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';

const MAX_CONTENT_BYTES = 96 * 1024;
const contextSchema = z.strictObject({ requestId: z.uuid(), eventId: z.uuid(), actorId: z.uuid(), effectiveUserId: z.uuid() });
export type AuditEncryptionContext = z.infer<typeof contextSchema>;
const cipherSchema = z.strictObject({
  version: z.literal(1), algorithm: z.literal('aes-256-gcm'),
  keyId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  nonce: z.string().regex(/^[0-9a-f]{24}$/), tag: z.string().regex(/^[0-9a-f]{32}$/),
  ciphertext: z.string().min(2).max(MAX_CONTENT_BYTES * 2).regex(/^(?:[0-9a-f]{2})+$/),
});
export type AuditCiphertext = z.infer<typeof cipherSchema>;

function associatedData(context: AuditEncryptionContext, keyId: string): Buffer {
  const valid = contextSchema.parse(context);
  return Buffer.from(JSON.stringify([1, 'aes-256-gcm', keyId, valid.requestId, valid.eventId, valid.actorId, valid.effectiveUserId]));
}

function keyBytes(key: Uint8Array | undefined): Buffer {
  if (!key || key.byteLength !== 32) throw new Error('AUDIT_KEY_UNAVAILABLE');
  return Buffer.from(key);
}

export function encryptAuditContent(plaintext: string, context: AuditEncryptionContext, keyId: string, key: Uint8Array): AuditCiphertext {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(keyId)) throw new Error('INVALID_AUDIT_KEY_ID');
  if (!plaintext || Buffer.byteLength(plaintext, 'utf8') > MAX_CONTENT_BYTES) throw new Error('AUDIT_CONTENT_LIMIT');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), nonce);
  cipher.setAAD(associatedData(context, keyId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { version: 1, algorithm: 'aes-256-gcm', keyId, nonce: nonce.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('hex') };
}

export function decryptAuditContent(envelope: unknown, context: AuditEncryptionContext, keys: ReadonlyMap<string, Uint8Array>): string {
  const cipher = cipherSchema.parse(envelope);
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(keys.get(cipher.keyId)), Buffer.from(cipher.nonce, 'hex'));
  decipher.setAAD(associatedData(context, cipher.keyId));
  decipher.setAuthTag(Buffer.from(cipher.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(cipher.ciphertext, 'hex')), decipher.final()]).toString('utf8');
}

/** Fingerprint the normalized/redacted submitted payload, with an independent server key. */
export function auditPayloadDigest(content: string, idempotencyKey: Uint8Array): string {
  return createHmac('sha256', keyBytes(idempotencyKey)).update(content, 'utf8').digest('hex');
}

/** Recognizable credentials only; never claim arbitrary secrets can be detected perfectly. */
export function redactSubmittedCredentials(submitted: string) {
  const types = new Set<string>();
  let text = submitted;
  const replace = (pattern: RegExp, type: string, prefix = false) => {
    text = text.replace(pattern, (_match, first: string) => {
      types.add(type);
      return `${prefix ? first : ''}[已脱敏:${type}]`;
    });
  };
  replace(/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g, 'private_key');
  replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'bearer_token');
  replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{16,})\b/g, 'api_key');
  replace(/(["']?(?:password|passwd|密码|api[_ -]?key|secret[_ -]?key)["']?\s*[:=：]\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,，;；}\]]+)/gi, 'explicit_credential', true);
  return { text, redactionTypes: [...types].sort(), redacted: types.size > 0 };
}
