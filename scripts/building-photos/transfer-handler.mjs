// A bounded, temporary importer for a pre-reviewed photo batch.
// The deployment injects only approved object paths, file hashes and an expiring
// token hash. Project credentials remain inside the provider's runtime.
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}

function equalHash(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function matchesMime(bytes, type) {
  if (type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
  return new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
}

async function boundedBody(request, expectedSize) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('empty_body');
  const chunks = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > expectedSize || length > MAX_FILE_BYTES) {
      await reader.cancel();
      throw new Error('body_too_large');
    }
    chunks.push(part.value);
  }
  if (length !== expectedSize) throw new Error('incorrect_size');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function createTransferHandler({ manifest, tokenSha256, expiresAt, storage, now = Date.now }) {
  if (!/^[0-9a-f]{64}$/.test(tokenSha256) || !Number.isFinite(expiresAt)) throw new Error('invalid_batch_auth');
  const approved = new Map();
  for (const photo of manifest) {
    const prefix = `building-photos/v1/${photo.building_id}/${photo.id}/`;
    if (!UUID.test(photo.id) || !UUID.test(photo.building_id) || approved.has(photo.id)
        || !photo.path.startsWith(prefix) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}\.(?:jpe?g|png|webp)$/.test(photo.path.slice(prefix.length))
        || !/^[0-9a-f]{64}$/.test(photo.sha256) || !MIME_TYPES.has(photo.mime_type)
        || !Number.isSafeInteger(photo.file_size) || photo.file_size < 1 || photo.file_size > MAX_FILE_BYTES) {
      throw new Error('invalid_approved_photo');
    }
    approved.set(photo.id, Object.freeze({ ...photo }));
  }
  const reply = (status, data) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  return async request => {
    if (now() >= expiresAt) return reply(410, { error: 'batch_closed' });
    if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
    const token = request.headers.get('x-batch-token') ?? '';
    if (token.length < 32 || token.length > 128 || !equalHash(await sha256(token), tokenSha256)) return reply(401, { error: 'unauthorized' });
    const photo = approved.get(request.headers.get('x-photo-id') ?? '');
    if (!photo) return reply(404, { error: 'photo_not_approved' });
    const type = request.headers.get('content-type')?.split(';')[0].trim();
    if (type !== photo.mime_type) return reply(415, { error: 'incorrect_mime' });
    const declaredLength = request.headers.get('content-length');
    if (declaredLength !== null && Number(declaredLength) !== photo.file_size) return reply(400, { error: 'incorrect_size' });
    let bytes;
    try { bytes = await boundedBody(request, photo.file_size); }
    catch { return reply(400, { error: 'incorrect_body' }); }
    if (!matchesMime(bytes, type) || !equalHash(await sha256(bytes), photo.sha256)) return reply(422, { error: 'content_mismatch' });
    try {
      // Never upsert: a retry must prove that the existing object's bytes match.
      const uploaded = await storage.upload(photo.path, bytes, { contentType: photo.mime_type, upsert: false, cacheControl: '31536000' });
      const downloaded = await storage.download(photo.path);
      if (downloaded.error || !downloaded.data) return reply(502, { error: 'readback_failed' });
      const readback = new Uint8Array(await downloaded.data.arrayBuffer());
      if (readback.byteLength !== photo.file_size || !equalHash(await sha256(readback), photo.sha256)) return reply(409, { error: 'readback_mismatch' });
      const signed = await storage.createSignedUrl(photo.path, 600);
      if (signed.error || !signed.data?.signedUrl) return reply(502, { error: 'signed_read_failed' });
      return reply(uploaded.error ? 200 : 201, {
        id: photo.id, storage_path: photo.path, sha256: photo.sha256,
        file_size: photo.file_size, verified: true, already_present: Boolean(uploaded.error),
        signed_url: signed.data.signedUrl,
      });
    } catch { return reply(502, { error: 'storage_transfer_failed' }); }
  };
}
