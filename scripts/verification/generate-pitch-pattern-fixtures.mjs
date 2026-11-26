// Offline only. Production layout, preview and editable export code; no keys,
// network or customer facts. Outputs can be regenerated and are not git assets.
import '../../supabase/tests/pitch-studio/load-app.cjs';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import {Resvg} from '@resvg/resvg-js';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {PATTERNS}=require('../../src/lib/pitch/layout/patterns/catalog.ts');
const {layoutFixture}=require('../../src/lib/pitch/fixtures/layouts.ts');
const {layoutSlides}=require('../../src/lib/pitch/layout/engine.ts');
const {STUDIO_THEME,VERIFICATION_THEME}=require('../../src/lib/pitch/design/theme.ts');
const {renderPitchPptx}=require('../../src/lib/pitch/render/pptx.ts');
const {renderSceneSvg,renderScenePng}=require('../../src/lib/pitch/render/svg.ts');
const out=path.resolve(process.argv[2]??'tmp/pitch-pattern-fixtures');
if(!['tmp','outputs'].some(root=>out.startsWith(path.resolve(root)+path.sep)))throw new Error('Use tmp/ or outputs/');
await mkdir(out,{recursive:true});
const media=[{id:'66666666-6666-4666-8666-666666666666',version:1,mime:'image/png',bytes:new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600"><rect width="2400" height="1600" fill="#E7EBEE"/><path d="M300 1400V400h600v1000M1100 1400V200h900v1200" fill="#84979A"/></svg>').render().asPng()}];
const manifest=[];
for(const [ti,theme]of [STUDIO_THEME,VERIFICATION_THEME].entries()){
 const deck=[];
 for(const p of PATTERNS){
  const content=layoutFixture(p.id),pages=(await layoutSlides(content,theme,p.id)).map(scene=>({scene,theme}));deck.push(...pages);
  const bytes=await renderPitchPptx(content.title,pages,media),zip=await JSZip.loadAsync(bytes);
  const names=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+[.]xml$/.test(n));assert.equal(names.length,pages.length);
  const xml=(await Promise.all(names.map(n=>zip.file(n).async('string')))).join('');assert.match(xml,/<a:t>/);
  if(p.slots.some(s=>s.kind==='table'))assert.match(xml,/<a:tbl>/);
  if(p.slots.some(s=>s.kind==='chart'))assert.match(xml,/chart/);
  assert.ok(!Object.keys(zip.files).some(n=>/customXml|vbaProject|externalLink/.test(n)));
  if(!ti){
   await writeFile(path.join(out,p.id+'.pptx'),bytes);
   await writeFile(path.join(out,p.id+'.svg'),await renderSceneSvg(pages[0].scene,theme,media));
   await writeFile(path.join(out,p.id+'.png'),await renderScenePng(pages[0].scene,theme,media));
   manifest.push({id:p.id,title:content.title,pages:pages.length,bytes:bytes.length,nativeText:xml.split('<a:t>').length-1,source:p.source,content,scene:pages[0].scene});
  }
 }
 // A project retains the existing 50-page bound. A fixture collection may be
 // several independently usable decks rather than bypassing that safeguard.
 for(let i=0;i<deck.length;i+=50)await writeFile(path.join(out,`布局全集_${ti+1}_${i/50+1}.pptx`),await renderPitchPptx('布局测试 · 非正式企业资料',deck.slice(i,i+50),media));
}
await writeFile(path.join(out,'manifest.json'),JSON.stringify({notice:'隔离测试，禁止对客使用',patterns:manifest},null,2));
console.log(`Generated and inspected ${PATTERNS.length} native PPTX patterns in two themes: ${out}`);
