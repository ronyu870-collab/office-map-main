import './load-app.cjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createPitchDatabase, OWNER, OTHER, ADMIN, VIEWER, sessionFor } from './database.mjs';
const require=createRequire(import.meta.url);
const {DEFAULT_THEME}=require('../../../src/lib/pitch/design/theme.ts');
const {composeProject,previewPage,prepareRenderExport,runRenderExport,downloadArtifact}=require('../../../src/lib/pitch/data/renderWorkflow.ts');
const {legacyLayoutIds}=require('../../../src/lib/pitch/contracts/scene.ts');
const LAYOUTS=legacyLayoutIds.map(id=>({id}));
const {STUDIO_THEME,VERIFICATION_THEME,PRESENTATION_THEME_CANDIDATES}=require('../../../src/lib/pitch/design/theme.ts');
const {STUDIO_TEMPLATE}=require('../../../src/lib/pitch/templates/registry.ts');
const {BASIC_TEMPLATE}=require('../../../src/lib/pitch/templates/registry.ts');
const {createSample,createProject,exportProject,downloadExport,upgradeProjectTheme}=require('../../../src/lib/pitch/data/workflow.ts');
const db=await createPitchDatabase();
let count=0;
const check=async(name,fn)=>{await fn();count++;console.log('PASS '+name);};
const scope={organizationId:'synthetic-org',region:'test-region',city:'test-city',businessLine:'test-line'};
const files=new Map();let failUpload=false;let revokeOnRead=false;
// The exact application Supabase port is backed by real PG transactions. Storage
// is an isolated immutable byte store, never a production bucket or network URL.
function ctx(uid) {
 const client={rpc(name,args){assert.equal(name,'pitch_studio_access');return {async abortSignal(){try{return {data:await db.rpc(args.p_actor,args.p_input),error:null};}catch(e){return {data:null,error:{code:e.code,message:e.message}};}}};},
  storage:{from(bucket){assert.equal(bucket,'pitch-studio-private');return {
    async upload(path,bytes){if(failUpload)return {error:{message:'injected outage'}};if(files.has(path))return {error:{message:'exists'}};files.set(path,new Uint8Array(bytes));return {error:null};},
    async download(path){const bytes=files.get(path);if(revokeOnRead){revokeOnRead=false;await db.setup.query('update private.pitch_grants set enabled=false where user_id=$1',[uid]);}return {data:bytes?new Blob([bytes]):null,error:bytes?null:{message:'not found'}};}
  };}}};
 return {client,identity:{actorId:uid,effectiveUserId:uid,sessionId:sessionFor(uid),expiresAt:Date.now()+600000},signal:new AbortController().signal};
}
const owner=ctx(OWNER);let assetId,projectId,artifact;
try {
 await check('migration has RLS and explicit no direct writes on all 25 exposed tables',async()=>{
  const rows=(await db.setup.query("select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname like 'pitch_%' and relkind='r'")).rows;
  assert.equal(rows.length,25);assert.ok(rows.every(r=>r.relrowsecurity));
  for(const r of rows)assert.equal((await db.setup.query("select has_table_privilege('authenticated',$1,'INSERT') allowed",[r.relname])).rows[0].allowed,false);
 });
 await check('disabled pilot and ungranted accounts fail closed',async()=>{
  await assert.rejects(db.rpc(OWNER,{action:'catalog'}),e=>e.code==='42501');
  await db.setup.query('update private.pitch_control set enabled=true');
  await assert.rejects(db.rpc(OWNER,{action:'catalog'}),e=>e.code==='42501');
  assert.equal((await db.asUser(OWNER,'select * from pitch_templates')).rowCount,0);
 });
 await db.grant(OWNER);await db.grant(OTHER,'other-region');await db.grant(ADMIN,'test-region',{maintainer:true,client:true,ai:true});await db.grant(VIEWER);
 await check('registered theme/template match reviewed TypeScript protocol',async()=>{
  const reg=await db.rpc(OWNER,{action:'registry',templateId:BASIC_TEMPLATE.id,templateVersion:1,themeId:DEFAULT_THEME.id,themeVersion:1});
  assert.deepEqual(reg.template.config,BASIC_TEMPLATE);assert.deepEqual(reg.theme.definition,DEFAULT_THEME);
 });
 await check('six design candidates are visible to Pitch users, retrievable by version and match the provisional code definitions', async () => {
  const catalog = await db.rpc(OWNER, {action:'catalog'});
  for (const theme of PRESENTATION_THEME_CANDIDATES) {
   assert.ok(catalog.themes.some(entry => entry.id === theme.id && entry.current_version === theme.version));
   const result = await db.rpc(OWNER, {action:'registry', templateId:STUDIO_TEMPLATE.id, templateVersion:1, themeId:theme.id, themeVersion:theme.version});
   assert.deepEqual(result.theme.definition, theme);
   assert.equal(result.theme.definition.approval, 'provisional');
  }
 });
 await check('sample original/media/content/source references persist; retry is idempotent',async()=>{
  const request=randomUUID();assetId=(await createSample(owner,request,scope)).assetId;
  assert.equal((await createSample(owner,request,scope)).assetId,assetId);assert.equal(files.size,2);
  assert.equal((await db.setup.query('select count(*)::int n from pitch_source_references')).rows[0].n,1);
  assert.equal((await db.asUser(OWNER,'select * from pitch_asset_versions where asset_id=$1',[assetId])).rowCount,1);
 });
 await check('anonymous/raw authenticated RPC and raw private object storage access are denied',async()=>{
  await assert.rejects(db.asUser(OWNER,'select public.pitch_studio_access($1,$2,$3)',[OWNER,sessionFor(OWNER),{action:'catalog'}]),e=>e.code==='42501');
  await db.setup.query('set role anon');try {await assert.rejects(db.setup.query('select * from pitch_content_assets'),e=>e.code==='42501');}finally{await db.setup.query('reset role');}
  await db.setup.query("insert into storage.objects(bucket_id,name) values('pitch-studio-private','synthetic')");
  assert.equal((await db.asUser(OWNER,'select * from storage.objects')).rowCount,0);
 });
 await check('cross-user, cross-region, viewer writes and forged scope are refused',async()=>{
  assert.equal((await db.asUser(OTHER,'select * from pitch_content_assets')).rowCount,0);
  await assert.rejects(db.rpc(OTHER,{action:'get_asset',assetId}),e=>e.code==='42501');
  await assert.rejects(createSample(ctx(VIEWER),randomUUID(),scope),/PITCH_DENIED/);
  await assert.rejects(createSample(owner,randomUUID(),{...scope,region:'other-region'}),/PITCH_DENIED/);
 });
 await check('schema rejects executable configuration and invalid template parameters',async()=>{
  const {templateConfigSchema,templateParametersSchema}=require('../../../src/lib/pitch/templates/registry.ts');
  assert.equal(templateConfigSchema.safeParse({...BASIC_TEMPLATE,adapter:'eval',code:'process.exit()'}).success,false);
  assert.equal(templateParametersSchema.safeParse({language:'zh',code:'SQL'}).success,false);
 });
 await check('create standard page snapshots preserves source/theme versions and reopens project',async()=>{
  projectId=randomUUID();const input={action:'project_create',projectId,assetId,title:'Synthetic Pitch only',templateId:BASIC_TEMPLATE.id,templateVersion:1,themeId:DEFAULT_THEME.id,themeVersion:1,parameters:{language:'zh'}};
  await createProject(owner,input);await createProject(owner,input);
  const reopened=await db.rpc(OWNER,{action:'get_project',projectId});assert.equal(reopened.slides.length,1);
  assert.equal(reopened.slides[0].theme_version,1);assert.equal(reopened.slides[0].source_snapshot[0].kind,'synthetic');
  assert.equal((await db.rpc(OWNER,{action:'list_projects'})).length,1);
  assert.equal((await db.asUser(OTHER,'select * from pitch_projects')).rowCount,0);
  await assert.rejects(db.rpc(OTHER,{action:'get_project',projectId}),e=>e.code==='42501');
 });
 await check('real editable single-page PPTX exports to private storage and downloads by digest',async()=>{
  artifact=await exportProject(owner,projectId,'internal');const bytes=await downloadExport(owner,artifact);
  const JSZip=require('jszip');const zip=await JSZip.loadAsync(bytes);
  assert.equal(Object.keys(zip.files).filter(p=>/^ppt\/slides\/slide\d+\.xml$/.test(p)).length,1);
  const slide=await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(slide,/测试办公空间/);assert.match(slide,/测试数据/);assert.match(slide,/<a:t>/);assert.match(slide,/<p:pic>/);
  assert.ok(Object.keys(zip.files).some(p=>p.startsWith('ppt/media/')));
  assert.match(await zip.file('ppt/presentation.xml').async('string'),/cx="12192000" cy="6858000"/);
  assert.ok(!Object.keys(zip.files).some(p=>!zip.files[p].dir && /vbaProject|embeddings/i.test(p)));
  for(const name of Object.keys(zip.files).filter(p=>p.endsWith('.rels')))assert.doesNotMatch(await zip.file(name).async('string'),/TargetMode="External"/);
  const stored=(await db.setup.query('select * from pitch_exports where id=$1',[artifact.exportId])).rows[0];assert.equal(stored.state,'ready');assert.equal(stored.sha256,artifact.sha256);
 });
 await check('theme upgrade keeps original project, slide content, asset and theme version reproducible',async()=>{
  const theme={...DEFAULT_THEME,version:3,colors:{...DEFAULT_THEME.colors,background:'F1F2F3'}};
  await db.setup.query('insert into pitch_theme_versions(theme_id,version,definition,sha256) values($1,3,$2,$3)',[DEFAULT_THEME.id,theme,'a'.repeat(64)]);
  await db.setup.query('update pitch_design_themes set current_version=3 where id=$1',[DEFAULT_THEME.id]);
  const next=randomUUID();const command={action:'project_theme_upgrade',sourceProjectId:projectId,projectId:next,expectedVersion:1,themeId:DEFAULT_THEME.id,themeVersion:3};
  await upgradeProjectTheme(owner,command);await upgradeProjectTheme(owner,command);
  const original=await db.rpc(OWNER,{action:'get_project',projectId}),upgraded=await db.rpc(OWNER,{action:'get_project',projectId:next});
  assert.equal(original.slides[0].theme_version,1);assert.equal(upgraded.slides[0].theme_version,3);
  assert.equal(upgraded.project.parent_project_id,projectId);assert.equal(upgraded.slides[0].version,2);
  assert.deepEqual(upgraded.slides[0].content,original.slides[0].content);assert.equal(upgraded.slides[0].asset_version,original.slides[0].asset_version);
  await exportProject(owner,next,'internal');
 });
 await check('client export and external AI require distinct explicit asset and account grants',async()=>{
  await assert.rejects(exportProject(owner,projectId,'client'),/PITCH_DENIED/);
  assert.equal((await db.setup.query("select private.pitch_asset_visible($1,$2,$3,'ai') allowed",[OWNER,sessionFor(OWNER),assetId])).rows[0].allowed,false);
 });
 await check('storage corruption fails digest verification and upload outage keeps failed job visible',async()=>{
  const file=(await db.setup.query('select storage_path from pitch_exports where id=$1',[artifact.exportId])).rows[0].storage_path;
  const original=files.get(file);files.set(file,new Uint8Array(original.length));await assert.rejects(downloadExport(owner,artifact),/PITCH_SOURCE_CHANGED/);files.set(file,original);
  failUpload=true;await assert.rejects(exportProject(owner,projectId,'internal'),/PITCH_STORAGE_UNAVAILABLE/);failUpload=false;
  assert.equal((await db.setup.query("select count(*)::int n from pitch_jobs where state='failed'")).rows[0].n,1);
 });
 await check('revocation between storage read and download prevents delivery immediately',async()=>{
  revokeOnRead=true;await assert.rejects(downloadExport(owner,artifact),/PITCH_DENIED/);
  assert.equal((await db.asUser(OWNER,'select * from pitch_projects')).rowCount,0);
  await db.setup.query('update private.pitch_grants set enabled=true where user_id=$1',[OWNER]);
 });
 await check('role downgrade, session expiry, deleted account and expired grants each deny mutation',async()=>{
  for(const [change,restore] of [
    ["update user_roles set role='viewer' where user_id=$1","update user_roles set role='editor' where user_id=$1"],
    ["update auth.sessions set not_after=now()-interval '1 second' where user_id=$1","update auth.sessions set not_after=now()+interval '1 day' where user_id=$1"],
    ["update auth.users set deleted_at=now() where id=$1","update auth.users set deleted_at=null where id=$1"],
    ["update private.pitch_grants set valid_until=now()-interval '1 second' where user_id=$1","update private.pitch_grants set valid_until=now()+interval '1 day' where user_id=$1"]]){
      await db.setup.query(change,[OWNER]);await assert.rejects(exportProject(owner,projectId,'internal'),/PITCH_DENIED/);await db.setup.query(restore,[OWNER]);
    }
 });
 await check('admin categories maintain stable code, optimistic revision and forbid self-granted scope',async()=>{
  const id=randomUUID(),input={action:'category_save',id,expectedRevision:0,systemCode:'synthetic-category',names:{zh:'测试分类'},enabled:true};
  await assert.rejects(db.rpc(OWNER,input),e=>e.code==='42501');await db.rpc(ADMIN,input);
  await db.rpc(ADMIN,{...input,expectedRevision:1,names:{zh:'测试分类修订'}});
  await assert.rejects(db.rpc(ADMIN,{...input,expectedRevision:1}),e=>e.code==='23505');
  await assert.rejects(db.rpc(ADMIN,{...input,expectedRevision:2,systemCode:'changed'}),/PITCH_INVALID/);
  await assert.rejects(db.asUser(ADMIN,"update private.pitch_grants set can_client_export=true"),e=>e.code==='42501');
 });
 await check('published assets respect region, old private versions remain private, updates use optimistic versions',async()=>{
  await db.setup.query('update private.pitch_grants set maintainer=true where user_id=$1',[OWNER]);
  const before=await db.rpc(OWNER,{action:'get_asset',assetId});
  const asset={scope,categoryId:before.asset.category_id,tags:['synthetic'],names:{zh:'测试已发布素材'},content:before.version.content,state:'published',visibility:'organization',allowInternalGeneration:true,allowClientExport:false,allowExternalAi:false,validFrom:null,validUntil:null};
  const save={action:'asset_save',assetId,expectedVersion:1,asset,sha256:'b'.repeat(64)};
  await assert.rejects(db.rpc(OWNER,save),/PITCH_INVALID/);
  await db.setup.query("update pitch_source_documents set state='published',visibility='organization';update pitch_media_assets set state='published'");
  assert.equal((await db.rpc(OWNER,save)).version,2);
  await assert.rejects(db.rpc(OWNER,save),e=>e.code==='23505');
  assert.equal((await db.asUser(OTHER,'select * from pitch_content_assets')).rowCount,0);
  await db.grant(OTHER);
  assert.equal((await db.asUser(OTHER,'select * from pitch_content_assets')).rowCount,1);
  assert.deepEqual((await db.asUser(OTHER,'select version from pitch_asset_versions')).rows.map(x=>x.version),[2]);
  const historical=await db.rpc(OWNER,{action:'get_project',projectId});assert.equal(historical.slides[0].asset_version,1);
  await db.setup.query("update pitch_content_assets set state='archived' where id=$1",[assetId]);
  await assert.rejects(downloadExport(owner,artifact),/PITCH_DENIED/);
  await db.setup.query("update pitch_content_assets set state='published' where id=$1",[assetId]);
  // Reading and internal generation never imply external-model approval.
  assert.equal((await db.setup.query("select private.pitch_version_visible($1,$2,$3,2,'ai') allowed",[OTHER,sessionFor(OTHER),assetId])).rows[0].allowed,false);
 });
 await check('audit failure rolls back business writes; no ready result can bypass audit',async()=>{
  await db.setup.query("create function private.pitch_fail_test() returns trigger language plpgsql as $$begin raise exception 'injected audit failure';end$$;create trigger pitch_fail_test before insert on private.pitch_events for each row execute function private.pitch_fail_test()");
  const id=randomUUID();await assert.rejects(db.rpc(ADMIN,{action:'category_save',id,expectedRevision:0,systemCode:'rollback-test',names:{zh:'测试回滚'},enabled:true}),/injected audit failure/);
  assert.equal((await db.setup.query('select * from pitch_asset_categories where id=$1',[id])).rowCount,0);
  await db.setup.query('drop trigger pitch_fail_test on private.pitch_events');
 });
 let studioProject, studioParts, latest;
 await check('stage 2 registry pins reviewed theme, universal business adapter and twelve distinct layout definitions',async()=>{
  const reg=await db.rpc(OWNER,{action:'registry',templateId:STUDIO_TEMPLATE.id,templateVersion:1,themeId:STUDIO_THEME.id,themeVersion:2});
  assert.deepEqual(reg.template.config,STUDIO_TEMPLATE);assert.deepEqual(reg.theme.definition,STUDIO_THEME);
  assert.equal((await db.setup.query("select count(*)::int n from pitch_layout_definitions where engine='pitch-layout/2' and id in ('cover','section-divider','image-text','two-columns','kpi','team-profile','case-study','data-table','chart-insight','comparison','map-analysis','strategy-framework')")).rows[0].n,12);
 });
 await check('twelve actual test assets compose into a persisted multi-page project with team media dependencies and deck numbering',async()=>{
  studioParts=[];
  for(const layout of LAYOUTS){const out=await createSample(owner,randomUUID(),scope,layout.id);studioParts.push({assetId:out.assetId,layoutId:layout.id,variant:'standard'});}
  studioProject=randomUUID(); const command={action:'project_compose',projectId:studioProject,title:'测试十二页 / Native renderer',parts:studioParts,themeId:STUDIO_THEME.id,themeVersion:2};
  assert.equal((await composeProject(owner,command)).pages,12);assert.equal((await composeProject(owner,command)).replayed,true);
  const opened=await db.rpc(OWNER,{action:'get_project',projectId:studioProject});assert.equal(opened.slides.length,12);
  assert.equal(opened.slides[11].scene.elements.find(e=>e.purpose==='footer').text,'12');
  const team=await db.rpc(OWNER,{action:'get_asset',assetId:studioParts[5].assetId});assert.equal(team.media.length,1);
  await assert.rejects(composeProject(ctx(OTHER),{...command,projectId:randomUUID()}),/PITCH_DENIED/);
  await assert.rejects(exportProject(owner,studioProject,'internal'),/PITCH_ASYNC_REQUIRED/);
 });
 await check('actual preview is shared-scene SVG, parameters refresh one content group and theme substitution preserves saved data',async()=>{
  const before=(await db.rpc(OWNER,{action:'get_project',projectId:studioProject})).slides[8];
  const preview=await previewPage(owner,{action:'preview',projectId:studioProject,page:8,layoutId:'chart-insight',variant:'alternate',themeId:VERIFICATION_THEME.id,themeVersion:1});
  assert.equal(preview.scene.elements.find(e=>e.kind==='text'&&e.purpose==='footer').text,'9');
  const unchanged=await previewPage(owner,{action:'preview',projectId:studioProject,page:9,layoutId:'comparison',variant:'standard',themeId:STUDIO_THEME.id,themeVersion:STUDIO_THEME.version});
  assert.equal(unchanged.scene.elements.find(e=>e.kind==='text'&&e.purpose==='footer').text,'10');
  assert.match(preview.svg,/<svg/);assert.equal(preview.scene.themeId,VERIFICATION_THEME.id);assert.ok(preview.scene.elements.some(e=>e.kind==='chart'));
  const after=(await db.rpc(OWNER,{action:'get_project',projectId:studioProject})).slides[8];assert.deepEqual(after,before);
  await assert.rejects(previewPage(ctx(OTHER),{action:'preview',projectId:studioProject,page:0}),/PITCH_DENIED/);
  await assert.rejects(previewPage(owner,{action:'preview',projectId:studioProject,page:0,layoutId:'kpi'}),/PITCH_UNSUPPORTED_CONTENT/);
 });
 await check('premium candidate renders through compose, persisted Scene readback, preview and downloaded native PPTX', async () => {
  const theme = PRESENTATION_THEME_CANDIDATES[0], projectId = randomUUID(), exportId = randomUUID();
  const command = {action:'project_compose', projectId, title:'候选主题测试', parts:[studioParts[0], studioParts[8]], themeId:theme.id, themeVersion:theme.version};
  assert.equal((await composeProject(owner, command)).pages, 2);
  const opened = await db.rpc(OWNER, {action:'get_project', projectId});
  assert.equal(opened.slides[0].scene.designVersion, 1);
  assert.equal(opened.slides[1].scene.elements.find(element => element.purpose === 'footer').text, '2');
  const preview = await previewPage(owner, {action:'preview', projectId, page:0});
  assert.ok(preview.scene.elements.some(element => element.semantic === 'cover'));
  assert.match(preview.svg, /role="img"/);
  const request = {action:'export_start', projectId, exportId, audience:'internal', format:'pptx'};
  await prepareRenderExport(owner, request);
  await runRenderExport(owner, request);
  const artifact = await downloadArtifact(owner, request);
  assert.deepEqual([...artifact.bytes.subarray(0, 4)], [80, 75, 3, 4]);
 });
 for(const format of ['pptx','png','svg','xlsx']) await check(`durable ${format} task claims once, records progress, archives and rechecks actual download`,async()=>{
  const command={action:'export_start',projectId:studioProject,exportId:randomUUID(),audience:'internal',format,...(format==='pptx'?{}:{page:7})};
  await prepareRenderExport(owner,command);await runRenderExport(owner,command);await runRenderExport(owner,command);
  const state=await db.rpc(OWNER,{action:'export_status',projectId:studioProject,exportId:command.exportId});assert.equal(state.state,'ready');assert.equal(state.progress,100);assert.match(state.filename,new RegExp('[.]'+format+'$'));
  const file=await downloadArtifact(owner,command);assert.ok(file.bytes.length>100);assert.match(file.mime,format==='svg'?/svg/:format==='png'?/png/:/openxmlformats/);
  if(format==='pptx'){const zip=await (await import('jszip')).default.loadAsync(file.bytes);assert.equal(Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+[.]xml$/.test(n)).length,12);latest=command;}
  if(format==='xlsx'){const XLSX=await import('xlsx');const book=XLSX.read(file.bytes,{type:'array'});assert.equal(book.SheetNames.length,1);}
 });
 await check('revoked authority blocks queued task, preview, status and previously archived file; expiry becomes explicit failed receipt',async()=>{
  const command={action:'export_start',projectId:studioProject,exportId:randomUUID(),audience:'internal',format:'pdf'};await prepareRenderExport(owner,command);
  assert.equal((await db.rpc(OWNER,{action:'export_status',projectId:studioProject,exportId:command.exportId})).state,'pending');
  await db.setup.query('update private.pitch_grants set enabled=false where user_id=$1',[OWNER]);
  await runRenderExport(owner,command);await assert.rejects(previewPage(owner,{action:'preview',projectId:studioProject,page:0}),/PITCH_DENIED/);await assert.rejects(downloadArtifact(owner,latest),/PITCH_DENIED/);
  await assert.rejects(db.rpc(OWNER,{action:'export_status',projectId:studioProject,exportId:command.exportId}),e=>e.code==='42501');
  await db.setup.query('update private.pitch_grants set enabled=true where user_id=$1',[OWNER]);
  await db.setup.query("update pitch_jobs set lease_until=now()-interval '1 second' where id=$1",[command.exportId]);
  const state=await db.rpc(OWNER,{action:'export_status',projectId:studioProject,exportId:command.exportId});assert.equal(state.state,'failed');assert.equal(state.error_code,'PITCH_WORKER_TIMEOUT');
 });
 await check('revoked team photo source prevents preview and all export formats',async()=>{
  const row=await db.rpc(OWNER,{action:'get_asset',assetId:studioParts[5].assetId}),mid=row.media[0].id;
  await db.setup.query("update pitch_media_assets set state='archived' where id=$1",[mid]);
  await assert.rejects(previewPage(owner,{action:'preview',projectId:studioProject,page:5}),/PITCH_DENIED/);
  await assert.rejects(prepareRenderExport(owner,{action:'export_start',projectId:studioProject,exportId:randomUUID(),audience:'internal',format:'png',page:5}),/PITCH_DENIED/);
  await db.setup.query("update pitch_media_assets set state='draft' where id=$1",[mid]);
 });
 await check('new scene theme upgrade preserves original content, sources and global numbering',async()=>{
  const next=randomUUID();await upgradeProjectTheme(owner,{action:'project_theme_upgrade',sourceProjectId:studioProject,projectId:next,expectedVersion:1,themeId:VERIFICATION_THEME.id,themeVersion:1});
  const before=await db.rpc(OWNER,{action:'get_project',projectId:studioProject}),after=await db.rpc(OWNER,{action:'get_project',projectId:next});
  assert.equal(after.slides.length,12);assert.deepEqual(after.slides.map(s=>s.content),before.slides.map(s=>s.content));assert.equal(after.slides[11].scene.elements.find(e=>e.purpose==='footer').text,'12');assert.equal(after.project.parent_project_id,studioProject);
 });
 await check('workspace save, reopen and revision retain the exact visual receipt in existing source snapshots',async()=>{
  const {getWorkspace}=require('../../../src/lib/pitch/workspace/workflow.ts');
  const {layoutSlides}=require('../../../src/lib/pitch/layout/engine.ts');
  const {digest}=require('../../../src/lib/pitch/data/store.ts');
  const {pinVisual}=require('../../../src/lib/pitch/visual-data/reference.ts');
  const {getVisualPageReceipts}=require('../../../src/lib/pitch/visual-data/resolve.ts');
  const project=randomUUID(),visualAsset=randomUUID();
  await db.rpc(OWNER,{action:'workspace_create',projectId:project,title:'视觉引用往返',scope,context:{},
   themeId:STUDIO_THEME.id,themeVersion:STUDIO_THEME.version});
  const current=await getWorkspace(owner,project),buildingId=randomUUID();
  const reference=pinVisual({id:randomUUID(),kind:'map',buildingIds:[buildingId],origin:{type:'building-locations',buildingIds:[buildingId]},
   contentHash:'a'.repeat(64),dimensions:{width:1920,height:1080},businessDate:null,sourceDateBasis:'catalog-observed',disclosure:'internal',
   rights:{scope:'internal',holder:null,attribution:'隔离楼宇目录',licenseName:null,sourceUrl:null,licenseUrl:null,
    cropAllowed:false,clientDistribution:false,externalAi:false},
   source:{kind:'record',recordId:buildingId,label:'隔离楼宇目录',locator:'来源测试',dataAsOf:'2026-11-27'}},'isolated-source');
  const content={protocol:'colliers-pitch/1',locale:'zh',title:'区位图来源复核',disclosure:'internal',isTestData:true,
   dataAsOf:reference.source.dataAsOf,sources:[reference.source],
   blocks:[{kind:'paragraph',text:'隔离记录',sourceIds:[reference.source.id]}]};
  await db.rpc(OWNER,{action:'workspace_custom',projectId:project,assetId:visualAsset,content,
   sha256:digest(Buffer.from(JSON.stringify(content)))});
  const [scene]=await layoutSlides(content,STUDIO_THEME,'two-columns');
  const slideId=randomUUID();
  const save=workspace=>db.rpc(OWNER,{action:'workspace_save',projectId:project,expectedVersion:workspace.project.version,
   title:workspace.project.title,themeId:STUDIO_THEME.id,themeVersion:STUDIO_THEME.version,activeSlide:slideId,
   context:workspace.workspace.context,settings:{},slides:[{id:slideId,assetId:visualAsset,assetVersion:1,
    templateId:STUDIO_TEMPLATE.id,templateVersion:1,content,scene}]});
  await save(current);
  const reopened=await getWorkspace(owner,project);
  assert.deepEqual(getVisualPageReceipts(reopened.slides.map(slide=>slide.content)),[reference.source.visual]);
  const persisted=(await db.setup.query('select source_snapshot from pitch_project_slides where project_id=$1',[project])).rows[0].source_snapshot;
  assert.deepEqual(persisted,[reference.source]);
  await save(reopened);
  const revision=await db.rpc(OWNER,{action:'workspace_revision',projectId:project,revision:reopened.project.version});
  assert.deepEqual(revision.slides[0].source_snapshot,[reference.source]);
  await assert.rejects(getWorkspace(ctx(OTHER),project),/PITCH_DENIED/);
 });
 console.log(`PASS ${count} Pitch Studio PostgreSQL 17 and application workflow scenarios; synthetic isolated data only`);
}finally{await db.close();}
