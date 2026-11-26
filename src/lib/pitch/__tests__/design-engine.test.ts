import JSZip from 'jszip';
import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { slideSceneSchema } from '../contracts/scene';
import { PRESENTATION_THEME_CANDIDATES, STUDIO_THEME } from '../design/theme';
import { designComparisonCover, designDemos, fixtureImages, fixtureMediaId } from '../fixtures/design';
import { layoutSlides } from '../layout/engine';
import { imageFromResolvedVisual } from '../layout/visual-assets';
import { checkDeckDesign, checkScene } from '../layout/quality';
import { chartScale, cover } from '../render/geometry';
import { renderPitchPptx } from '../render/pptx';
import { renderSceneSvg } from '../render/svg';
import { renderSceneXlsx } from '../render/xlsx';

const [executive, , editorial, research, , portfolio] = PRESENTATION_THEME_CANDIDATES;
const media = fixtureImages.map(([width, height], i) => ({
  id: fixtureMediaId(i), version: 1, mime: 'image/png', width, height,
  bytes: new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#65838D"/></svg>`).render().asPng(),
}));

describe('Pitch design candidates', () => {
  it('chooses six distinct cover structures on fixed bilingual content', async () => {
    const cover = designComparisonCover(), scenes = [];
    for (const theme of PRESENTATION_THEME_CANDIDATES) {
      const [scene] = await layoutSlides(cover, theme, 'cover');
      scenes.push(scene);
      expect(theme.approval).toBe('provisional');
      expect(scene.rendererVersion).toBe('pitch-scene/2');
      expect(scene.designVersion).toBe(1);
      expect(scene.elements).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'text', semantic: 'cover', text: cover.title })]));
      expect((await checkScene(scene, theme, media)).filter(issue => issue.severity === 'error')).toEqual([]);
    }
    expect(new Set(scenes.map(scene => scene.composition)).size).toBe(6);
    expect(checkDeckDesign(scenes)).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DECK_THEME_INCONSISTENCY' })]));
  });

  it('exports a full bleed pinned image with native noncentral crop and editable title', async () => {
    const demo = designDemos[3].pages[0], [scene] = await layoutSlides(demo.content, editorial, demo.layout);
    expect(scene.composition).toBe('full-bleed');
    const image = scene.elements.find(e => e.kind === 'image')!;
    expect(image).toMatchObject({ fit: 'cover', bleed: true, mediaAssetId: fixtureMediaId(7) });
    const crop = cover(image, media[7].width, media[7].height, image.focus);
    expect(crop.y).toBeLessThan(cover(image, media[7].width, media[7].height).y);
    const svg = await renderSceneSvg(scene, editorial, media);
    expect(svg).toContain('overflow="hidden"');
    expect(svg).toContain('合成插图');
    const zip = await JSZip.loadAsync(await renderPitchPptx('Full bleed', [{ scene, theme: editorial }], [media[7]]));
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml.match(/<p:pic>/g)).toHaveLength(1);
    expect(xml).toContain('Landmark Offices');
    expect(xml).toContain(`t="${Math.round(100000 * crop.y / crop.h)}"`);
    expect(xml).toContain('建筑立面与街道界面');
    await expect(renderSceneSvg(scene, editorial, [])).rejects.toThrow('PITCH_LAYOUT_QUALITY');
  });

  it('chooses a text-only page when an image was not supplied and preserves all paginated copy', async () => {
    const content = designDemos[0].pages[1].content;
    const text = Array.from({ length: 38 }, (_, i) => `示意段落 ${i + 1}，需保留完整事实和现场核对记录。`).join('\n');
    const raw = { ...content, blocks: [{ kind: 'paragraph' as const, text, sourceIds: [content.sources[0].id] }] };
    const scenes = await layoutSlides(raw, executive, 'image-text');
    expect(scenes.length).toBeGreaterThan(1);
    expect(scenes.every(scene => scene.composition === 'text-only' && scene.elements.every(e => e.kind !== 'image'))).toBe(true);
    const rendered = scenes.flatMap(s => s.elements.flatMap(e => e.kind === 'text' && e.semantic === 'body' ? [e.text] : []));
    expect(rendered.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
    const legacyContent = designComparisonCover();
    const legacy = (await layoutSlides({ ...legacyContent, blocks: legacyContent.blocks.map(block => block.kind === 'image' ? { ...block, caption: undefined, credit: undefined } : block) }, STUDIO_THEME, 'cover'))[0];
    expect(slideSceneSchema.parse(legacy).designVersion).toBeUndefined();
  });

  it('preserves the resolver reference, attribution and no-crop license across theme variants', async () => {
    const content = designComparisonCover(), file = media[7];
    const reference = { kind: 'photo' as const, id: file.id, version: file.version, versionHash: 'a'.repeat(64),
      buildingIds: ['66111111-1111-4111-8111-111111111111'], source: content.sources[0], disclosure: 'internal' as const,
      dimensions: { width: file.width, height: file.height }, caption: '获权照片',
      rights: { attribution: 'Fixture Author', licenseName: 'CC BY-SA 4.0', cropAllowed: false,
        sourceUrl: 'https://example.invalid/photo', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    };
    const input = imageFromResolvedVisual({ reference, media: file }, { fit: 'cover', focalX: .5, focalY: .1 });
    expect(input.block).toMatchObject({ fit: 'contain', sourceIds: [reference.source.id] });
    expect(input.block.focus).toBeUndefined();
    const [scene] = await layoutSlides({ ...content, blocks: [input.block] }, editorial, 'cover');
    expect(scene.elements.find(e => e.kind === 'image')).toMatchObject({ fit: 'contain' });
    const svg = await renderSceneSvg(scene, editorial, [file]);
    expect(svg).toContain('Fixture Author');
    expect(svg).toContain('https://example.invalid/photo');
    expect(svg).toContain('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(() => imageFromResolvedVisual({ reference, media: { ...file, version: 2 } })).toThrow('PITCH_SOURCE_CHANGED');
  });

  it('keeps the five-building lineup on a common photo aperture with its captions', async () => {
    const { layout, content } = designDemos[1].pages[0];
    const [scene] = await layoutSlides(content, portfolio, layout);
    const pictures = scene.elements.filter(e => e.kind === 'image');
    expect(pictures).toHaveLength(5);
    expect(new Set(pictures.map(e => e.w / e.h)).size).toBe(1);
    expect(scene.elements.filter(e => e.kind === 'text' && e.semantic === 'caption')).toHaveLength(5);
  });
});

describe('Pitch chart geometry and native export', () => {
  it('renders two numeric scatter axes across layout, SVG, editable PPTX and workbooks', async () => {
    const { content, layout } = designDemos[1].pages[2];
    const [scene] = await layoutSlides(content, portfolio, layout);
    const svg = await renderSceneSvg(scene, portfolio, []);
    expect(svg).toContain('报价租金 (元/㎡/天)');
    expect(svg).toContain('空置率 (%)');
    expect(svg.match(/<circle /g)).toHaveLength(5);
    const zip = await JSZip.loadAsync(await renderPitchPptx('Scatter', [{ scene, theme: portfolio }], []));
    const chartEntry = Object.values(zip.files).find(file => /^ppt\/charts\/chart\d+\.xml$/.test(file.name))!;
    const chart = await chartEntry.async('string');
    expect(chart).toContain('<c:scatterChart>');
    expect(chart.match(/<c:valAx>/g)).toHaveLength(2);
    expect(chart).toMatch(/<c:xVal>[\s\S]*?<c:v>7\.2<\/c:v>/);
    expect(chart).toMatch(/<c:yVal>[\s\S]*?<c:v>14\.9<\/c:v>/);
    expect(chart).toContain('示例 C');
    const workbookEntry = Object.values(zip.files).find(file => file.name.startsWith('ppt/embeddings/') && file.name.endsWith('.xlsx'))!;
    const workbook = XLSX.read(await workbookEntry.async('uint8array'));
    const cells = workbook.Sheets[workbook.SheetNames[0]];
    expect(cells.A4.v).toBe(7.2);
    expect(cells.C4.v).toBe(14.9);
    const xlsx = XLSX.read(await renderSceneXlsx([scene]));
    const visible = xlsx.Sheets[xlsx.SheetNames[0]];
    expect([visible.A4.v, visible.B4.v, visible.C4.v]).toEqual(['示例 C', 7.2, 14.9]);
  });

  it('stacks signed values on independent sides of zero and creates the native stack', async () => {
    const { content, layout } = designDemos[2].pages[3];
    const chartBlock = content.blocks[0];
    if (chartBlock.kind !== 'chart') throw new Error('invalid fixture');
    const raw = { ...content, blocks: [{ ...chartBlock, series: [
      { ...chartBlock.series[0], values: [12, -13, 9, 0] },
      { ...chartBlock.series[1], values: [7, -9, -5, 0] },
    ] }] };
    const [scene] = await layoutSlides(raw, research, layout);
    const chart = scene.elements.find(e => e.kind === 'chart')!;
    const scale = chartScale(chart);
    expect(scale.min).toBeLessThanOrEqual(-22);
    expect(scale.max).toBeGreaterThanOrEqual(19);
    const zip = await JSZip.loadAsync(await renderPitchPptx('Stack', [{ scene, theme: research }], []));
    const entry = Object.values(zip.files).find(file => /^ppt\/charts\/chart\d+\.xml$/.test(file.name))!;
    expect(await entry.async('string')).toContain('<c:grouping val="stacked"/>');
    await expect(layoutSlides({ ...raw, blocks: [{ ...raw.blocks[0], series: [
      { ...raw.blocks[0].series[0], values: [null, -13, 9, 0] },
      raw.blocks[0].series[1],
    ] }] }, research, layout)).rejects.toThrow('PITCH_STACK_VALUES');
  });

  it('preserves one heat scale and editable row data across multiple pages', async () => {
    const { content, layout } = designDemos[2].pages[2];
    const first = content.blocks[0];
    if (first.kind !== 'table') throw new Error('invalid fixture');
    const rows = Array.from({ length: 20 }, (_, i) => [` 样本 ${i}`, i, null, 0, i, i]);
    const pages = await layoutSlides({ ...content, blocks: [{ ...first, rows }] }, research, layout);
    const tables = pages.map(s => s.elements.find(e => e.kind === 'table')!);
    expect(tables.length).toBeGreaterThan(1);
    expect(tables.flatMap(table => table.rows)).toEqual(rows);
    expect(tables.every(table => table.heatScale?.max === 19 && table.heatScale.min === 0)).toBe(true);
    const zip = await JSZip.loadAsync(await renderPitchPptx('Heat', pages.map(scene => ({ scene, theme: research })), []));
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toContain('<a:tbl>');
    expect(xml).toContain('—');
    expect(new Set([...xml.matchAll(/<a:srgbClr val="([A-F0-9]{6})"/g)].map(match => match[1])).size).toBeGreaterThan(4);
  });
});
