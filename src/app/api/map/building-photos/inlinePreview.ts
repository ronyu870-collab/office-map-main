import { BUILDING_PHOTO_BUCKET } from '@/src/lib/building-photos/model';

export const PHOTO_PREVIEW_TRANSFORM = { width: 1120, height: 1120, resize: 'contain', quality: 74 } as const;
const MAX_PREVIEW_BYTES = 512 * 1024;
const MAX_METADATA_HEADER_BYTES = 6 * 1024;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 128;
const CACHE_TTL_MS = 5 * 60 * 1000;
const previews = new Map<string, { bytes: Uint8Array<ArrayBuffer>; expires: number }>();
let cachedBytes = 0;

function evict(key: string) {
  const entry = previews.get(key);
  if (!entry) return;
  cachedBytes -= entry.bytes.byteLength;
  previews.delete(key);
}

function cachePreview(key: string, bytes: Uint8Array<ArrayBuffer>) {
  evict(key);
  while (cachedBytes + bytes.byteLength > MAX_CACHE_BYTES || previews.size >= MAX_CACHE_ENTRIES) {
    const oldest = previews.keys().next().value;
    if (oldest === undefined) break;
    evict(oldest);
  }
  previews.set(key, { bytes, expires: Date.now() + CACHE_TTL_MS });
  cachedBytes += bytes.byteLength;
}

export async function loadInlineBuildingPhoto(
  supabaseUrl: string, secret: string, verifiedPath: string, sha256: unknown, metadata: object, requestSignal: AbortSignal,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; metadataHeader: string } | null> {
  const metadataHeader = Buffer.from(JSON.stringify(metadata)).toString('base64url');
  if (metadataHeader.length > MAX_METADATA_HEADER_BYTES) return null;
  try {
    const asset = new URL(`/storage/v1/render/image/authenticated/${BUILDING_PHOTO_BUCKET}/${verifiedPath}`, supabaseUrl);
    asset.search = new URLSearchParams(Object.entries(PHOTO_PREVIEW_TRANSFORM).map(([key, value]) => [key, String(value)])).toString();
    // A hit contains only image bytes. Callers must still authenticate, scope, and audit every access.
    const cacheKey = typeof sha256 === 'string' && /^[a-f0-9]{64}$/.test(sha256) ? asset.href + '#' + sha256 : null;
    if (cacheKey) {
      const cached = previews.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        previews.delete(cacheKey);
        previews.set(cacheKey, cached);
        return { bytes: cached.bytes, metadataHeader };
      }
      evict(cacheKey);
    }
    const response = await fetch(asset, {
      headers: { apikey: secret, Authorization: `Bearer ${secret}`, Accept: 'image/webp' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.any([requestSignal, AbortSignal.timeout(1500)]),
    });
    const reader = response.body?.getReader();
    if (!reader) return null;
    try {
      if (!response.ok || response.headers.get('content-type')?.split(';', 1)[0] !== 'image/webp'
        || Number(response.headers.get('content-length')) > MAX_PREVIEW_BYTES) return null;
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_PREVIEW_BYTES) return null;
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (size < 12 || Buffer.from(bytes.subarray(0, 4)).toString('ascii') !== 'RIFF'
        || Buffer.from(bytes.subarray(8, 12)).toString('ascii') !== 'WEBP') return null;
      if (cacheKey) cachePreview(cacheKey, bytes);
      return { bytes, metadataHeader };
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  } catch {
    return null;
  }
}
