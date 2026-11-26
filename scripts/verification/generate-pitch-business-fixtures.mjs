// Offline, isolated business assets -> the production business builder -> shared
// scene engine -> both editable theme decks. No enterprise facts or network.
import '../../supabase/tests/pitch-studio/load-app.cjs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {businessFixture,TEST_SCOPE} from '../../supabase/tests/pitch-studio/business-fixtures.mjs';
const require=createRequire(import.meta.url),{buildBusinessPages}=require('../../src/lib/pitch/business/content.ts'),{businessProfileSchema}=require('../../src/lib/pitch/business/protocol.ts'),{BUSINESS_RECIPES}=require('../../src/lib/pitch/business/recipes.ts'),{normalizationPlan}=require('../../src/lib/pitch/library/normalize.ts'),{layoutSlides}=require('../../src/lib/pitch/layout/engine.ts'),{STUDIO_THEME,VERIFICATION_THEME}=require('../../src/lib/pitch/design/theme.ts'),{renderPitchPptx}=require('../../src/lib/pitch/render/pptx.ts'),{renderScenePng}=require('../../src/lib/pitch/render/svg.ts'),{numberDeckPages}=require('../../src/lib/pitch/layout/pagination.ts');
const out=path.resolve(process.argv[2]??'tmp/pitch-business-offline');if(![path.resolve('tmp'),path.resolve('outputs')].some(root=>out.startsWith(root+path.sep)))throw new Error('Use tmp/ or outputs/ directory');await mkdir(out,{recursive:true});
const asset=(kind,index=0,language='zh')=>{const f=businessFixture(kind,index,language);return {id:randomUUID(),version:1,scope:TEST_SCOPE,content:f.content,profile:businessProfileSchema.parse(f.profile)};};
const corporate=asset('corporate'),teams=Array.from({length:7},(_,i)=>asset('team',i)),cases=[asset('case'),asset('case',2)],research=asset('research');
const groups=[['corporate-overview',[corporate]],['corporate-metrics',[corporate]],['corporate-capabilities',[corporate]],['team-multiple',teams],['team-roles',teams],['team-organization',teams],['case-detail',[cases[0]]],['case-brief',[cases[0]]],['case-portfolio',cases],['case-track-record',cases],['research-page',[research]]];
const manifest=[];
for(const [index,theme]of [STUDIO_THEME,VERIFICATION_THEME].entries()){
 const deck=[];
 for(const [recipeId,assets]of groups){const recipe={...BUSINESS_RECIPES.find(r=>r.id===recipeId),revision:1,categoryId:randomUUID(),enabled:true};for(const page of buildBusinessPages(recipe,assets,'zh','detailed','standard')){let parts;try{await layoutSlides(page.content,theme,page.layoutId,page.variant);parts=[page];}catch{parts=await normalizationPlan(page.content,theme);}for(const part of parts)deck.push(...(await layoutSlides(part.content,theme,part.layoutId,part.variant)).map(scene=>({scene,theme})));}}
 const pages=numberDeckPages(deck);await writeFile(path.join(out,`隔离业务模板_${index===0?'基础主题':'替换主题'}.pptx`),await renderPitchPptx('隔离业务模板 · 非正式企业事实',pages,[]));
 if(!index){for(const i of [0,1,3,pages.findIndex(p=>p.scene.elements.some(e=>e.kind==='chart'))])if(i>=0)await writeFile(path.join(out,`业务页面_${String(i+1).padStart(2,'0')}.png`),await renderScenePng(pages[i].scene,pages[i].theme,[]));manifest.push(...pages.map(p=>({layout:p.scene.layoutId,scene:p.scene})));}
}
await writeFile(path.join(out,'manifest.json'),JSON.stringify({notice:'仅隔离测试，无真实企业、员工或客户事实；动态真实 SQL 复现另见 business.mjs',scope:TEST_SCOPE,recipes:groups.map(g=>g[0]),pages:manifest},null,2));console.log('Generated isolated business decks in both themes, actual scene PNGs and manifest: '+out);
