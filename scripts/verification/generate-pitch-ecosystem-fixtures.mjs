// Offline, synthetic examples through the exact production builders/renderers.
import '../../supabase/tests/pitch-studio/load-app.cjs';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { Resvg } from '@resvg/resvg-js';
const require = createRequire(import.meta.url);
const { templateExample } = require('../../src/lib/pitch/fixtures/business.ts');
const { BUSINESS_RECIPES, DYNAMIC_CAPABILITIES } = require('../../src/lib/pitch/business/recipes.ts');
const { DECK_KITS } = require('../../src/lib/pitch/templates/deckKits.ts');
const { layoutSlides } = require('../../src/lib/pitch/layout/engine.ts');
const { STUDIO_THEME, VERIFICATION_THEME } = require('../../src/lib/pitch/design/theme.ts');
const { renderPitchPptx } = require('../../src/lib/pitch/render/pptx.ts');
const { renderSceneSvg, renderScenePng } = require('../../src/lib/pitch/render/svg.ts');
const { assertSceneQuality } = require('../../src/lib/pitch/layout/quality.ts');
const { inspectMedia } = require('../../src/lib/pitch/render/media.ts');
const { numberDeckPages } = require('../../src/lib/pitch/layout/pagination.ts');
const out = path.resolve(process.argv[2] ?? 'tmp/pitch-ecosystem-fixtures');
if (!['tmp', 'outputs'].some(root => out.startsWith(path.resolve(root) + path.sep)))
    throw new Error('Use tmp/ or outputs/');
await mkdir(out, { recursive: true });
const mediaId = '66666666-6666-4666-8666-666666666666', sourceId = '55555555-5555-4555-8555-555555555555';
const media = await inspectMedia([{ id: mediaId, version: 1, mime: 'image/png', bytes: new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600"><rect width="2400" height="1600" fill="#E7EBEE"/><path d="M300 1400V400h600v1000M1100 1400V200h900v1200" fill="#84979A"/></svg>').render().asPng() }]);
const templates = [...BUSINESS_RECIPES, ...DYNAMIC_CAPABILITIES.filter(t => t.status === 'available')];
assert.ok(templates.length >= 100);
assert.equal(new Set(templates.map(t => t.id)).size, templates.length);
const manifest = [];
async function build(id, language, theme) { const pages = []; for (const p of templateExample(id, language, sourceId, mediaId)) {
    assert.equal(p.content.isTestData, true);
    assert.equal(p.content.disclosure, 'internal');
    for (const scene of await layoutSlides(p.content, theme, p.layoutId, p.variant)) {
        await assertSceneQuality(scene, theme, media);
        pages.push({ scene, theme });
    }
} return numberDeckPages(pages); }
async function inspect(bytes, pages) { const zip = await JSZip.loadAsync(bytes), names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+[.]xml$/.test(n)); assert.equal(names.length, pages.length); const xml = (await Promise.all(names.map(n => zip.file(n).async('string')))).join(''); assert.match(xml, /<a:t>/); if (pages.some(p => p.scene.elements.some(e => e.kind === 'table')))
    assert.match(xml, /<a:tbl>/); if (pages.some(p => p.scene.elements.some(e => e.kind === 'chart')))
    assert.ok(Object.keys(zip.files).some(n => /^ppt\/charts\/chart\d+[.]xml$/.test(n))); assert.ok(!Object.keys(zip.files).some(n => /customXml|vbaProject|externalLink/.test(n))); assert.match(xml, /合成|示例|Synthetic|synthetic/); return { bytes: bytes.length, pages: pages.length, nativeText: xml.split('<a:t>').length - 1 }; }
for (const template of templates) {
    let first;
    for (const language of ['zh', 'en'])
        for (const [ti, theme] of [STUDIO_THEME, VERIFICATION_THEME].entries()) {
            const pages = await build(template.id, language, theme), bytes = await renderPitchPptx(template.id, pages, media);
            const result = await inspect(bytes, pages);
            await writeFile(path.join(out, `${template.id}_${language}_${ti + 1}.pptx`), bytes);
            if (language === 'zh' && !ti) {
                first = result;
                await writeFile(path.join(out, template.id + '.svg'), await renderSceneSvg(pages[0].scene, theme, media));
                if (!process.env.CI)
                    await writeFile(path.join(out, template.id + '.png'), await renderScenePng(pages[0].scene, theme, media));
            }
        }
    manifest.push({ id: template.id, ...first });
}
for (const kit of DECK_KITS)
    for (const [ti, theme] of [STUDIO_THEME, VERIFICATION_THEME].entries()) {
        const pages = [];
        for (const section of kit.sections)
            pages.push(...await build(section.templateId, 'zh', theme));
        assert.ok(pages.length <= 50);
        const numbered = numberDeckPages(pages), bytes = await renderPitchPptx(kit.names.zh, numbered, media);
        await inspect(bytes, numbered);
        await writeFile(path.join(out, `kit_${kit.id}_${ti + 1}.pptx`), bytes);
    }
await writeFile(path.join(out, 'manifest.json'), JSON.stringify({ notice: '合成示例，非企业正式事实；动态示例不替代授权 SQL 回归。', templates: manifest, kits: DECK_KITS.map(k => ({ id: k.id, version: k.version, sections: k.sections })) }, null, 2));
console.log(`PASS ${templates.length} templates × 2 languages × 2 themes, ${DECK_KITS.length} complete kits × 2 themes; native PPTX files: ${out}`);
