import './load-app.cjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {installLeaseResearchFixture,grantLeaseResearch,seedLeaseResearch} from '../ai-lease-research/fixture.mjs';
import JSZip from 'jszip';
import {createPitchDatabase,OWNER,OTHER,ADMIN,VIEWER,sessionFor} from './database.mjs';
import {businessFixture,TEST_SCOPE as scope,PRIVATE_CLIENT,dynamicFixture} from './business-fixtures.mjs';
import {installPitchDataFixture} from './business-data-fixture.mjs';
import {grantQuery} from '../ai-query-authority/database.mjs';
import {BUILDINGS} from '../ai-query-authority/snapshot-fixture.mjs';
const require=createRequire(import.meta.url),workflow=require('../../../src/lib/pitch/business/workflow.ts'),library=require('../../../src/lib/pitch/library/workflow.ts'),render=require('../../../src/lib/pitch/data/renderWorkflow.ts'),{digest}=require('../../../src/lib/pitch/data/store.ts');
const db=await createPitchDatabase(),files=new Map();let count=0;
const check=async(name,fn)=>{await fn();count++;console.log('PASS '+name);};
const rpcOrder={ai_lease_research_snapshot:['p_actor','p_effective','p_session'],ai_query_authority:['p_actor','p_effective','p_session'],ai_query_snapshot_read:['p_actor','p_effective','p_session','p_permission_revision','p_fields','p_periods','p_inventory','p_submarkets','p_building_ids']};
function ctx(uid){return {identity:{actorId:uid,effectiveUserId:uid,sessionId:sessionFor(uid),expiresAt:Date.now()+600000},signal:new AbortController().signal,client:{rpc(name,args){return {async abortSignal(){try{if(name==='pitch_studio_access')return {data:await db.rpc(uid,args.p_input),error:null};const keys=rpcOrder[name];assert.ok(keys);const query=`select public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) result`;const result=await db.setup.query(query,keys.map(k=>k==='p_periods'?JSON.stringify(args[k]):args[k]));return {data:result.rows[0].result,error:null};}catch(e){return {data:null,error:{code:e.code,message:e.message}};}}};},storage:{from(){return {async upload(path,bytes){if(files.has(path))return {error:{message:'exists'}};files.set(path,new Uint8Array(bytes));return {error:null};},async download(path){const bytes=files.get(path);return bytes?{data:new Blob([bytes]),error:null}:{data:null,error:{message:'missing'}};}};}}}};}
const owner=ctx(OWNER),ordinary=ctx(OTHER),admin=ctx(ADMIN);let category;const ids={};
async function asset(kind,index=0,who=owner,language='zh') {
 const fixture=businessFixture(kind,index,language),bytes=new TextEncoder().encode(fixture.content.title+'\n隔离合成资料，不代表真实业务事实。');
 const receipt=await library.prepareImport(who,{action:'prepare',requestId:randomUUID(),filename:fixture.content.title+'.txt',mime:'text/plain',size:bytes.length,sha256:digest(bytes),metadata:{scope,categoryId:category,tags:['隔离'],language,dataAsOf:fixture.content.dataAsOf,source:'隔离合成工程测试',visibility:'organization',isTestData:true,allowClientExport:false,validFrom:null,validUntil:null}});
 await library.uploadPart(who,receipt.job.id,0,bytes);await library.finishUpload(who,receipt.job.id);await library.runParseSlice(who,receipt.job.id);
 const assetId=(await db.setup.query('select asset_id from pitch_source_pages where document_id=$1',[receipt.documentId])).rows[0].asset_id;
 const actual=await library.assetContext(who,assetId);const embedded=fixture.profile.display??fixture.profile.content;
 for(const display of [embedded,fixture.profile.briefDisplay].filter(Boolean)){display.sources=actual.version.content.sources;for(const block of display.blocks)block.sourceIds=display.sources.map(s=>s.id);}
 await workflow.saveBusinessProfile(who,{assetId,expectedVersion:1,profile:fixture.profile});
 await library.confirmAssets(who,{action:'confirm',items:[{assetId,expectedVersion:2}],acknowledgePartial:true});return assetId;
}
const staticPart=(templateId,assetIds)=>({mode:assetIds.length===1?'static':'semi-dynamic',templateId,assetIds,length:'detailed',allowFallback:false,variant:'standard'});
const command=parts=>({action:'generate',projectId:randomUUID(),title:'隔离企业业务提案 · 非真实案例',scope,language:'zh',themeId:'colliers-default-v1',themeVersion:2,parts});
let mixed,exported,dynamicProject,visualProject;
try {
 await db.setup.query('update private.pitch_control set enabled=true');for(const user of [OWNER,OTHER,ADMIN,VIEWER])await db.grant(user,'test-region',{maintainer:user===OWNER||user===ADMIN});
 category=(await db.rpc(OWNER,{action:'catalog'})).categories.find(c=>c.system_code==='general').id;
 await check('real profiles use immutable asset versions, review and extensible business recipes',async()=>{for(const kind of ['corporate','team','case','research','custom'])ids[kind]=await asset(kind);ids.team2=await asset('team',2);ids.case2=await asset('case',2);const c=await db.rpc(OTHER,{action:'business_catalog'});assert.equal(c.recipes.length,95);const search=await db.rpc(OTHER,{action:'business_search',kind:'case',q:'匿名'});assert.equal(search.length,2);assert.doesNotMatch(JSON.stringify(search),new RegExp(PRIVATE_CLIENT));assert.equal((await db.rpc(OWNER,{action:'business_profile',assetId:ids.corporate})).asset.current_version,3);assert.equal((await db.asUser(OTHER,'select * from pitch_business_profiles')).rowCount,0);await assert.rejects(db.rpc(OTHER,{action:'business_profile',assetId:ids.case}),e=>e.code==='42501');});
 await check('company, team, case portfolio, research and custom content form one actual editable PPTX',async()=>{
   mixed=command([staticPart('corporate-overview',[ids.corporate]),staticPart('corporate-metrics',[ids.corporate]),staticPart('team-multiple',[ids.team,ids.team2]),staticPart('case-portfolio',[ids.case,ids.case2]),staticPart('research-page',[ids.research]),staticPart('custom-content',[ids.custom])]);
   const result=await workflow.generateBusinessProject(ordinary,mixed);assert.ok(result.pages>=8);const project=await db.rpc(OTHER,{action:'get_project',projectId:mixed.projectId});assert.ok(project.slides.some(s=>s.scene.elements.some(e=>e.kind==='chart')));assert.doesNotMatch(JSON.stringify(project),new RegExp(PRIVATE_CLIENT));
   exported={action:'export_start',projectId:mixed.projectId,exportId:randomUUID(),audience:'internal',format:'pptx'};await render.prepareRenderExport(ordinary,exported);await render.runRenderExport(ordinary,exported);const file=await render.downloadArtifact(ordinary,exported);const zip=await JSZip.loadAsync(file.bytes);assert.ok(zip.file('ppt/charts/chart1.xml'));const all=await Promise.all(Object.values(zip.files).filter(f=>!f.dir&&f.name.endsWith('.xml')).map(f=>f.async('string')));assert.doesNotMatch(all.join('\n'),new RegExp(PRIVATE_CLIENT));for(const embedded of Object.values(zip.files).filter(f=>f.name.endsWith('.xlsx'))){const workbook=await JSZip.loadAsync(await embedded.async('uint8array'));for(const xml of Object.values(workbook.files).filter(f=>!f.dir&&f.name.endsWith('.xml')))assert.doesNotMatch(await xml.async('string'),new RegExp(PRIVATE_CLIENT));}assert.match(all.join('\n'),/测试成员/);assert.ok(zip.file('ppt/slides/slide1.xml'));await mkdir('tmp/pitch-business-fixtures',{recursive:true});await writeFile('tmp/pitch-business-fixtures/隔离企业资产_混合提案.pptx',file.bytes);
 });
 await check('confirmed proposals reject parent changes at commit and replay an already saved receipt',async()=>{
   const parts=[staticPart('corporate-overview',[ids.corporate])];
   const parent=command(parts);
   await workflow.generateBusinessProject(ordinary,parent);
   const parentRevision=async()=> (await db.setup.query('select version from pitch_projects where id=$1',[parent.projectId])).rows[0].version;
   const updateParent=async()=> db.setup.query('update pitch_projects set version=version+1 where id=$1',[parent.projectId]);
   const child={...command(parts),parentProjectId:parent.projectId,expectedParentVersion:await parentRevision()};
   const stale=await workflow.prepareBusinessProject(ordinary,child);
   await updateParent();
   await assert.rejects(db.rpc(OTHER,stale.input),e=>e.code==='23505'&&e.message.includes('PITCH_CONFLICT'));
   assert.equal((await db.setup.query('select id from pitch_projects where id=$1',[child.projectId])).rowCount,0);
   const current=await workflow.prepareBusinessProject(ordinary,{...child,expectedParentVersion:await parentRevision()});
   await assert.rejects(db.rpc(OWNER,current.input),e=>e.code==='42501');
   assert.equal((await db.rpc(OTHER,current.input)).projectId,child.projectId);
   await updateParent();
   assert.equal((await db.rpc(OTHER,current.input)).replayed,true);
 });
 await check('a pinned photo reused by multiple pages is downloaded once during actual generation', async () => {
   const { createSample } = require('../../../src/lib/pitch/data/workflow.ts');
   const sample = await createSample(owner, randomUUID(), scope);
   const { media: [photo] } = await db.rpc(OWNER, { action: 'get_asset', assetId: sample.assetId });
   const team = await asset('team', 9);
   const current = await db.rpc(OWNER, { action: 'business_profile', assetId: team });
   await workflow.saveBusinessProfile(owner, { assetId: team, expectedVersion: current.asset.current_version,
     profile: { ...current.profile, photo: { id: photo.id, version: photo.version } } });
   await library.confirmAssets(owner, { action: 'confirm', items: [{ assetId: team, expectedVersion: current.asset.current_version + 1 }],
     acknowledgePartial: true });

   const downloads = [];
   const context = { ...owner, client: { ...owner.client, storage: { from(bucket) {
     const storage = owner.client.storage.from(bucket);
     return { ...storage, async download(path) { downloads.push(path); return storage.download(path); } };
   } } } };
   const member = staticPart('team-single', [team]);
   const generation = command([{ ...member, title: '团队介绍' }, { ...member, title: '项目分工' }]);
   await workflow.generateBusinessProject(context, generation);
   const { slides } = await db.rpc(OWNER, { action: 'get_project', projectId: generation.projectId });
   assert.ok(slides.filter(page => page.scene.elements.some(element => element.kind === 'image' && element.mediaAssetId === photo.id)).length >= 2);
   assert.deepEqual(downloads, [photo.storage_path]);
 });
 await check('unpublished assets, wrong regions, languages and private customer display are rejected',async()=>{await assert.rejects(workflow.generateBusinessProject(ordinary,{...command([staticPart('corporate-overview',[ids.corporate])]),scope:{...scope,city:'unrelated'}}),/PITCH_BUSINESS_CONTENT/);await assert.rejects(workflow.generateBusinessProject(ordinary,{...command([staticPart('corporate-overview',[ids.corporate])]),language:'en'}),/PITCH_BUSINESS_CONTENT/);const current=await library.assetContext(owner,ids.case),p=(await db.rpc(OWNER,{action:'business_profile',assetId:ids.case})).profile;p.display.title=PRIVATE_CLIENT;await assert.rejects(workflow.saveBusinessProfile(owner,{assetId:ids.case,expectedVersion:3,profile:p}),/PITCH_BUSINESS_CONTENT/);const input=library.assetInput(current.asset,current.version.content);input.state='draft';await library.saveLibraryAsset(owner,{action:'save_asset',assetId:ids.case,expectedVersion:3,asset:input,acknowledgePartial:true});await assert.rejects(render.downloadArtifact(ordinary,exported),/PITCH_DENIED/);await library.confirmAssets(owner,{action:'confirm',items:[{assetId:ids.case,expectedVersion:4}],acknowledgePartial:true});});
 await check('all fifteen recipes execute their supported contracts and confirmed brief cases remain distinct',async()=>{
  const recipes=(await db.rpc(OWNER,{action:'business_catalog'})).recipes;const named=await asset('case',8);const n=(await db.rpc(OWNER,{action:'business_profile',assetId:named})).profile;n.disclosureMode='named';n.internalClientName=null;await workflow.saveBusinessProfile(owner,{assetId:named,expectedVersion:3,profile:n});await library.confirmAssets(owner,{action:'confirm',items:[{assetId:named,expectedVersion:4}],acknowledgePartial:true});
  for(const recipe of recipes.filter(r=>require('../../../src/lib/pitch/business/recipes.ts').LEGACY_BUSINESS_RECIPES.some(legacy=>legacy.id===r.id))){
   if(recipe.id==='case-public-projects'){await assert.rejects(workflow.generateBusinessProject(ordinary,command([staticPart(recipe.id,[ids.case])])),/PITCH_BUSINESS_CONTENT/);await workflow.generateBusinessProject(ordinary,command([staticPart(recipe.id,[named])]));continue;}
   const chosen=recipe.accepts[0],assetIds=recipe.maxAssets>1&&chosen==='team'?[ids.team,ids.team2]:[ids[chosen]];
   const r=await workflow.generateBusinessProject(ordinary,command([staticPart(recipe.id,assetIds)]));assert.ok(r.pages>=1,recipe.id);
  }
  const p=await library.assetContext(owner,ids.case),profile=(await db.rpc(OWNER,{action:'business_profile',assetId:ids.case})).profile;
  assert.notDeepEqual(profile.display.blocks,profile.briefDisplay.blocks);assert.equal(p.asset.state,'published');
 });
 await check('template descriptions, extension recipes and optimistic revisions are actually maintained',async()=>{const base=await db.rpc(ADMIN,{action:'business_recipe',templateId:'custom-content'}),recipe={...base,id:'synthetic-service-plan',revision:0,names:{zh:'隔离服务方案'},description:'仅用于测试扩展，不包含生产业务事实'};await assert.rejects(db.rpc(OTHER,{action:'business_recipe_save',recipe}),e=>e.code==='42501');await db.rpc(ADMIN,{action:'business_recipe_save',recipe});await assert.rejects(db.rpc(ADMIN,{action:'business_recipe_save',recipe}),e=>e.code==='23505');await workflow.generateBusinessProject(ordinary,command([staticPart(recipe.id,[ids.custom])]));});
 await check('real current authority and formal quarterly database feed the shared dynamic adapter',async()=>{
   await installPitchDataFixture(db);await db.setup.query('update private.ai_query_control set enabled=true');await grantQuery(db,ADMIN,{capabilities:['query:catalog','query:brochure','query:quarter','export:internal'],fields:['height','floors','parking','totalArea','vacantArea','netEffectiveRent']});
   dynamicProject=command([{mode:'dynamic',parameters:dynamicFixture}]);dynamicProject.parts[0].researchAssetId=ids.research;const generated=await workflow.generateBusinessProject(admin,dynamicProject);assert.ok(generated.pages>=2);const receipt=await db.rpc(ADMIN,{action:'business_generation',projectId:dynamicProject.projectId});assert.ok(receipt.bindings.some(b=>b.id===ids.research));assert.ok(receipt.snapshots[0].content.some(c=>c.blocks.some(b=>b.kind==='chart')&&c.blocks.some(b=>b.kind==='insight')));await db.setup.query('begin read only');try{await db.setup.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:ADMIN,session_id:sessionFor(ADMIN)})]);await db.setup.query('set local role authenticated');assert.equal((await db.setup.query('select * from pitch_business_generations where project_id=$1',[dynamicProject.projectId])).rowCount,0);}finally{await db.setup.query('rollback');}assert.equal(receipt.snapshots[0].results[0].operation,'trend');assert.equal(receipt.snapshots[0].dataAsOf,'2026-09-30');assert.equal(receipt.snapshots[0].parameters.period.quarter,3);assert.ok(receipt.snapshots[0].results[0].sources.every(s=>s.table==='building_metrics'||s.table==='buildings'));await assert.rejects(workflow.generateBusinessProject(ordinary,command([{mode:'dynamic',parameters:dynamicFixture}])),/QUERY_DENIED/);
 });
 await check('the reviewed generation transaction preserves a referenced catalog image through reopen and export preparation', async () => {
   const { getWorkspace, saveWorkspace } = require('../../../src/lib/pitch/workspace/workflow.ts');
   const { pinVisual } = require('../../../src/lib/pitch/visual-data/reference.ts');
   const { layoutSlides } = require('../../../src/lib/pitch/layout/engine.ts');
   const { STUDIO_THEME } = require('../../../src/lib/pitch/design/theme.ts');
   const parent = await getWorkspace(admin, dynamicProject.projectId);
   const receipt = await db.rpc(ADMIN, { action: 'business_generation', projectId: dynamicProject.projectId });
   const reference = pinVisual({ id: randomUUID(), kind: 'map', buildingIds: [BUILDINGS[0]],
     origin: { type: 'building-locations', buildingIds: [BUILDINGS[0]] }, contentHash: 'c'.repeat(64),
     disclosure: 'internal', dimensions: { width: 1600, height: 900 }, businessDate: null, sourceDateBasis: 'catalog-observed',
     rights: { scope: 'internal', holder: null, attribution: '隔离楼宇目录', licenseName: null, sourceUrl: null,
       licenseUrl: null, cropAllowed: false, clientDistribution: false, externalAi: false },
     source: { kind: 'record', label: '隔离目录', recordId: BUILDINGS[0], locator: '隔离区位图', dataAsOf: '2026-09-30' } }, 'isolated-map');
   const content = { protocol: 'colliers-pitch/1', locale: 'zh', title: '隔离区位图', disclosure: 'internal', isTestData: true,
     dataAsOf: reference.source.dataAsOf, sources: [reference.source], blocks: [
       { kind: 'image', mediaAssetId: reference.id, mediaVersion: reference.version, alt: '隔离点位', sourceIds: [reference.source.id] },
       { kind: 'paragraph', text: '隔离生成事务回归', sourceIds: [reference.source.id] },
     ] };
   const [scene] = await layoutSlides(content, STUDIO_THEME, 'hero-caption');
   const projectId = randomUUID(), assetId = randomUUID(), slideId = randomUUID();
   const commit = { action: 'business_generate_commit', projectId, parentProjectId: parent.project.id,
     expectedParentVersion: parent.project.version, title: '隔离提案', scope, themeId: STUDIO_THEME.id, themeVersion: STUDIO_THEME.version,
     requestKey: 'a'.repeat(64), reviewedPlanId: randomUUID(), proposalContext: { buildingIds: [BUILDINGS[0]], period: '2026-Q3' },
     snapshots: receipt.snapshots, bindings: [], recipes: [], changes: [],
     generated: [{ id: assetId, content, sha256: digest(Buffer.from(JSON.stringify(content))) }],
     slides: [{ slideId, assetId, assetVersion: 1, content, scene }] };
   const mismatched = structuredClone(commit);
   mismatched.projectId = randomUUID();
   mismatched.slides[0].content.blocks[0].sourceIds = [randomUUID()];
   await assert.rejects(db.rpc(ADMIN, mismatched), error => error.code === '42501');
   assert.equal((await db.rpc(ADMIN, commit)).projectId, projectId);
   let workspace = await getWorkspace(admin, projectId);
   assert.deepEqual(workspace.slides[0].content.sources[0].visual, reference.source.visual);
   assert.deepEqual(workspace.workspace.context.buildingIds, [BUILDINGS[0]]);
   assert.equal(workspace.workspace.active_slide, slideId);
   await assert.rejects(getWorkspace(ordinary, projectId), /PITCH_DENIED/);
   workspace = await saveWorkspace(admin, { action: 'save', projectId, expectedVersion: workspace.project.version,
     title: '已改名隔离提案', themeId: STUDIO_THEME.id, themeVersion: STUDIO_THEME.version, pages: [{ id: slideId }] });
   assert.deepEqual(workspace.slides[0].content.sources[0].visual, reference.source.visual);
   const exportId = randomUUID();
   await render.prepareRenderExport(admin, { action: 'export_start', projectId, exportId, audience: 'internal', format: 'pdf' });
   const stored = await db.setup.query('select visual_source_snapshot from pitch_exports where id=$1',[exportId]);
   assert.deepEqual(stored.rows[0].visual_source_snapshot, [reference.source]);
 });
 await check('matching chapter queries share one official snapshot without mixing research and plain text', async () => {
   let snapshotsRead = 0;
   const ctx = { ...admin, client: { ...admin.client, rpc(name, args) {
     if (name === 'ai_query_snapshot_read') snapshotsRead++;
     return admin.client.rpc(name, args);
   } } };
   const section = { mode: 'dynamic', parameters: dynamicFixture };
   const c = command([
     { ...section, title: '租金趋势事实' },
     { ...section, title: '同一趋势附录' },
     { ...section, title: '获准研究说明', researchAssetId: ids.research },
     { ...section, title: '不同统计范围', parameters: { ...dynamicFixture, buildingIds: [BUILDINGS[0]] } },
   ]);
   let checked;
   await workflow.generateBusinessProject(ctx, c, undefined, undefined, false, snapshots => {
     checked = snapshots;
   });
   assert.equal(snapshotsRead, 2);
   assert.equal(checked.length, 4);
   assert.equal(checked[0].results[0].resultId, checked[2].results[0].resultId);
   assert.notEqual(checked[0].results[0].resultId, checked[3].results[0].resultId);
   const receipt = await db.rpc(ADMIN, { action: 'business_generation', projectId: c.projectId });
   assert.equal(receipt.snapshots.length, 2);
   assert.equal(receipt.snapshots[0].results.length, 1);
   assert.equal(receipt.snapshots[0].content.length, checked[0].content.length + 1);
   const { slides } = await db.rpc(ADMIN, { action: 'get_project', projectId: c.projectId });
   const plain = slides.find(page => page.content.title === '租金趋势事实' && page.content.blocks.some(block => block.kind === 'chart'));
   const repeat = slides.find(page => page.content.title === '同一趋势附录' && page.content.blocks.some(block => block.kind === 'chart'));
   const research = slides.find(page => page.content.title === '获准研究说明' && page.content.blocks.some(block => block.kind === 'insight'));
   assert.deepEqual(plain.content.blocks, repeat.content.blocks);
   assert.ok(plain.content.blocks.every(block => block.kind !== 'insight'));
   const { readDocumentBindings } = require('../../../src/lib/pitch/workspace/documentBindings.ts');
   const bindings = await readDocumentBindings(ctx, c.projectId);
   const chartBinding = id => bindings.pages.find(page => page.id === id).objects.find(object => object.kind === 'chart');
   assert.equal(chartBinding(plain.id).valueOrigin, 'business');
   assert.deepEqual(chartBinding(plain.id).binding, chartBinding(research.id).binding);
   const [original, distinct] = receipt.snapshots;
   assert.equal(workflow.compareBusinessSnapshots({ snapshots: [original, original, distinct] }, receipt).changed, false);
 });
 await check('zero vacancy differs from missing/invalid data and comparison keeps the verified formula',async()=>{
   await db.setup.query('update building_metrics set vacant_area=0 where building_id=$1 and record_year=2026 and record_quarter=3',[BUILDINGS[0]]);
   const c=command([{mode:'dynamic',parameters:{...dynamicFixture,templateId:'vacancy-comparison',buildingIds:BUILDINGS,targetBuildingId:BUILDINGS[0],chart:'bar'}}]);await workflow.generateBusinessProject(admin,c);const receipt=await db.rpc(ADMIN,{action:'business_generation',projectId:c.projectId});const chart=receipt.snapshots[0].content[0].blocks[0];assert.equal(chart.kind,'chart');assert.ok(chart.series[0].values.includes(0));assert.equal(chart.series[0].values.filter(v=>v===null).length,2);assert.ok(chart.categories.some(s=>s.includes('目标')));assert.ok(receipt.snapshots[0].results[0].table.rows.find(r=>r.entityId===BUILDINGS[3]).cells.vacancyRatio.kind==='unknown');
 });
 await check('all available quarterly templates execute canonical plans rather than placeholder pages',async()=>{
  for(const templateId of ['building-profile','project-comparison','rent-comparison','vacancy-trend','building-submarket']){
   const parameters={...dynamicFixture,templateId,buildingIds:templateId==='building-profile'?[BUILDINGS[0]]:['vacancy-trend','building-submarket'].includes(templateId)?[]:BUILDINGS,targetBuildingId:BUILDINGS[0],chart:templateId==='rent-comparison'?'bar':'table'};
   const c=command([{mode:'dynamic',parameters}]);const generated=await workflow.generateBusinessProject(admin,c);assert.ok(generated.pages>0,templateId);const receipt=await db.rpc(ADMIN,{action:'business_generation',projectId:c.projectId});assert.ok(receipt.snapshots[0].results[0].sources.length,templateId);
  }
 });
 await check('authorized business generation commits, reopens and previews a real catalogue location image without duplicating its bytes',async()=>{
  await db.setup.query('alter table public.buildings add column if not exists location_lat double precision, add column if not exists location_lng double precision, add column if not exists city text');
  await db.setup.query('update public.buildings set location_lat=39.91, location_lng=116.45, city=$1 where id=$2',[scope.city,BUILDINGS[0]]);
  await db.setup.query('update public.buildings set location_lat=39.92, location_lng=116.47, city=$1 where id=$2',[scope.city,BUILDINGS[1]]);
  admin.client.from=table=>{
   assert.equal(table,'buildings');let ids;
   const query={select:()=>query,in(column,value){assert.equal(column,'id');ids=value;return query;},eq:()=>query,is:()=>query,or:()=>query,
    async abortSignal(){return {data:(await db.setup.query('select id,name,submarket,location_lat,location_lng,city from public.buildings where id=any($1::uuid[])',[ids])).rows,error:null};}};
   return query;
  };
  const parameters={...dynamicFixture,templateId:'competition-map',buildingIds:BUILDINGS.slice(0,2),targetBuildingId:BUILDINGS[0]};
  const input=command([{mode:'dynamic',parameters}]);
  visualProject=input.projectId;
  assert.equal((await db.rpc(ADMIN,{action:'workspace_capabilities'})).allowedDynamic.includes('competition-map'),true);
  assert.equal((await workflow.generateBusinessProject(admin,input)).pages,1);
  const reopened=await db.rpc(ADMIN,{action:'workspace_get',projectId:input.projectId});
  const visual=reopened.slides[0].content.sources[0].visual;
  assert.equal(visual.kind,'map');assert.deepEqual(visual.buildingIds,parameters.buildingIds);
  assert.equal(reopened.slides[0].content.blocks[0].mediaAssetId,visual.id);
  assert.equal((await db.setup.query('select count(*)::int n from pitch_media_assets where id=$1',[visual.id])).rows[0].n,0);
  assert.equal((await db.setup.query('select * from private.pitch_content_media($1)',[reopened.slides[0].content])).rowCount,0);
  const mismatched={...reopened.slides[0].content,sources:[{...reopened.slides[0].content.sources[0],sha256:'0'.repeat(64)}]};
  assert.deepEqual((await db.setup.query('select * from private.pitch_content_media($1)',[mismatched])).rows,[{id:visual.id,version:visual.version}]);
  assert.match((await render.previewPage(admin,{action:'preview',projectId:input.projectId,page:0})).svg,/data:image\/png;base64,/);
  {
   const exportCommand={action:'export_start',projectId:input.projectId,exportId:randomUUID(),audience:'internal',format:'pptx'};
   await render.prepareRenderExport(admin,exportCommand);
   await render.runRenderExport(admin,exportCommand);
   const exported=await render.downloadArtifact(admin,exportCommand);
   const zip=await JSZip.loadAsync(exported.bytes);
   const objects=Object.values(zip.files).filter(file=>file.name.startsWith('ppt/media/')&&!file.dir);
   assert.ok((await Promise.all(objects.map(async file=>digest(await file.async('uint8array'))))).includes(visual.contentHash));
   await db.setup.query('update public.buildings set location_lat=39.93 where id=$1',[BUILDINGS[0]]);
   await assert.rejects(render.downloadArtifact(admin,exportCommand),/PITCH_SOURCE_CHANGED/);
  }
  assert.equal((await db.rpc(OTHER,{action:'workspace_capabilities'})).allowedDynamic.includes('competition-map'),false);
  await assert.rejects(workflow.generateBusinessProject(ordinary,command([{mode:'dynamic',parameters}])),/QUERY_DENIED/);
  await assert.rejects(db.asUser(ADMIN,'select private.pitch_content_media($1)',
    [reopened.slides[0].content]),e=>e.code==='42501');
 });
 await check('refresh changes only the new snapshot, old pages are reproducible and historical restore is exact',async()=>{
   const before=await db.rpc(ADMIN,{action:'get_project',projectId:dynamicProject.projectId});await db.setup.query('update building_metrics set net_effective_rent=net_effective_rent+10 where record_year=2026 and record_quarter=3');
   const next={...dynamicProject,projectId:randomUUID(),parentProjectId:dynamicProject.projectId};await workflow.generateBusinessProject(admin,next);const old=await db.rpc(ADMIN,{action:'get_project',projectId:dynamicProject.projectId});assert.deepEqual(old.slides,before.slides);const a=await db.rpc(ADMIN,{action:'business_generation',projectId:old.project.id}),b=await db.rpc(ADMIN,{action:'business_generation',projectId:next.projectId});assert.equal(workflow.compareBusinessSnapshots(a,b).changed,true);const id=randomUUID();await workflow.restoreBusinessProject(admin,{projectId:id,sourceProjectId:dynamicProject.projectId,title:'隔离历史恢复'});const restored=await db.rpc(ADMIN,{action:'get_project',projectId:id});assert.deepEqual(restored.slides.map(s=>s.content),old.slides.map(s=>s.content));
 });
 await check('document refresh compares pinned data, rejects a stale review, saves one new revision, and restores the previous facts',async()=>{
   const workspace=require('../../../src/lib/pitch/workspace/workflow.ts');
   const bindings=require('../../../src/lib/pitch/workspace/documentBindings.ts');
   const part = { mode: 'dynamic', parameters: { ...dynamicFixture, templateId: 'building-profile',
     buildingIds: [BUILDINGS[0]], chart: 'table' } };
   const c=command([{ ...part, title: '楼宇快照' }, { ...part, title: '同一快照附录' }]);
   await workflow.generateBusinessProject(admin,c);
   const initial=await workspace.getWorkspace(admin,c.projectId);
   const custom=await workspace.customWorkspace(admin,{action:'custom',projectId:c.projectId,expectedVersion:initial.project.version,
     title:'人工说明',body:'此页由用户维护。'});
   const firstTable=custom.slides.find(s=>s.content.blocks.some(b=>b.kind==='table'));
   const appendix=custom.slides.find(s=>s.content.title==='同一快照附录' && s.content.blocks.some(b=>b.kind==='table'));
   const noted=await workspace.applyDocumentModification(admin,{action:'apply_modification',scope:'selected',
     plan:{id:randomUUID(),projectId:c.projectId,expectedVersion:custom.project.version,
       basePageVersions:[{id:firstTable.id,version:firstTable.version}],
       pages:[{id:firstTable.id,manualNote:'面积口径由团队复核。'}]}});
   const page=noted.slides.find(s=>s.id===firstTable.id);
   assert.match(page.content.subtitle,/人工说明：面积口径由团队复核/);
   assert.deepEqual(page.content.blocks,firstTable.content.blocks);
   assert.equal(page.content.disclosure,'internal');
   const unrelated=noted.slides.at(-1);
   const request={projectId:c.projectId,expectedVersion:noted.project.version,slideId:page.id};
   const pinned=await bindings.readDocumentBindings(admin,c.projectId);
   const table=pinned.pages.find(p=>p.id===page.id).objects.find(b=>b.kind==='table');
   assert.equal(table.valueOrigin,'business');
   assert.equal(pinned.pages.find(p=>p.id===page.id).manualNote,'面积口径由团队复核。');
   assert.deepEqual(table.query.buildingIds,[BUILDINGS[0]]);
   assert.equal(table.binding.dataAsOf,'2026-09-30');
   assert.equal(pinned.pages.find(p=>p.id===unrelated.id).objects[0].valueOrigin,'manual');
   assert.equal((await bindings.previewDataRefresh(admin,{...request,action:'preview_data_refresh'})).changed,false);
   await assert.rejects(bindings.readDocumentBindings(ordinary,c.projectId),/PITCH_DENIED/);
   const bump=()=>db.setup.query('update building_metrics set net_effective_rent=net_effective_rent+5 where building_id=$1 and record_year=2026 and record_quarter=3',[BUILDINGS[0]]);
   await bump();
   const first=await bindings.previewDataRefresh(admin,{...request,action:'preview_data_refresh'});
   assert.equal(first.changed,true);
   assert.equal(first.changes.find(change => change.slideId === appendix.id)?.changed, true);
   assert.notDeepEqual(first.changes[0].before.blocks,first.changes[0].after.blocks);
   assert.deepEqual((await workspace.getWorkspace(admin,c.projectId)).slides.find(p=>p.id===page.id).content,page.content);
   await bump();
   await assert.rejects(bindings.applyDataRefresh(admin,{...request,action:'apply_data_refresh',fingerprint:first.fingerprint}),/PITCH_DATA_REFRESH_CHANGED/);
   const fresh=await bindings.previewDataRefresh(admin,{...request,action:'preview_data_refresh'});
   const updated=await bindings.applyDataRefresh(admin,{...request,action:'apply_data_refresh',fingerprint:fresh.fingerprint});
   assert.equal(updated.project.version,noted.project.version+1);
   const newPage=updated.slides.find(p=>p.id===page.id);
   assert.notDeepEqual(newPage.content.blocks,page.content.blocks);
   assert.equal(newPage.scene.layoutId,page.scene.layoutId);
   assert.equal(newPage.content.subtitle,page.content.subtitle);
   assert.deepEqual(updated.slides.find(p=>p.id===appendix.id).content.blocks,newPage.content.blocks);
   assert.deepEqual(updated.slides.find(p=>p.id===unrelated.id).content,unrelated.content);
   const previous=await workspace.restoreWorkspace(admin,{action:'restore',projectId:c.projectId,
     expectedVersion:updated.project.version,revision:noted.project.version});
   assert.deepEqual(previous.slides.find(p=>p.id===page.id).content,page.content);
   const quarter={year:2026,quarter:2};
   const reperiod={projectId:c.projectId,expectedVersion:previous.project.version,slideId:page.id,period:quarter};
   const quarterReview=await bindings.previewDataRefresh(admin,{action:'preview_data_refresh',...reperiod});
   assert.deepEqual(quarterReview.period,quarter);
   const earlier=await bindings.applyDataRefresh(admin,{action:'apply_data_refresh',...reperiod,fingerprint:quarterReview.fingerprint});
   const earlierPage=earlier.slides.find(s=>s.id===page.id);
   assert.equal(earlierPage.content.dataAsOf,'2026-06-30');
   assert.match(earlierPage.content.subtitle,/面积口径由团队复核/);
 });
 await check('AI chart presentation changes retain bound values, refresh the series, and export the selected native chart',async()=>{
   const workspace=require('../../../src/lib/pitch/workspace/workflow.ts');
   const bindings=require('../../../src/lib/pitch/workspace/documentBindings.ts');
   const c=command([{mode:'dynamic',parameters:dynamicFixture}]);
   await workflow.generateBusinessProject(admin,c);
   const initial=await workspace.getWorkspace(admin,c.projectId);
   const page=initial.slides.find(s=>s.content.blocks.some(b=>b.kind==='chart'));
   const blockIndex=page.content.blocks.findIndex(block=>block.kind==='chart');
   const original=page.content.blocks[blockIndex];
   const update={action:'apply_modification',scope:'selected',plan:{id:randomUUID(),projectId:c.projectId,
     expectedVersion:initial.project.version,basePageVersions:[{id:page.id,version:page.version}],
     pages:[{id:page.id, chartPresentation:[{blockIndex,type:'column'}]}]}};
   const { workspaceCommandSchema }=require('../../../src/lib/pitch/workspace/protocol.ts');
   assert.equal(workspaceCommandSchema.safeParse({...update,plan:{...update.plan,
     pages:[{id:page.id, chartPresentation:[{blockIndex,type:'column',series:[0]}]}]}}).success,false);
   const changed=await workspace.applyDocumentModification(admin,workspaceCommandSchema.parse(update));
   const edited=changed.slides.find(s=>s.id===page.id);
   assert.deepEqual(edited.content.blocks[blockIndex],{...original,chartType:'column'});
   await db.setup.query('update building_metrics set net_effective_rent=net_effective_rent+3 where record_year=2026 and record_quarter=3');
   const refresh={projectId:c.projectId,expectedVersion:changed.project.version,slideId:page.id};
   const review=await bindings.previewDataRefresh(admin,{action:'preview_data_refresh',...refresh});
   const current=await bindings.applyDataRefresh(admin,{action:'apply_data_refresh',...refresh,fingerprint:review.fingerprint});
   const refreshed=current.slides.find(s=>s.id===page.id).content.blocks[blockIndex];
   assert.equal(refreshed.chartType,'column');
   assert.notDeepEqual(refreshed.series,original.series);
   const exp={action:'export_start',projectId:c.projectId,exportId:randomUUID(),audience:'internal',format:'pptx',
     page:current.slides.findIndex(slide=>slide.id===page.id)};
   await render.prepareRenderExport(admin,exp);
   await render.runRenderExport(admin,exp);
   const file=await render.downloadArtifact(admin,exp);
   const zip=await JSZip.loadAsync(file.bytes);
   assert.ok(current.slides.find(slide=>slide.id===page.id).scene.elements.some(element=>element.kind==='chart'));
   const chart=Object.values(zip.files).find(file=>/^ppt\/charts\/chart\d+\.xml$/.test(file.name));
   assert.ok(chart,'selected page contains a native Open XML chart');
   assert.match(await chart.async('string'),/barDir val="col"/);
 });
 await check('Add to Pitch validates formal project IDs and atomically creates and queues a private project',async()=>{
   const workspace=require('../../../src/lib/pitch/workspace/workflow.ts');
   const handoff=require('../../../src/lib/pitch/workspace/handoff.ts');
   const input={source:{kind:'buildings',buildingIds:[BUILDINGS[0]]},period:'2026-Q3'};
   assert.equal((await handoff.reviewHandoff(admin,{action:'review_handoff',handoff:{source:input.source}})).status,'period_required');
   await assert.rejects(handoff.reviewHandoff(ordinary,{action:'review_handoff',handoff:input}),/QUERY_DENIED/);
   const review=await handoff.reviewHandoff(admin,{action:'review_handoff',handoff:input});
   assert.equal(review.status,'ready');
   const c={action:'add_to_pitch',handoff:input,fingerprint:review.fingerprint,taskId:randomUUID(),
     target:{mode:'create',projectId:randomUUID(),title:'业务模块交接',scope,themeId:'colliers-default-v1',themeVersion:2}};
   await assert.rejects(handoff.startHandoff(admin,{...c,fingerprint:'0'.repeat(64)}),/PITCH_HANDOFF_CHANGED/);
   assert.equal((await db.setup.query('select 1 from pitch_projects where id=$1',[c.target.projectId])).rowCount,0);
   const queued=await handoff.startHandoff(admin,c);
   await workspace.runWorkspaceTask(admin,c.target.projectId,c.taskId);
   await db.setup.query('update building_metrics set net_effective_rent=net_effective_rent+1 where building_id=$1 and record_year=2026 and record_quarter=3',[BUILDINGS[0]]);
   assert.notEqual((await handoff.reviewHandoff(admin,{action:'review_handoff',handoff:input})).fingerprint,review.fingerprint);
   const complete=await handoff.startHandoff(admin,c);
   await assert.rejects(handoff.startHandoff(admin,{...c,target:{...c.target,title:'不同的项目'}}),/PITCH_CONFLICT/);
   assert.equal(complete.state,'completed');
   assert.equal(complete.source_project_id,queued.source_project_id);
   const opened=await workspace.getWorkspace(admin,c.target.projectId);
   assert.equal(opened.project.version,2);
   assert.ok(opened.slides.length>0);
   const generated=await db.rpc(ADMIN,{action:'business_generation',projectId:queued.source_project_id});
   assert.deepEqual(generated.snapshots[0].parameters.buildingIds,[BUILDINGS[0]]);
   const bindings=require('../../../src/lib/pitch/workspace/documentBindings.ts');
   const bound=await bindings.readDocumentBindings(admin,c.target.projectId);
   assert.ok(bound.pages.some(page=>page.objects.some(object=>object.valueOrigin==='business')));
   assert.deepEqual(opened.workspace.context.buildingIds,[BUILDINGS[0]]);
 });
 await check('dynamic snapshots cannot be client-exported or reused after independent data permission revocation',async()=>{
   const c={action:'export_start',projectId:dynamicProject.projectId,exportId:randomUUID(),audience:'internal',format:'pptx'};await render.prepareRenderExport(admin,c);await render.runRenderExport(admin,c);const file=await render.downloadArtifact(admin,c);await writeFile('tmp/pitch-business-fixtures/隔离正式数据_原生趋势.pptx',file.bytes);const zip=await JSZip.loadAsync(file.bytes);const chart=Object.values(zip.files).find(f=>/^ppt\/charts\/chart\d+\.xml$/.test(f.name));assert.ok(chart);assert.match(await chart.async('string'),/lineChart/);await assert.rejects(render.prepareRenderExport(admin,{...c,exportId:randomUUID(),audience:'client'}),/PITCH_DENIED/);
   const p=await db.rpc(ADMIN,{action:'get_project',projectId:dynamicProject.projectId});
   await assert.rejects(db.rpc(ADMIN,{action:'workspace_share_create',projectId:p.project.id,expectedVersion:p.project.version,
     shareId:randomUUID(),recipientId:OTHER}),error=>error.code==='42501');
   await db.setup.query('update private.ai_query_grants set enabled=false where user_id=$1',[ADMIN]);await assert.rejects(render.downloadArtifact(admin,c),/PITCH_DENIED/);assert.equal((await db.asUser(ADMIN,'select * from pitch_business_generations where project_id=$1',[dynamicProject.projectId])).rowCount,0);await assert.rejects(db.rpc(ADMIN,{action:'get_asset',assetId:p.slides[0].asset_id}),e=>e.code==='42501');
   await assert.rejects(render.previewPage(admin,{action:'preview',projectId:visualProject,page:0}),/QUERY_DENIED/);
 });
 await check('an unavailable data source and unauthorized history both fail without generated pages',async()=>{
  await assert.rejects(workflow.generateBusinessProject(admin,command([{mode:'dynamic',parameters:{...dynamicFixture,templateId:'lease-area-distribution'}}])),/PITCH_DATA_UNAVAILABLE/);
  const parameters={...dynamicFixture,templateId:'stacking-plan',buildingIds:[BUILDINGS[0]],targetBuildingId:BUILDINGS[0]};
  await assert.rejects(workflow.generateBusinessProject(ordinary,command([{mode:'dynamic',parameters}])),/QUERY_DENIED/);
 });
 await check('actual lease adapter requires independent grants, keeps protected customers out and denies old export after revocation',async()=>{
  const ddl=await readFile(new URL('../lease-expiry/fixture.sql',import.meta.url),'utf8');await db.setup.query(ddl.slice(ddl.indexOf('create table public.lease_transactions('),ddl.indexOf('create table public.lease_transactions_history(')));
  await db.setup.query('alter table public.lease_transactions alter column submitter_id type varchar using submitter_id::text');await installLeaseResearchFixture(db.setup);await seedLeaseResearch(db.setup,BUILDINGS);await grantQuery(db,ADMIN,{capabilities:['query:catalog','query:brochure','query:quarter','export:internal'],fields:['totalArea','vacantArea','netEffectiveRent']});
  const workspace=require('../../../src/lib/pitch/workspace/workflow.ts');
  const handoff=require('../../../src/lib/pitch/workspace/handoff.ts');
  const { workspaceCommandSchema }=require('../../../src/lib/pitch/workspace/protocol.ts');
  const leaseInput={source:{kind:'lease-search',dataset:'combined',from:dynamicFixture.from,to:dynamicFixture.to,
    buildingIds:[],submarkets:dynamicFixture.submarkets,view:'transactions'},language:'zh'};
  const leaseReviewCommand=workspaceCommandSchema.parse({action:'review_handoff',handoff:leaseInput});
  assert.equal(workspaceCommandSchema.safeParse({action:'review_handoff',handoff:{...leaseInput,
    source:{...leaseInput.source,to:'2020-01-01'}}}).success,false);
  assert.equal(workspaceCommandSchema.safeParse({action:'review_handoff',handoff:{...leaseInput,
    source:{...leaseInput.source,rows:[{area:123}]}}}).success,false);
  await assert.rejects(handoff.reviewHandoff(admin,leaseReviewCommand),/QUERY_DENIED/);
  const input=command([{mode:'dynamic',parameters:{...dynamicFixture,templateId:'lease-industry-distribution',chart:'bar',measure:'area'}}]);await assert.rejects(workflow.generateBusinessProject(admin,input),/QUERY_DENIED/);await grantLeaseResearch(db.setup,ADMIN);await workflow.generateBusinessProject(admin,input);const details=await workflow.generateBusinessProject(admin,command([{mode:'dynamic',parameters:{...dynamicFixture,templateId:'lease-representatives',chart:'table'}}]));assert.ok(details.pages);
  const receipt=await db.rpc(ADMIN,{action:'business_generation',projectId:input.projectId});assert.equal(receipt.snapshots[0].binding.domain,'lease');assert.ok(receipt.snapshots[0].content.some(c=>c.blocks.some(b=>b.kind==='chart')));assert.doesNotMatch(JSON.stringify(receipt),/合成保密客户/);
  const current=await workspace.getWorkspace(admin,input.projectId);
  const appendHandoff={...leaseReviewCommand.handoff,projectId:input.projectId};
  const preview=await handoff.reviewHandoff(admin,{action:'review_handoff',handoff:appendHandoff});
  assert.equal(preview.binding.domain,'lease');
  assert.equal(preview.period,'');
  assert.equal(preview.parameters.from,leaseInput.source.from);
  assert.deepEqual(preview.parameters.submarkets,leaseInput.source.submarkets);
  assert.doesNotMatch(JSON.stringify(preview.pages),/合成保密客户/);
  const append=workspaceCommandSchema.parse({action:'add_to_pitch',handoff:appendHandoff,taskId:randomUUID(),
    target:{mode:'append',expectedVersion:current.project.version},fingerprint:preview.fingerprint});
  const queued=await handoff.startHandoff(admin,append);
  await workspace.runWorkspaceTask(admin,input.projectId,append.taskId);
  const saved=await workspace.getWorkspace(admin,input.projectId);
  assert.equal(saved.project.version,current.project.version+1);
  assert.ok(saved.slides.length>current.slides.length);
  const appendedReceipt=await db.rpc(ADMIN,{action:'business_generation',projectId:queued.source_project_id});
  assert.equal(appendedReceipt.snapshots[0].binding.domain,'lease');
  assert.deepEqual(appendedReceipt.snapshots[0].plans[0].submarkets,leaseInput.source.submarkets);
  assert.doesNotMatch(JSON.stringify(appendedReceipt),/合成保密客户/);
  const exp={action:'export_start',projectId:input.projectId,exportId:randomUUID(),audience:'internal',format:'pptx'};await render.prepareRenderExport(admin,exp);await render.runRenderExport(admin,exp);assert.ok((await render.downloadArtifact(admin,exp)).bytes.length>1000);
  await db.setup.query('update private.ai_lease_research_grants set enabled=false where user_id=$1',[ADMIN]);await assert.rejects(render.downloadArtifact(admin,exp),/PITCH_DENIED/);
  await assert.rejects(handoff.startHandoff(admin,append),/PITCH_DENIED/);
 });
 await check('a separately confirmed English asset renders using the same business templates',async()=>{
  const id=await asset('corporate',9,owner,'en');const input={...command([staticPart('corporate-overview',[id])]),language:'en'};const r=await workflow.generateBusinessProject(ordinary,input);assert.ok(r.pages);const p=await db.rpc(OTHER,{action:'get_project',projectId:input.projectId});assert.equal(p.slides[0].content.locale,'en');
 });
 await check('published research receipts still require the original independent export grant and revision', async () => {
   const migration = await readFile(new URL('../../migrations/20261121142158_ai_business_research.sql', import.meta.url), 'utf8');
   const grantTable = migration.slice(migration.indexOf('create table private.ai_business_research_grants'), migration.indexOf('-- Fixed evidence envelope'));
   assert.ok(grantTable.includes('ai_business_research_changes'));
   await db.setup.query(grantTable);
   await db.setup.query(`insert into private.ai_business_research_grants(user_id, enabled, valid_until, modules, allow_export, change_reference)
     values($1,true,now()+interval '1 day',array['submarket'],true,'isolated proposal test')`, [ADMIN]);
   const { rows: [{ revision }] } = await db.setup.query(`select encode(sha256(convert_to(jsonb_build_array(
     public.ai_query_authority($1,$1,$2)->>'permission_revision',to_jsonb(g))::text,'UTF8')),'hex') revision
     from private.ai_business_research_grants g where g.user_id=$1`, [ADMIN,sessionFor(ADMIN)]);
   const source = { domain: 'business', permissionRevision: revision, policyVersion: 'business-research/1' };
   const allowed = async binding => (await db.setup.query('select private.pitch_business_data_allowed($1,$2,$3::jsonb) allowed',
     [ADMIN,sessionFor(ADMIN),JSON.stringify([{ binding }])])).rows[0].allowed;
   assert.equal(await allowed(source), true);
   assert.equal(await allowed({ ...source, permissionRevision: 'different' }), false);
   await db.setup.query('update private.ai_business_research_grants set allow_export=false where user_id=$1',[ADMIN]);
   assert.equal(await allowed(source), false);
 });
 console.log(`PASS ${count} business asset/template/real quarterly PostgreSQL closure groups; isolated synthetic data only`);
}finally{await db.close();}
