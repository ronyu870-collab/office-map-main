import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { writeFile, open, rm } from 'node:fs/promises';
import { digest } from './common.mjs';
import { Transform } from 'node:stream';
import { retryRead } from './reads.mjs';

export function store(c, { requestHandler } = {}) {
  if (requestHandler && !c.synthetic) throw new Error('PRODUCTION_TRANSPORT_OVERRIDE_REJECTED');
  const url = new URL(c.endpoint);
  if (c.synthetic ? !['127.0.0.1', 'localhost'].includes(url.hostname) : url.href !== `https://${c.account}.r2.cloudflarestorage.com/`) throw new Error('R2_ENDPOINT_REJECTED');
  const client = new S3Client({ region: 'auto', endpoint: c.endpoint, credentials: c.credentials, forcePathStyle: true, maxAttempts: 2, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', requestHandler: requestHandler ?? { connectionTimeout: 15_000, socketTimeout: 120_000, requestTimeout: 900_000, throwOnRequestTimeout: true }, logger: { trace() {}, debug() {}, info() {}, warn() {}, error() {} } });
  const key = (value) => { if (!value.startsWith(c.prefix) || value.includes('..')) throw new Error('R2_PREFIX_REJECTED'); return value; };
  return {
    async put(name, file) {
      const metadata = await digest(file);
      await client.send(new PutObjectCommand({ Bucket: c.bucket, Key: key(name), Body: createReadStream(file), ContentLength: metadata.bytes, IfNoneMatch: '*' }));
      return metadata;
    },
    async get(name, file, { maxBytes = 1024 * 1024 } = {}) {
      // Reserve once: a retry may truncate only this operation's own partial
      // destination, never a caller's pre-existing file. Writes stay create-only.
      const reserved = await open(file, 'wx', 0o600); await reserved.close();
      try {
        return await retryRead(async () => {
          const response = await client.send(new GetObjectCommand({ Bucket: c.bucket, Key: key(name) }));
          if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || (Number.isFinite(response.ContentLength) && response.ContentLength > maxBytes)) {
            response.Body?.destroy(); throw new Error('BACKUP_HASH_MISMATCH');
          }
          // SDK stream writes are bounded by disk, not a whole-backup memory buffer.
          const { pipeline } = await import('node:stream/promises');
          const { createWriteStream } = await import('node:fs');
          let bytes = 0;
          const limit = new Transform({ transform(chunk, _encoding, callback) {
            bytes += chunk.length;
            callback(bytes > maxBytes ? new Error('BACKUP_HASH_MISMATCH') : null, chunk);
          } });
          await pipeline(response.Body, limit, createWriteStream(file, { mode: 0o600, flags: 'w' }));
          return digest(file);
        }, 'r2-read');
      }
      catch (error) { await rm(file, { force: true }); throw error; }
    },
    async list(prefix) {
      const all = []; let token; const seen = new Set();
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: c.bucket, Prefix: key(prefix), ContinuationToken: token }));
        all.push(...(page.Contents || []));
        if (page.IsTruncated && (!page.NextContinuationToken || seen.has(page.NextContinuationToken))) throw new Error('R2_PAGINATION_INVALID');
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
        seen.add(token);
      } while (token);
      return all;
    },
    close() { client.destroy(); },
  };
}
export async function verifyPrivateTarget(c) {
  if (c.synthetic) return;
  const base = `https://api.cloudflare.com/client/v4/accounts/${c.account}/r2/buckets/${encodeURIComponent(c.bucket)}`;
  const get = async (suffix) => {
    const response = await fetch(base + suffix, { headers: { Authorization: `Bearer ${c.cloudflareToken}`, Accept: 'application/json', 'User-Agent': 'colliers-backup/1.0' }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('R2_PRIVACY_CHECK_FAILED');
    const body = await response.json(); if (body.success !== true) throw new Error('R2_PRIVACY_CHECK_FAILED'); return body.result;
  };
  const managed = await get('/domains/managed'); const custom = await get('/domains/custom');
  if (managed.enabled !== false || !Array.isArray(custom.domains) || custom.domains.some((x) => x.enabled !== false)) throw new Error('R2_PUBLIC_OR_UNKNOWN');
  const lock = await get('/lock');
  if (!Array.isArray(lock.rules) || !lock.rules.some((r) => r.enabled === true && c.prefix.startsWith(r.prefix || '') && r.condition?.type === 'Age' && r.condition.maxAgeSeconds >= 30 * 86400)) throw new Error('R2_RETENTION_LOCK_REQUIRED');
}
export async function writeCompletion(storeClient, key, data, file) {
  await writeFile(file, JSON.stringify(data), { mode: 0o600 });
  return storeClient.put(key, file);
}
