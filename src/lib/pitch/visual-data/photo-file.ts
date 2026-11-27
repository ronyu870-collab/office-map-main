import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUILDING_PHOTO_BUCKET, isBuildingPhotoPath } from '@/src/lib/building-photos/model';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const SHA256 = /^[a-f0-9]{64}$/;
const formats: Record<string, 'image/jpeg' | 'image/png' | 'image/webp'> = {
  jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

export const contentHash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

export type PhotoFileRecord = {
  id: string;
  building_id: string;
  storage_path: string | null;
  sha256: string | null;
  file_size: number | null;
  width: number | null;
  height: number | null;
};

/** Uses the private catalogue object, with a bounded stream and no third-party URL inputs. */
export async function readPhotoFile(client: SupabaseClient, record: PhotoFileRecord, signal: AbortSignal) {
  const { storage_path: path, file_size: size, sha256 } = record;
  if (!isBuildingPhotoPath(path, record.building_id, record.id) || size == null
      || !Number.isSafeInteger(size) || size < 1 || size > MAX_IMAGE_BYTES || !sha256 || !SHA256.test(sha256)) {
    throw new Error('PITCH_PHOTO_FILE_INVALID');
  }
  const { data, error } = await client.storage.from(BUILDING_PHOTO_BUCKET)
    .download(path, {}, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) }).asStream();
  if (error || !data) throw new Error('PITCH_PHOTO_FILE_UNAVAILABLE');
  const reader = data.getReader();
  const bytes = new Uint8Array(size);
  let cursor = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      if (cursor + chunk.value.byteLength > size) throw new Error('PITCH_PHOTO_FILE_INVALID');
      bytes.set(chunk.value, cursor);
      cursor += chunk.value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (cursor !== size) throw new Error('PITCH_PHOTO_FILE_INVALID');
  return inspectPhotoBytes(record, bytes);
}

export async function inspectPhotoBytes(record: PhotoFileRecord, bytes: Uint8Array) {
  const sha256 = contentHash(bytes);
  if (bytes.byteLength !== record.file_size || bytes.byteLength > MAX_IMAGE_BYTES || sha256 !== record.sha256) {
    throw new Error('PITCH_PHOTO_SOURCE_CHANGED');
  }
  const sharp = (await import('sharp')).default;
  const image = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' });
  const metadata = await image.metadata();
  const mime = metadata.format && formats[metadata.format];
  if (!mime || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1
      || metadata.width !== record.width || metadata.height !== record.height
      || !record.storage_path?.match(mime === 'image/jpeg' ? /\.jpe?g$/i : new RegExp(`\\.${mime.slice(6)}$`, 'i'))) {
    throw new Error('PITCH_PHOTO_FILE_INVALID');
  }
  // Decoding pixels catches truncated bodies that still have a well-formed header.
  const { data, info } = await image.clone().autoOrient().resize(256, 256, { fit: 'inside', withoutEnlargement: true })
    .greyscale().raw().toBuffer({ resolveWithObject: true });
  const sample = await sharp(data, { raw: info }).stats();
  const { width, height } = metadata.autoOrient;
  return { bytes, mime, width, height, sha256, sharpness: sample.sharpness, needsOrientation: (metadata.orientation ?? 1) !== 1 };
}

export type VerifiedPhotoFile = Awaited<ReturnType<typeof inspectPhotoBytes>>;

/** Normalizes EXIF rotation and WebP for Office. Straight JPEGs and PNGs are reused byte-for-byte. */
export async function photoSceneBytes(file: VerifiedPhotoFile) {
  if (!file.needsOrientation && file.mime !== 'image/webp') return file;
  const sharp = (await import('sharp')).default;
  const image = sharp(file.bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' }).autoOrient();
  const metadata = await image.metadata();
  const mime = metadata.hasAlpha ? 'image/png' : 'image/jpeg';
  const bytes = await (metadata.hasAlpha ? image.png() : image.jpeg({ quality: 94 })).toBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('PITCH_PHOTO_FILE_INVALID');
  return { bytes, mime, width: file.width, height: file.height, sha256: contentHash(bytes) };
}
