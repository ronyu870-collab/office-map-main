import type PptxGenJS from 'pptxgenjs';
import type { SceneMedia } from '../render/media';

type PictureRelationship = { type: string; Target: string; data: string };
const pictureTarget = /^\.\.\/media\/image-\d+-\d+\.(png|jpeg|webp)$/;

function isPictureRelationship(entry: unknown): entry is PictureRelationship {
  if (!entry || typeof entry !== 'object') return false;
  const { type, Target, data } = entry as Partial<PictureRelationship>;
  return typeof Target === 'string' && pictureTarget.test(Target) && typeof data === 'string'
    && (type === 'image/png' || type === 'image/jpeg' || type === 'image/webp') && data.startsWith(`data:${type};base64,`);
}

/** A download-local image cache for authorized, already resolved media. */
export function createPitchPicturePackage() {
  const encoded = new WeakMap<SceneMedia, string>();
  const partByData = new Map<string, string>();

  return {
    imageData(image: SceneMedia) {
      const cached = encoded.get(image);
      if (cached) return cached;
      const { buffer, byteOffset, byteLength } = image.bytes;
      const data = `data:${image.mime};base64,` + Buffer.from(buffer, byteOffset, byteLength).toString('base64');
      encoded.set(image, data);
      return data;
    },
    reuseParts(slide: PptxGenJS.Slide) {
      // PptxGenJS 4.0.1 writes the relationship targets as OPC part names.
      // Keep each picture's rId and transform, and reuse the binary part before ZIP compression.
      const relationships = (slide as unknown as { _relsMedia?: unknown })._relsMedia;
      if (!Array.isArray(relationships)) return;
      for (const relationship of relationships as unknown[]) {
        if (!isPictureRelationship(relationship)) continue;
        const existing = partByData.get(relationship.data);
        if (existing) relationship.Target = existing;
        else partByData.set(relationship.data, relationship.Target);
      }
    },
  };
}
