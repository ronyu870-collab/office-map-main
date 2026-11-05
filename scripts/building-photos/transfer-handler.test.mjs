import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransferHandler, sha256 } from './transfer-handler.mjs';

const token = 'synthetic-photo-batch-token-for-isolated-tests-only';
const id = '11111111-1111-4111-8111-111111111111';
const buildingId = '22222222-2222-4222-8222-222222222222';
const bytes = new Uint8Array([255, 216, 255, 219, 0, 0, 0, 0]);
const photo = { id, building_id: buildingId, path: `building-photos/v1/${buildingId}/${id}/original.jpg`, mime_type: 'image/jpeg', sha256: await sha256(bytes), file_size: bytes.length };
const tokenSha256 = await sha256(token);

function setup(options = {}) {
  const state = { uploads: 0, downloads: 0, args: null, stored: options.existing ?? null };
  const storage = {
    async upload(path, data, settings) {
      state.uploads++; state.args = { path, settings };
      if (state.stored) return { error: new Error('already exists') };
      state.stored = new Uint8Array(data); return { error: null };
    },
    async download() { state.downloads++; return { data: new Blob([state.stored]), error: null }; },
    async createSignedUrl(path) { return { data: { signedUrl: `https://storage.example.test/${path}?synthetic` }, error: null }; },
  };
  return { state, handler: createTransferHandler({ manifest: [photo], tokenSha256, expiresAt: 2000, now: () => options.time ?? 1000, storage }) };
}
function request(changes = {}) {
  const headers = { 'x-batch-token': token, 'x-photo-id': id, 'content-type': photo.mime_type, ...changes.headers };
  return new Request('https://import.example.test/', { method: changes.method ?? 'POST', headers, body: changes.method === 'GET' ? undefined : (changes.body ?? bytes) });
}

test('approved photo uploads without replacement and is hash verified after download', async () => {
  const { handler, state } = setup(); const response = await handler(request());
  assert.equal(response.status, 201); assert.equal((await response.json()).verified, true);
  assert.equal(state.uploads, 1); assert.equal(state.downloads, 1); assert.equal(state.args.path, photo.path); assert.equal(state.args.settings.upsert, false);
});
test('same-file retry succeeds only after comparing stored bytes', async () => {
  const { handler, state } = setup({ existing: bytes }); const response = await handler(request());
  assert.equal(response.status, 200); assert.equal((await response.json()).already_present, true); assert.equal(state.downloads, 1);
});
test('existing different bytes never receive a success result or overwrite', async () => {
  const wrong = new Uint8Array(bytes); wrong[7] = 1;
  const { handler, state } = setup({ existing: wrong }); const response = await handler(request());
  assert.equal(response.status, 409); assert.deepEqual(state.stored, wrong);
});
test('missing and incorrect tokens cannot reach storage', async () => {
  for (const key of ['', 'x'.repeat(64)]) {
    const { handler, state } = setup(); assert.equal((await handler(request({ headers: { 'x-batch-token': key } }))).status, 401); assert.equal(state.uploads, 0);
  }
});
test('expired batch is closed even for its valid token', async () => {
  const { handler, state } = setup({ time: 2000 }); assert.equal((await handler(request())).status, 410); assert.equal(state.uploads, 0);
});
test('arbitrary ids and paths cannot reach storage', async () => {
  const { handler, state } = setup(); assert.equal((await handler(request({ headers: { 'x-photo-id': '../outside/secret' } }))).status, 404); assert.equal(state.uploads, 0);
});
test('incorrect content, type, length and oversized streaming body are rejected', async () => {
  for (const [changes, status] of [
    [{ body: new Uint8Array(8) }, 422],
    [{ headers: { 'content-type': 'text/html' } }, 415],
    [{ headers: { 'content-length': '9' } }, 400],
    [{ body: new Uint8Array(9) }, 400],
    [{ body: new Uint8Array(3) }, 400],
  ]) {
    const { handler, state } = setup(); assert.equal((await handler(request(changes))).status, status); assert.equal(state.uploads, 0);
  }
});
test('read methods cannot upload', async () => {
  const { handler, state } = setup(); assert.equal((await handler(request({ method: 'GET' }))).status, 405); assert.equal(state.uploads, 0);
});
test('invalid approved manifests fail closed before receiving requests', () => {
  for (const change of [{ path: '../other' }, { path: `building-photos/v1/${buildingId}/${id}/../other` }, { path: `building-photos/v1/${buildingId}/${id}/..` }, { mime_type: 'image/svg+xml' }, { file_size: 30 * 1024 * 1024 }]) {
    assert.throws(() => createTransferHandler({ manifest: [{ ...photo, ...change }], tokenSha256, expiresAt: 2000, storage: {} }), /invalid_approved_photo/);
  }
});
