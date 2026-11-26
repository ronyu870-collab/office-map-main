import sharp from 'sharp';
import { bytesDigest } from '@/src/lib/intelligence/knowledge/parser';
import { DocumentError } from '@/src/lib/intelligence/knowledge/safeArchive';
import type { ExtractedMedia } from './protocol';
export async function extractMedia(key: string, bytes: Uint8Array): Promise<ExtractedMedia> {
  if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new DocumentError('PITCH_IMAGE_LIMIT', '图片超过 12 MiB。');
  const info = await sharp(bytes, { limitInputPixels: 32_000_000, failOn: 'error' }).metadata();
  if (!info.width || !info.height || !['png', 'jpeg', 'webp'].includes(info.format ?? '') || (info.pages ?? 1) > 1 || info.orientation && info.orientation !== 1) throw new DocumentError('PITCH_IMAGE_UNSUPPORTED', '图片格式、动画或方向信息需人工转换。');
  return { key, mime: `image/${info.format}`, bytes, width: info.width, height: info.height, sha256: bytesDigest(bytes) };
}
export async function mediaThumbnail(media: ExtractedMedia) { return new Uint8Array(await sharp(media.bytes, { limitInputPixels: 32_000_000 }).resize(480, 270, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()); }
