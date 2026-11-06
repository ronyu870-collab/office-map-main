import { createClient } from '@supabase/supabase-js';
import OSS from 'ali-oss';
import { createWriteStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { profileDefinition } from './profiles.mjs';
import { retryRead } from './reads.mjs';

const nameOK = (s) => typeof s === 'string' && s.length > 0 && !s.split('/').some((p) => p === '..' || p === '.') && !s.includes('\\') && !s.includes('\0');
export function checkName(s) { if (!nameOK(s)) throw new Error('SOURCE_NAME_REJECTED'); return s; }
export function sameInventory(a, b) {
  const sorted = (x) => JSON.stringify([...x].sort((p, q) => JSON.stringify(p).localeCompare(JSON.stringify(q))));
  if (sorted(a) !== sorted(b)) throw new Error('SOURCE_CHANGED_DURING_BACKUP');
}
// Uses the installed SDK for listing, then streams fixed-origin downloads. No
// source delete/update APIs are exposed to the orchestrator.
export function supabaseSource(c) {
  if (!c.key) throw new Error('MISSING_STORAGE_CREDENTIALS');
  const guardedFetch = (url, options) => {
    if (new URL(url).origin !== new URL(c.url).origin) throw new Error('SOURCE_ENDPOINT_REJECTED');
    return fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(120_000) });
  };
  const client = createClient(c.url, c.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: guardedFetch } });
  const listed = async (action, code) => {
    try {
      return await retryRead(async () => {
        const result = await action();
        if (result.error) throw result.error;
        if (!Array.isArray(result.data)) throw new Error(code);
        return result.data;
      });
    } catch (cause) { throw new Error(code, { cause }); }
  };
  return {
    kind: 'supabase-storage',
    descriptor: { projectUrl: c.url },
    async inventory() {
      const buckets = await listed(() => client.storage.listBuckets(), 'STORAGE_BUCKET_LIST_FAILED');
      const all = [];
      for (const bucket of buckets) {
        checkName(bucket.id);
        // Empty buckets and configuration must be represented too.
        all.push({ bucket: bucket.id, kind: 'bucket', config: bucket });
        const visited = new Set(); const seenObjects = new Set();
        const walk = async (prefix) => {
          if (visited.has(prefix)) throw new Error('STORAGE_FOLDER_CYCLE');
          visited.add(prefix);
          for (let offset = 0; ; offset += 100) {
            const page = await listed(() => client.storage.from(bucket.id).list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }), 'STORAGE_LIST_FAILED');
            for (const o of page) {
              const name = checkName(prefix ? `${prefix}/${o.name}` : o.name);
              if (o.id === null) await walk(name);
              else {
                if (seenObjects.has(name) || typeof o.id !== 'string') throw new Error('STORAGE_PAGINATION_INVALID');
                seenObjects.add(name);
                all.push({ bucket: bucket.id, name, id: o.id, updated: o.updated_at, metadata: o.metadata, kind: 'object' });
              }
            }
            if (page.length < 100) break;
          }
        };
        await walk('');
      }
      return all;
    },
    async download(o, file) {
      const route = [o.bucket, ...o.name.split('/')].map(encodeURIComponent).join('/');
      // Reserve the private destination exclusively before fetching. Only this
      // operation's own partial file may be truncated on a bounded retry.
      const reservation = await open(file, 'wx', 0o600); await reservation.close();
      try {
        await retryRead(async () => {
          const response = await guardedFetch(`${c.url}/storage/v1/object/authenticated/${route}`, { headers: { apikey: c.key, Authorization: `Bearer ${c.key}` } });
          if (!response.ok || !response.body) {
            await response.body?.cancel().catch(() => {});
            throw Object.assign(new Error('STORAGE_DOWNLOAD_FAILED'), { status: response.status });
          }
          await pipeline(response.body, createWriteStream(file, { flags: 'w', mode: 0o600 }));
        });
      } catch (error) { await rm(file, { force: true }); throw error; }
    },
  };
}
export function ossSource(c, { makeClient = (options) => new OSS(options) } = {}) {
  if (![c.accessKeyId, c.accessKeySecret, c.region, c.bucket].every(Boolean)) throw new Error('MISSING_OSS_CREDENTIALS');
  if (!/^oss-[a-z0-9-]+$/.test(c.region) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(c.bucket)) throw new Error('OSS_TARGET_INVALID');
  const client = makeClient({ ...c, secure: true, timeout: 120_000 });
  return {
    kind: 'ali-oss',
    descriptor: { bucket: c.bucket, region: c.region },
    async inventory() {
      const all = []; let token; const tokens = new Set(); const names = new Set();
      do {
        const page = await client.listV2({ 'max-keys': 1000, ...(token ? { 'continuation-token': token } : {}) });
        for (const o of page.objects || []) {
          if (names.has(o.name) || !o.etag || !Number.isSafeInteger(o.size) || o.size < 0) throw new Error('OSS_INVENTORY_INVALID');
          names.add(o.name);
          all.push({ kind: 'object', bucket: c.bucket, name: checkName(o.name), etag: o.etag, size: o.size, updated: o.lastModified });
        }
        if (page.isTruncated && (!page.nextContinuationToken || tokens.has(page.nextContinuationToken))) throw new Error('OSS_PAGINATION_INVALID');
        token = page.isTruncated ? page.nextContinuationToken : undefined;
        tokens.add(token);
      } while (token);
      return all;
    },
    async download(o, file) {
      const response = await client.getStream(o.name, { headers: { 'If-Match': o.etag } });
      await pipeline(response.stream, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
    },
  };
}
export function configuredSources(c) {
  return profileDefinition(c.profile).sources.map((kind) => kind === 'supabase-storage' ? supabaseSource(c.sources.supabase) : ossSource(c.sources.oss));
}
