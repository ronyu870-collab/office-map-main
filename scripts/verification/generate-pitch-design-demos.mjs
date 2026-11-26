import '../../supabase/tests/pitch-studio/load-app.cjs';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const { designDemos, designComparisonCover, fixtureImages, fixtureMediaId } = require('../../src/lib/pitch/fixtures/design.ts');
const { PRESENTATION_THEME_CANDIDATES } = require('../../src/lib/pitch/design/theme.ts');
const { layoutSlides } = require('../../src/lib/pitch/layout/engine.ts');
const { numberDeckPages } = require('../../src/lib/pitch/layout/pagination.ts');
const { checkDeckDesign, checkScene } = require('../../src/lib/pitch/layout/quality.ts');
const { renderPitchPptx } = require('../../src/lib/pitch/render/pptx.ts');
const { renderSceneSvg } = require('../../src/lib/pitch/render/svg.ts');
const { renderSceneXlsx } = require('../../src/lib/pitch/render/xlsx.ts');

const out = path.resolve(process.argv[2] ?? 'tmp/pitch-design-demos');
if (![path.resolve('tmp'), path.resolve('outputs')].some(root => out.startsWith(root + path.sep))) throw new Error('Choose an output directory under tmp/ or outputs/');
await mkdir(out, { recursive: true });

// Original synthetic facades with no fetched media, identity or claim to depict
// any real property. High resolution allows checking crops rather than masks.
const palette = [['A6BAC0', '385F71', '537885'], ['CBD6D2', '526957', '6A8271'],
  ['B9CBCC', '2C4D60', '4A6877'], ['BAC7C3', '466459', '5E7E71'],
  ['C4C4B6', '635A4E', '827769'], ['C0C9D1', '47536B', '647082']];
function facade(width, height, index) {
  const [sky, dark, mid] = palette[index % palette.length];
  const frontLeft = 195 + (index % 3) * 40, top = 115 + (index % 4) * 30;
  const windows = Array.from({length: 18}, (_, row) => Array.from({length: 10}, (_, col) => {
    const x = frontLeft + 16 + col * 30, y = top + 10 + row * 32 + col * 4.4;
    const fill = (row + col + index) % 11 === 0 ? 'B39970' : (row * 7 + col * 3) % 17 > 8 ? dark : mid;
    return `<path d="M${x} ${y}l24 3.5v24l-24-3.5z" fill="#${fill}"/>`;
  }).join('')).join('');
  const side = Array.from({length: 16}, (_, row) => {
    const y = top + row * 34 + 62;
    return `<path d="M${frontLeft + 327} ${y}l122 -38v14l-122 38z" fill="#${dark}" opacity=".72"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 800 760" preserveAspectRatio="xMidYMid slice">
    <rect width="800" height="760" fill="#${sky}"/>
    <path d="M0 590L256 525 800 552V760H0Z" fill="#9DA79F"/>
    <path d="M0 688L800 625V760H0Z" fill="#606E70"/>
    <path d="M${frontLeft + 320} ${top + 52}l130 -64v581l-130 55z" fill="#${mid}"/>
    <path d="M${frontLeft} ${top}l320 46v579l-320-52z" fill="#BAC1BB"/>
    ${windows}${side}
    <path d="M0 715L800 670" stroke="#B6B9AF" stroke-width="3"/>
    <path d="M101 714v-151m0 70l-32 -36m32 20l25 -46" stroke="#697776" stroke-width="9"/>
    <path d="M707 699v-121m0 48l-30 -47m30 55l31 -36" stroke="#697776" stroke-width="7"/>
  </svg>`;
  return new Resvg(svg, {font: {loadSystemFonts: false}}).render().asPng();
}
const media = fixtureImages.map(([width, height], i) => ({
  id: fixtureMediaId(i), version: 1, mime: 'image/png', width, height, bytes: facade(width, height, i),
}));

const manifest = [];
const emit = async (id, title, pages) => {
  pages = numberDeckPages(pages);
  await writeFile(path.join(out, id + '.pptx'), await renderPitchPptx(title, pages, media));
  const svgDir = path.join(out, id);
  await mkdir(svgDir, {recursive: true});
  const slideDetails = [];
  for (const [i, {scene, theme}] of pages.entries()) {
    const svg = await renderSceneSvg(scene, theme, media);
    const stem = String(i + 1).padStart(2, '0');
    await writeFile(path.join(svgDir, stem + '.svg'), svg);
    await writeFile(path.join(svgDir, stem + '.png'), new Resvg(svg, {font: {loadSystemFonts: false}}).render().asPng());
    slideDetails.push({ page: i + 1, theme: theme.id, layout: scene.layoutId, composition: scene.composition, quality: await checkScene(scene, theme, media) });
  }
  manifest.push({ id, title, pages: slideDetails, quality: checkDeckDesign(pages.map(p => p.scene)) });
};
for (const demo of designDemos) {
  const theme = PRESENTATION_THEME_CANDIDATES[demo.theme], pages = [];
  for (const {layout, content} of demo.pages) {
    pages.push(...(await layoutSlides(content, theme, layout)).map(scene => ({scene, theme})));
  }
  await emit(demo.id, demo.title, pages);
  if (pages.some(({scene}) => scene.elements.some(e => ['table', 'chart', 'map'].includes(e.kind)))) {
    await writeFile(path.join(out, demo.id + '.xlsx'), await renderSceneXlsx(pages.map(p => p.scene)));
  }
}
const cover = designComparisonCover();
const themes = await Promise.all(PRESENTATION_THEME_CANDIDATES.map(async theme => ({scene: (await layoutSlides(cover, theme, 'cover'))[0], theme})));
await emit('six-theme-comparison', '六个设计候选｜固定内容比较', themes);
await writeFile(path.join(out, 'manifest.json'), JSON.stringify({ notice: '构图验证 · 合成图与测试数据 · 候选主题', decks: manifest }, null, 2));
console.log(out);
