// Reproducible, local-only files from the exact production engine. No database,
// account credentials, network queries or real business records are involved.
import '../../supabase/tests/pitch-studio/load-app.cjs';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
const require = createRequire(import.meta.url);
const { layoutFixture } = require('../../src/lib/pitch/fixtures/layouts.ts');
const { layoutSlides } = require('../../src/lib/pitch/layout/engine.ts');
const { legacyLayoutIds } = require('../../src/lib/pitch/contracts/scene.ts');
const LAYOUTS=legacyLayoutIds.map(id=>({id}));
const { STUDIO_THEME, VERIFICATION_THEME } = require('../../src/lib/pitch/design/theme.ts');
const { numberDeckPages } = require('../../src/lib/pitch/layout/pagination.ts');
const { renderPitchPptx } = require('../../src/lib/pitch/render/pptx.ts');
const { renderSceneSvg, renderScenePng } = require('../../src/lib/pitch/render/svg.ts');
const { renderSceneXlsx } = require('../../src/lib/pitch/render/xlsx.ts');
const out = path.resolve(process.argv[2] ?? 'tmp/pitch-render-fixtures');
if (!out.startsWith(path.resolve('tmp') + path.sep) && !out.startsWith(path.resolve('outputs') + path.sep)) throw new Error('Use an output directory under tmp/ or outputs/');
await mkdir(out, { recursive: true });
const bytes = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#E5E9EA"/><path d="M150 700V240h250v460M470 700V100h300v600M840 700V350h210v350" fill="#84949F"/><path d="M190 300h170m-170 80h170m-170 80h170m-170 80h170m210-370h220m-220 90h220m-220 90h220m-220 90h220m-220 90h220" stroke="#E5E9EA" stroke-width="25"/></svg>', { font: { loadSystemFonts: false } }).render().asPng();
const media = [{ id: '66666666-6666-4666-8666-666666666666', version: 1, mime: 'image/png', bytes }];
const manifest = [];
for (const [ti, theme] of [STUDIO_THEME, VERIFICATION_THEME].entries()) {
  const pages = [];
  for (const [i, layout] of LAYOUTS.entries()) {
    // The same content and template inputs are used for both themes.
    const content = layoutFixture(layout.id, i % 2 ? 'en' : 'zh');
    const scenes = await layoutSlides(content, theme, layout.id);
    pages.push(...scenes.map(scene => ({ scene, theme })));
    if (ti === 0) {
      const stem = `${String(i + 1).padStart(2, '0')}-${layout.id}`;
      await writeFile(path.join(out, stem + '.pptx'), await renderPitchPptx(content.title, [{ scene: scenes[0], theme }], media));
      await writeFile(path.join(out, stem + '.svg'), await renderSceneSvg(scenes[0], theme, media));
      await writeFile(path.join(out, stem + '.png'), await renderScenePng(scenes[0], theme, media));
      manifest.push({ layout: layout.id, title: content.title, pages: scenes.length, input: content, theme: { id: theme.id, version: theme.version } });
    }
  }
  await writeFile(path.join(out, `Colliers-Pitch-测试-${ti === 0 ? '基础' : '替换主题'}.pptx`), await renderPitchPptx('Pitch renderer · TEST DATA', numberDeckPages(pages), media));
  if (ti === 0) await writeFile(path.join(out, 'Colliers-Pitch-测试数据.xlsx'), await renderSceneXlsx(pages.map(p => p.scene)));
}
await writeFile(path.join(out, 'manifest.json'), JSON.stringify({ notice: 'TEST DATA · 非高力国际真实业务案例', manifest }, null, 2));
console.log(`Generated 12 individual PPTX / PNG / SVG fixtures, two theme decks and visible data XLSX at ${out}`);
