import './load-app.cjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { Resvg } from '@resvg/resvg-js';
const require = createRequire(import.meta.url);
const { layoutFixture } = require('../../../src/lib/pitch/fixtures/layouts.ts');
const { layoutSlides } = require('../../../src/lib/pitch/layout/engine.ts');
const { legacyLayoutIds } = require('../../../src/lib/pitch/contracts/scene.ts');
const LAYOUTS=legacyLayoutIds.map(id=>({id}));
const { STUDIO_THEME, VERIFICATION_THEME } = require('../../../src/lib/pitch/design/theme.ts');
const { renderPitchPptx } = require('../../../src/lib/pitch/render/pptx.ts');
const { renderSceneSvg, renderScenePng } = require('../../../src/lib/pitch/render/svg.ts');
const { renderSceneXlsx } = require('../../../src/lib/pitch/render/xlsx.ts');
const { checkScene } = require('../../../src/lib/pitch/layout/quality.ts');
const { artifactName } = require('../../../src/lib/pitch/render/format.ts');
const { slideSceneSchema } = require('../../../src/lib/pitch/contracts/scene.ts');
const media = [{ id: '66666666-6666-4666-8666-666666666666', version: 1, mime: 'image/png', width: 1200, height: 800,
 bytes: new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#DCE3E8"/></svg>', { font: { loadSystemFonts: false } }).render().asPng() }];
let count = 0;
const check = async (name, fn) => { await fn(); count++; console.log('PASS ' + name); };
const clone = x => structuredClone(x), sample = id => layoutFixture(id), pages = [];
for (const definition of LAYOUTS) await check(`independent ${definition.id} fixture: Chinese/English, two variants, two replaceable themes`, async () => {
  for (const language of ['zh', 'en']) for (const variant of ['standard', 'alternate']) for (const theme of [STUDIO_THEME, VERIFICATION_THEME]) {
    const content = layoutFixture(definition.id, language), before = JSON.stringify(content), scenes = await layoutSlides(content, theme, definition.id, variant);
    assert.equal(JSON.stringify(content), before); assert.ok(scenes.length > 0);
    for (const scene of scenes) assert.deepEqual((await checkScene(scene, theme, media)).filter(i => i.severity === 'error'), []);
    if (language === 'zh' && variant === 'standard' && theme === STUDIO_THEME) pages.push(...scenes.map(scene => ({ scene, theme })));
  }
});
await check('single and multi-page Office ZIP contains native editable text, tables, shapes, line charts and no whole-page screenshot', async () => {
  const zip = await JSZip.loadAsync(await renderPitchPptx('中文 English 混排测试', pages, media));
  const names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)); assert.equal(names.length, 12);
  const xml = (await Promise.all(names.map(n => zip.file(n).async('string')))).join('');
  assert.match(xml, /<a:t>/); assert.match(xml, /<a:tbl>/); assert.match(xml, /graphicData[^>]*chart/); assert.match(xml, /ellipse|chevron/);
  assert.ok(xml.includes('测试数据')); assert.ok(!xml.includes('UNAUTHORIZED_RAW_SENTINEL'));
  assert.equal(Object.keys(zip.files).filter(n => /vbaProject|customXml|externalLink/i.test(n)).length, 0);
  const single = await JSZip.loadAsync(await renderPitchPptx('Single', [pages[0]], media)); assert.ok(single.file('ppt/slides/slide1.xml')); assert.equal(single.file('ppt/slides/slide2.xml'), null);
});
for (const chartType of ['column', 'bar', 'line', 'pie', 'combo']) await check(`native ${chartType} chart and embedded workbook only contain visible series`, async () => {
  const content = sample('chart-insight'), chart = content.blocks[0]; chart.chartType = chartType;
  if (chartType === 'pie') chart.series[0].values = [100, 110, 120, 118];
  if (chartType === 'combo') chart.series.push({ name: 'B', values: [90, 95, 100, 110], unit: chart.series[0].unit });
  const scene = (await layoutSlides(content, STUDIO_THEME, 'chart-insight'))[0];
  const zip = await JSZip.loadAsync(await renderPitchPptx('Visible data', [{ scene, theme: STUDIO_THEME }], []));
  const chartXml = await zip.file(Object.keys(zip.files).find(n => /^ppt\/charts\/chart[^/]+[.]xml$/.test(n))).async('string');
  assert.match(chartXml, chartType === 'pie' ? /<c:pieChart>/ : chartType === 'line' ? /<c:lineChart>/ : /<c:barChart>/);
  if (chartType === 'combo') assert.match(chartXml, /<c:lineChart>/);
  assert.match(chartXml, /dispBlanksAs val="gap"/);
  if (chartType !== 'pie') assert.match(chartXml, /<c:v><\/c:v>/); // null remains unknown, not zero
  for (const name of Object.keys(zip.files).filter(n => /^ppt\/embeddings\/.+[.]xlsx$/.test(n))) {
    const book = await JSZip.loadAsync(await zip.file(name).async('uint8array'));
    for (const f of Object.values(book.files).filter(f => !f.dir && f.name.endsWith('.xml'))) assert.doesNotMatch(await f.async('string'), /UNAUTHORIZED_RAW_SENTINEL|state="hidden"|externalLink/);
  }
  assert.ok((await renderSceneSvg(scene, STUDIO_THEME, [])).includes('<svg'));
});
await check('long table automatically paginates with repeated headers and preserves all rows, zero and unknown', async () => {
  const content = sample('data-table'); content.blocks[0].rows = Array.from({ length: 90 }, (_, i) => [`记录 ${i}`, i, i === 0 ? null : 0]);
  const scenes = await layoutSlides(content, STUDIO_THEME, 'data-table'); assert.ok(scenes.length > 1);
  const tables = scenes.flatMap(s => s.elements.filter(e => e.kind === 'table')); assert.equal(tables.reduce((n, t) => n + t.rows.length, 0), 90);
  assert.ok(tables.every(t => t.columns[0] === '期间' && t.rows.length <= 10)); assert.equal(tables[0].rows[0][2], null);
  const zip = await JSZip.loadAsync(await renderPitchPptx('Long table', scenes.map(scene => ({ scene, theme: STUDIO_THEME })), []));
  assert.equal(Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, scenes.length);
});
await check('PNG/SVG use the actual shared scene and bundled CJK outlines; no remote references or font fallback race', async () => {
  const scene = pages[7].scene, svg = await renderSceneSvg(scene, STUDIO_THEME, []);
  assert.match(svg, /<path d=/); assert.doesNotMatch(svg, /<foreignObject|<script|https?:\/\/(?!www.w3.org)/);
  const png = await renderScenePng(scene, STUDIO_THEME, []); assert.deepEqual([...png.slice(0, 8)], [137,80,78,71,13,10,26,10]);
  assert.equal(new DataView(png.buffer, png.byteOffset).getUint32(16), 2560);
});
await check('Excel exports only selected scene data as safe typed cells; source, zero, negative and unknown retained', async () => {
  const content = sample('data-table'); content.blocks[0].rows = [['=HYPERLINK("https://invalid")', -1, null], ['零 / Zero', 0, 0]];
  const scenes = await layoutSlides(content, STUDIO_THEME, 'data-table'), bytes = await renderSceneXlsx(scenes);
  const XLSX = await import('xlsx'), book = XLSX.read(bytes, { type: 'array' }); assert.equal(book.SheetNames.length, 1);
  const sheet = book.Sheets[book.SheetNames[0]]; assert.equal(sheet.B2.v, -1); assert.equal(sheet.B3.v, 0); assert.equal(sheet.A2.t, 's'); assert.equal(sheet.A2.f, undefined);
  assert.ok(!book.Workbook?.Sheets?.some(s => s.Hidden));
  await assert.rejects(renderSceneXlsx([pages[0].scene]), /PITCH_NO_DATA_EXPORT/);
});
await check('capacity, missing inputs, extreme range, unsupported layouts and encoding fail explicitly without shrinking or truncation', async () => {
  const title = sample('cover'); title.title = '超长名称'.repeat(35); await assert.rejects(layoutSlides(title, STUDIO_THEME, 'cover'), /PITCH_TITLE_CAPACITY/);
  const missing = sample('image-text'); missing.blocks = missing.blocks.filter(b => b.kind !== 'image'); await assert.rejects(layoutSlides(missing, STUDIO_THEME, 'image-text'), /PITCH_REQUIRED_CONTENT/);
  const empty = sample('data-table'); empty.blocks[0].rows = []; await assert.rejects(layoutSlides(empty, STUDIO_THEME, 'data-table'), /PITCH_EMPTY_TABLE/);
  const extreme = sample('chart-insight'); extreme.blocks[0].series[0].values[0] = 1e100; await assert.rejects(layoutSlides(extreme, STUDIO_THEME, 'chart-insight'), /PITCH_CHART_RANGE/);
  await assert.rejects(layoutSlides(sample('kpi'), STUDIO_THEME, 'image-text'), /PITCH_UNSUPPORTED_CONTENT/);
  const invalid = sample('two-columns'); invalid.blocks[0].text = '\uFFFD'; await assert.rejects(layoutSlides(invalid, STUDIO_THEME, 'two-columns'), /PITCH_TEXT_ENCODING/);
  await assert.rejects(layoutSlides(sample('cover'), STUDIO_THEME, 'unknown-layout'));
  assert.equal(new Set(Object.values(STUDIO_THEME.typography)).size, 2);
});
await check('Chinese closing punctuation stays with preceding text without losing content', async () => {
  const { wrapText, sceneFont } = require('../../../src/lib/pitch/layout/metrics.ts');
  const value = '甲乙丙丁戊己庚辛壬癸。', lines = wrapText(value, 2.55, 18, await sceneFont());
  assert.equal(lines.join(''), value); assert.ok(lines.every(line => !/^[，。！？；：、）》】」』]/u.test(line)));
});
await check('table variant changes column allocation; extra images and empty comparison are never silently omitted', async () => {
  const standard = (await layoutSlides(sample('data-table'), STUDIO_THEME, 'data-table'))[0].elements.find(e => e.kind === 'table');
  const alternate = (await layoutSlides(sample('data-table'), STUDIO_THEME, 'data-table', 'alternate'))[0].elements.find(e => e.kind === 'table');
  assert.ok(alternate.columnWidths[0] > standard.columnWidths[0]);
  for (const id of ['cover', 'case-study']) {
    const content = sample(id); content.blocks.push(clone(sample('image-text').blocks.find(b => b.kind === 'image')));
    if (content.blocks.filter(b => b.kind === 'image').length === 1) content.blocks.push(clone(content.blocks.at(-1)));
    await assert.rejects(layoutSlides(content, STUDIO_THEME, id), /PITCH_IMAGE_COUNT/);
  }
  const empty = sample('comparison'); empty.blocks[0].rows = []; await assert.rejects(layoutSlides(empty, STUDIO_THEME, 'comparison'), /PITCH_EMPTY_TABLE/);
  const unsupported = sample('chart-insight'); unsupported.blocks[0].chartType = 'scatter'; await assert.rejects(layoutSlides(unsupported, STUDIO_THEME, 'chart-insight'), /PITCH_CHART_UNSUPPORTED/);
});
await check('chart legends and bar/pie labels refuse crowding instead of drawing outside the chart', async () => {
  const legend = sample('chart-insight'); legend.blocks[0].series[0].name = '超长系列名称'.repeat(12);
  await assert.rejects(layoutSlides(legend, STUDIO_THEME, 'chart-insight'), /PITCH_CHART_LABELS/);
  for (const chartType of ['bar', 'pie']) {
    const content = sample('chart-insight'), chart = content.blocks[0]; chart.chartType = chartType;
    chart.categories = Array.from({ length: 12 }, (_, i) => String(i)); chart.series = [{ name: '测试', unit: '%', values: chart.categories.map(() => 1) }];
    await assert.rejects(layoutSlides(content, STUDIO_THEME, 'chart-insight', 'alternate'), /PITCH_CHART_LABELS/);
  }
});
await check('quality gate catches overlap, overflow, missing/low resolution images, empty scenes and invalid coordinates', async () => {
  const overlap = clone(pages[0].scene); overlap.elements.push(clone(overlap.elements[0])); assert.ok((await checkScene(overlap, STUDIO_THEME, media)).some(i => i.code === 'ELEMENT_OVERLAP'));
  const text = clone(pages[0].scene); text.elements[0].text = '很长的正文'.repeat(100); assert.ok((await checkScene(text, STUDIO_THEME, media)).some(i => /OVERFLOW/.test(i.code)));
  const imageScene = pages[2].scene; assert.ok((await checkScene(imageScene, STUDIO_THEME, [])).some(i => i.code === 'IMAGE_MISSING'));
  assert.ok((await checkScene(imageScene, STUDIO_THEME, [{ ...media[0], width: 20, height: 20 }])).some(i => i.code === 'IMAGE_RESOLUTION'));
  assert.equal(slideSceneSchema.safeParse({ ...imageScene, elements: [{ ...imageScene.elements[0], x: 13, w: 5 }] }).success, false);
  await assert.rejects(renderPitchPptx('Denied', [{ scene: imageScene, theme: STUDIO_THEME }], []), /PITCH_LAYOUT_QUALITY/);
  assert.match(artifactName('中文 / English', 'pptx', 0), /^中文 _ English-01[.]pptx$/);
});
console.log(`PASS ${count} render engine groups; all fixtures are synthetic isolated data`);
