import type { SlideContent } from '../contracts/content';
import type { VisualAssetReference } from '../integration-contracts';
import type { SceneMedia } from '../render/media';
import { LayoutError } from './metrics';

type Image = Extract<SlideContent['blocks'][number], { kind: 'image' }>;
type ResolvedVisual = {
  reference: VisualAssetReference & {
    caption?: string;
    dimensions: { width: number; height: number };
    rights: {
      attribution: string;
      licenseName: string | null;
      sourceUrl: string | null;
      licenseUrl: string | null;
      cropAllowed: boolean;
    };
  };
  media: SceneMedia;
};

/** Adapts the already-authorized resolver result. The caller still owns
 * disclosure, media replay, persistence and provenance checks. */
export function imageFromResolvedVisual(asset: ResolvedVisual, placement?: { fit: 'contain' | 'cover'; focalX: number; focalY: number } | null) {
  const { reference, media } = asset;
  if (reference.id !== media.id || reference.version !== media.version) {
    throw new LayoutError('PITCH_SOURCE_CHANGED', '渲染素材版本与已确认的视觉引用不一致。');
  }
  const { width, height } = reference.dimensions;
  const rights = reference.rights;
  const caption = reference.caption || reference.source.label;
  const license = rights.licenseName && !rights.attribution.includes(rights.licenseName) ? rights.licenseName : null;
  const attribution = [rights.attribution, license].filter(Boolean).join(' · ');
  const credit = [
    attribution === caption ? null : attribution,
    rights.sourceUrl,
    rights.licenseUrl,
  ].filter(Boolean).join('\n');
  const fit = reference.kind !== 'photo' || !rights.cropAllowed ? 'contain' : placement?.fit ?? 'cover';
  const block: Image = {
    kind: 'image', mediaAssetId: media.id, mediaVersion: media.version,
    alt: caption, caption, ...(credit ? { credit } : {}), fit, aspectRatio: (media.width ?? width) / (media.height ?? height),
    ...(fit === 'cover' && placement ? { focus: { x: placement.focalX, y: placement.focalY } } : {}),
    sourceIds: [reference.source.id],
  };
  return { block, source: reference.source, disclosure: reference.disclosure };
}
