import { slideContentSchema, type SlideContent } from '../contracts/content';
import type { LayoutId } from '../contracts/scene';
import { layoutSlides } from '../layout/engine';
import { LayoutError } from '../layout/metrics';

type Photo = Extract<SlideContent['blocks'][number], { kind: 'image' }>;
type Caption = Extract<SlideContent['blocks'][number], { kind: 'paragraph' }>;

const photoLayouts: readonly LayoutId[] = ['hero-caption', 'photo-pair', 'photo-triptych', 'photo-gallery'];

function sameSources(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function pairCaption(photos: readonly Photo[]): Caption {
  return { kind: 'paragraph', text: photos.map(photo => photo.alt).join(' · '),
    sourceIds: [...new Set(photos.flatMap(photo => photo.sourceIds))] };
}

function splitPhotoPage(content: SlideContent, layoutId: LayoutId) {
  const photos = content.blocks.filter(block => block.kind === 'image');
  if (photos.length < 2 || photoLayouts[photos.length - 1] !== layoutId) return null;
  const sources = new Map(content.sources.map(source => [source.id, source]));
  if (!photos.every(photo => photo.sourceIds.some(id => {
    const receipt = sources.get(id)?.visual;
    return receipt?.kind === 'photo' && receipt.id === photo.mediaAssetId && receipt.version === photo.mediaVersion;
  }))) return null;
  const photoSourceIds = new Set(photos.flatMap(photo => photo.sourceIds));
  if (content.sources.some(source => !photoSourceIds.has(source.id))) return null;

  // Only paginate the gallery's generated captions. Editorial prose may not
  // be split or discarded when an unrelated text box exceeds its capacity.
  const expected = photos.length === 2 ? [pairCaption(photos)] : photos.map(photo => pairCaption([photo]));
  const captions = content.blocks.filter(block => block.kind === 'paragraph');
  if (content.blocks.length !== photos.length + expected.length || captions.length !== expected.length
    || !captions.every((caption, index) => caption.text === expected[index].text
      && sameSources(caption.sourceIds, expected[index].sourceIds))) return null;

  const split = Math.ceil(photos.length / 2);
  return [photos.slice(0, split), photos.slice(split)].map(group => {
    const caption = pairCaption(group), used = new Set(caption.sourceIds);
    return { layoutId: photoLayouts[group.length - 1], content: slideContentSchema.parse({
      ...content, blocks: [...group, caption], sources: content.sources.filter(source => used.has(source.id)),
    }) };
  });
}

type PhotoPage = { content: SlideContent; scenes: Awaited<ReturnType<typeof layoutSlides>> };

/** Let the existing renderer measure the complete source line before splitting artwork. */
export async function layoutAuthorizedPhotoPage(
  content: SlideContent,
  theme: Parameters<typeof layoutSlides>[1],
  layoutId: LayoutId,
  variant?: Parameters<typeof layoutSlides>[3],
): Promise<PhotoPage[]> {
  try {
    return [{ content, scenes: await layoutSlides(content, theme, layoutId, variant) }];
  } catch (error) {
    if (!(error instanceof LayoutError) || error.code !== 'PITCH_TEXT_CAPACITY') throw error;
    const split = splitPhotoPage(content, layoutId);
    if (!split) throw error;
    const pages: PhotoPage[] = [];
    for (const page of split) pages.push(...await layoutAuthorizedPhotoPage(page.content, theme, page.layoutId, variant));
    return pages;
  }
}
