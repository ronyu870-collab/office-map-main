import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import OSS from 'ali-oss';
import { supabaseSource, ossSource } from '../sources.mjs';

export async function sourceRegressions(test, dir) {
  await test('installed Supabase SDK recursively paginates and streams fixed-origin objects', async () => {
    const original = globalThis.fetch; const requests = []; let failPage = false;
    try {
      globalThis.fetch = async (url, options) => {
        requests.push({ url: String(url), method: options?.method || 'GET' });
        if (String(url).endsWith('/bucket')) return Response.json([{ id: 'synthetic', public: false }]);
        if (String(url).includes('/object/list/')) {
          const body = JSON.parse(options.body);
          if (body.prefix === 'folder') return Response.json([{ id: 'nested-id', name: '中文 空格.txt', updated_at: 'synthetic', metadata: { size: 14 } }]);
          if (body.offset === 100) return failPage ? Response.json({ message: 'synthetic failure' }, { status: 403 }) : Response.json([{ id: 'last', name: 'z-last', updated_at: 'synthetic', metadata: {} }]);
          return Response.json([{ id: null, name: 'folder' }, ...Array.from({ length: 99 }, (_, i) => ({ id: `id-${i}`, name: `object-${i}`, updated_at: 'synthetic', metadata: {} }))]);
        }
        assert.ok(String(url).startsWith('https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/authenticated/'));
        assert.equal(options.redirect, 'error');
        return new Response('synthetic-file');
      };
      const source = supabaseSource({ url: 'https://abcdefghijklmnopqrst.supabase.co', key: 'synthetic-only' });
      const inventory = await source.inventory();
      assert.equal(inventory.filter((o) => o.kind === 'object').length, 101);
      const object = inventory.find((o) => o.name === 'folder/中文 空格.txt');
      const file = path.join(dir, 'supabase-object'); await source.download(object, file);
      assert.equal(await readFile(file, 'utf8'), 'synthetic-file');
      assert.ok(requests.every((r) => ['GET', 'POST'].includes(r.method)));
      failPage = true; await assert.rejects(source.inventory(), /STORAGE_LIST_FAILED/);
    } finally { globalThis.fetch = original; }
  });
  await test('installed OSS SDK signs/paginates lists and performs conditional streaming reads', async () => {
    const requests = []; let badPagination = false;
    const source = ossSource({ accessKeyId: 'synthetic', accessKeySecret: 'synthetic', bucket: 'synthetic-files', region: 'oss-cn-hongkong' }, {
      makeClient: (options) => new OSS({ ...options, urllib: { request: async (url, request) => {
        requests.push({ url, request }); const parsed = new URL(url);
        assert.equal(request.method, 'GET'); assert.ok(request.headers.authorization.startsWith('OSS '));
        if (parsed.searchParams.has('list-type')) {
          const second = parsed.searchParams.has('continuation-token');
          const name = second && !badPagination ? 'second.txt' : '中文 空格.txt';
          const xml = `<ListBucketResult><KeyCount>1</KeyCount><IsTruncated>${!second || badPagination}</IsTruncated><NextContinuationToken>next</NextContinuationToken><Contents><Key>${name}</Key><Size>14</Size><ETag>"synthetic"</ETag><LastModified>synthetic</LastModified><Type>Normal</Type><StorageClass>Standard</StorageClass></Contents></ListBucketResult>`;
          return { status: 200, headers: {}, data: Buffer.from(xml), res: {} };
        }
        assert.equal(request.headers['If-Match'], '"synthetic"');
        return { status: 200, headers: {}, res: Readable.from(['synthetic-file']) };
      } } }),
    });
    const inventory = await source.inventory(); assert.equal(inventory.length, 2);
    const file = path.join(dir, 'oss-object'); await source.download(inventory[0], file);
    assert.equal(await readFile(file, 'utf8'), 'synthetic-file');
    assert.ok(requests.some((r) => r.url.includes('continuation-token=next')));
    badPagination = true; await assert.rejects(source.inventory(), /OSS_INVENTORY_INVALID|OSS_PAGINATION_INVALID/);
  });
}
