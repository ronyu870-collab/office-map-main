import { describe, expect, it } from 'vitest';
import { PROTOCOL, slideContentSchema } from '../../contracts/content';
import { STUDIO_THEME } from '../../design/theme';
import { layoutSlides } from '../../layout/engine';
import { layoutAuthorizedPhotoPage } from '../photo-pages';

const uuid = (i: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`;

function gallery(labelLength: number) {
  const photos = Array.from({ length: 4 }, (_, i) => ({
    id: uuid(i + 1), kind: 'photo' as const, buildingIds: [uuid(i + 11)], version: 1,
    versionHash: 'a'.repeat(64), contentHash: 'b'.repeat(64), origin: {
      type: 'building-photo' as const, buildingId: uuid(i + 11), photoId: uuid(i + 21),
    },
  }));
  const dataAsOf = '2026-11-18';
  return slideContentSchema.parse({
    protocol: PROTOCOL, locale: 'zh', title: '候选楼宇建筑实景', subtitle: '已取得实景照片 4/4',
    dataAsOf, disclosure: 'internal', isTestData: false,
    blocks: [
      ...photos.map(photo => ({ kind: 'image', alt: `楼宇${photo.id.at(-1)}`, mediaAssetId: photo.id, mediaVersion: 1, sourceIds: [photo.id] })),
      ...photos.map(photo => ({ kind: 'paragraph', text: `楼宇${photo.id.at(-1)}`, sourceIds: [photo.id] })),
    ],
    sources: photos.map((photo, i) => ({
      id: photo.id, kind: 'record', label: `照片${i + 1} ${'完整摄影授权署名'.repeat(labelLength)}`,
      locator: `目录${i + 1}`, version: photo.versionHash, sha256: photo.contentHash, dataAsOf, visual: photo,
    })),
  });
}

describe('source-aware building photo pages', () => {
  it('keeps a gallery that fits the selected theme', async () => {
    const content = gallery(1);
    const result = await layoutAuthorizedPhotoPage(content, STUDIO_THEME, 'photo-gallery');
    expect(result.map(page => page.content)).toEqual([content]);
    expect(result[0].scenes[0].layoutId).toBe('photo-gallery');
  });

  it('renders long credits at their full length on the same page as their images', async () => {
    const content = gallery(7);
    await expect(layoutSlides(content, STUDIO_THEME, 'photo-gallery')).rejects.toMatchObject({ code: 'PITCH_TEXT_CAPACITY' });
    const pages = await layoutAuthorizedPhotoPage(content, STUDIO_THEME, 'photo-gallery');
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap(page => page.content.sources)).toEqual(content.sources);
    expect(pages.flatMap(page => page.content.blocks.filter(block => block.kind === 'image')))
      .toEqual(content.blocks.filter(block => block.kind === 'image'));
    for (const { content: page, scenes: [scene] } of pages) {
      expect(page).toMatchObject({ dataAsOf: content.dataAsOf, disclosure: content.disclosure, isTestData: false });
      expect(page.sources.map(source => source.id)).toEqual(page.blocks.flatMap(block => block.kind === 'image' ? block.sourceIds : []));
      const footer = scene.elements.find(element => element.kind === 'text' && element.purpose === 'source');
      if (footer?.kind !== 'text') throw new Error('Missing photo credit');
      for (const source of page.sources) expect(footer.text.replaceAll('\n', '')).toContain(source.label);
    }
  });

  it('leaves editorial captions subject to the original layout error', async () => {
    const content = gallery(7);
    const last = content.blocks.at(-1);
    if (last?.kind !== 'paragraph') throw new Error('Missing caption');
    last.text = '编辑补充说明';
    await expect(layoutAuthorizedPhotoPage(content, STUDIO_THEME, 'photo-gallery'))
      .rejects.toMatchObject({ code: 'PITCH_TEXT_CAPACITY' });
  });
});
