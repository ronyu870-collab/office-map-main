import { randomBytes } from 'node:crypto';
import JSZip from 'jszip';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { STUDIO_THEME } from '../design/theme';
import { layoutFixture } from '../fixtures/layouts';
import { layoutSlides } from '../layout/engine';
import { renderPitchPptx } from './pptx';

it('reuses a repeated photo before applying the file limit and retains every native slide object', async () => {
  const width = 1440, height = 900;
  const image = await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } }).png().toBuffer();
  const cover = layoutFixture('cover');
  const photo = cover.blocks.find(block => block.kind === 'image');
  if (!photo) throw new Error('Expected a cover image');
  const [imagePage] = await layoutSlides(cover, STUDIO_THEME, 'cover');
  const [chartPage] = await layoutSlides(layoutFixture('chart-insight'), STUDIO_THEME, 'chart-insight');
  const samePhotoId = '11111111-1111-4111-8111-111111111111';
  const otherPhotoId = '22222222-2222-4222-8222-222222222222';
  const other = await sharp({ create: { width, height, channels: 3, background: '#1a3e64' } }).png().toBuffer();
  const withImage = (mediaAssetId: string) => ({ ...imagePage, elements: imagePage.elements.map(element =>
    element.kind === 'image' ? { ...element, mediaAssetId } : element) });
  const pages = [...Array.from({ length: 4 }, () => imagePage), withImage(samePhotoId), withImage(otherPhotoId), chartPage]
    .map(scene => ({ scene, theme: STUDIO_THEME }));
  const bytes = await renderPitchPptx('五页复用楼宇照片', pages, [
    { id: photo.mediaAssetId, version: photo.mediaVersion, mime: 'image/png', bytes: image },
    { id: samePhotoId, version: photo.mediaVersion, mime: 'image/png', bytes: Buffer.from(image) },
    { id: otherPhotoId, version: photo.mediaVersion, mime: 'image/png', bytes: other },
  ]);
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const pictures = Object.values(archive.files).filter(entry => !entry.dir && entry.name.startsWith('ppt/media/'));
  expect(pictures).toHaveLength(2);
  const contents = await Promise.all(pictures.map(async part => ({ name: part.name, bytes: await part.async('nodebuffer') })));
  const originalPart = contents.find(part => part.bytes.equals(image));
  const independentPart = contents.find(part => part.bytes.equals(other));
  expect(originalPart).toBeDefined();
  expect(independentPart).toBeDefined();
  expect(bytes.byteLength).toBeLessThan(5 * 1024 * 1024);
  const sharedTarget = '../media/' + originalPart?.name.split('/').at(-1);

  for (let page = 1; page <= 5; page++) {
    const slide = await archive.file(`ppt/slides/slide${page}.xml`)?.async('string');
    const relationships = await archive.file(`ppt/slides/_rels/slide${page}.xml.rels`)?.async('string');
    const imageId = /<a:blip\b[^>]*r:embed="(rId\d+)"/.exec(slide ?? '')?.[1];
    expect(slide).toMatch(/<p:pic>/);
    expect(slide).toMatch(/<a:t>/);
    expect(imageId).toBeTruthy();
    expect(relationships).toContain(`Id="${imageId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${sharedTarget}"`);
  }
  const independentRelationships = await archive.file('ppt/slides/_rels/slide6.xml.rels')?.async('string');
  expect(independentRelationships).toContain('../media/' + independentPart?.name.split('/').at(-1));
  expect(await archive.file('ppt/slides/slide7.xml')?.async('string')).toMatch(/<c:chart\b/);
  expect(Object.keys(archive.files)).toContain('ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx');
});
