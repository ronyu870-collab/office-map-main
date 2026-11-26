import './load-app.cjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { createPitchDatabase, OWNER, OTHER } from './database.mjs';
const require = createRequire(import.meta.url);
const workspace = require('../../../src/lib/pitch/workspace/workflow.ts');
const library = require('../../../src/lib/pitch/library/workflow.ts');
const business = require('../../../src/lib/pitch/business/workflow.ts');
const foundation = require('../../../src/lib/pitch/data/workflow.ts');
const render = require('../../../src/lib/pitch/data/renderWorkflow.ts');
const { DECK_KITS } = require('../../../src/lib/pitch/templates/deckKits.ts');
const { ECOSYSTEM_TEMPLATES } = require('../../../src/lib/pitch/templates/ecosystem.ts');
const { templateThumbnail } = require('../../../src/lib/pitch/workspace/thumbnail.ts');
const { workspaceCommandSchema } = require('../../../src/lib/pitch/workspace/protocol.ts');
const db = await createPitchDatabase(), files = new Map();
let count = 0;
const check = async (name, run) => { await run(); console.log('PASS ' + name); count++; };
const context = uid => ({ identity: { actorId: uid, effectiveUserId: uid, sessionId: uid.replace(/^[1-4]/, 'a'), expiresAt: Date.now() + 600000 }, signal: AbortSignal.timeout(120000), client: { rpc(name, args) { return { async abortSignal() { assert.equal(name, 'pitch_studio_access'); try {
                return { data: await db.rpc(uid, args.p_input), error: null };
            }
            catch (e) {
                return { data: null, error: { code: e.code, message: e.message } };
            } } }; }, storage: { from() { return { async upload(path, bytes) { if (files.has(path))
                    return { error: { message: 'exists' } }; files.set(path, new Uint8Array(bytes)); return { error: null }; }, async download(path) { return files.has(path) ? { data: new Blob([files.get(path)]), error: null } : { data: null, error: { message: 'missing' } }; } }; } } } });
const ctx = context(OWNER), scope = { organizationId: 'synthetic-org', region: 'test-region', city: 'test-city', businessLine: 'test-line' };
async function create() { const projectId = randomUUID(); await db.rpc(OWNER, { action: 'workspace_create', projectId, title: '隔离模板生态演示', scope, themeId: 'colliers-default-v1', themeVersion: 2, context: { language: 'zh', period: '2026-Q1', buildingIds: [], client: '', business: '', notes: '' } }); return workspace.getWorkspace(ctx, projectId); }
async function task(current, part) { const command = workspaceCommandSchema.parse({ action: 'start', projectId: current.project.id, expectedVersion: current.project.version, taskId: randomUUID(), part, replaceIds: [] }); await workspace.startWorkspaceTask(ctx, command); await workspace.runWorkspaceTask(ctx, current.project.id, command.taskId); const receipt = await db.rpc(OWNER, { action: 'workspace_task_status', projectId: current.project.id, taskId: command.taskId }); return { command, receipt, detail: await workspace.getWorkspace(ctx, current.project.id) }; }
try {
    await db.setup.query('update private.pitch_control set enabled=true');
    await db.grant(OWNER);
    await db.grant(OTHER);
    await check('all additive layouts and business definitions are actually registered; old template version preserved', async () => { const catalog = await db.rpc(OWNER, { action: 'business_catalog' }); assert.equal(catalog.recipes.length, 95); for (const t of ECOSYSTEM_TEMPLATES)
        assert.ok(catalog.recipes.some(r => r.id === t.id && r.layoutId === t.patternId)); assert.equal((await db.setup.query("select count(*)::int n from public.pitch_layout_definitions where version=2")).rows[0].n, 60); const config = (await db.setup.query("select config from public.pitch_template_versions where template_id='studio-content' and version=1")).rows[0].config; assert.equal(config.layouts.length, 12); });
    await check('registered business thumbnail uses its actual business example and controlled SVG', async () => { const image = await templateThumbnail(ctx, 'mandate-summary', 'default'); assert.ok(image.example); assert.match(image.svg, /<svg/); assert.ok(!image.svg.includes('PRIVATE_CLIENT')); await assert.rejects(() => templateThumbnail(ctx, 'not-registered', 'default')); });
    let single;
    await check('real worker creates a private example, persists sources, reopens it, exports and downloads native PPTX', async () => { const current = await create(), result = await task(current, { mode: 'example', templateIds: ['mandate-summary'] }); assert.equal(result.receipt.state, 'completed', result.receipt.error_code); single = result.detail; assert.ok(single.slides.length); assert.ok(single.slides.every(p => p.content.isTestData && p.content.sources.every(s => s.kind === 'synthetic' && s.documentId && s.pageId))); assert.ok(Object.values(single.workspace.page_settings).every(s => s.example)); const command = { action: 'export_start', projectId: single.project.id, exportId: randomUUID(), audience: 'internal', format: 'pptx' }; await render.prepareRenderExport(ctx, command); await render.runRenderExport(ctx, command); const file = await render.downloadArtifact(ctx, command); const zip = await JSZip.loadAsync(file.bytes); assert.match(await zip.file('ppt/slides/slide1.xml').async('string'), /<a:t>/); await assert.rejects(() => render.prepareRenderExport(ctx, { ...command, exportId: randomUUID(), audience: 'client' })); await assert.rejects(() => workspace.getWorkspace(context(OTHER), single.project.id)); });
    await check('new-pattern pages remain editable, save their sources and switch themes without changing shared assets', async () => {
        const original = single.slides[0], assetId = original.asset_id;
        const saved = await workspace.saveWorkspace(ctx, {action: 'save', projectId: single.project.id, expectedVersion: single.project.version, title: single.project.title, themeId: 'colliers-render-verification', themeVersion: 1, context: single.workspace.context, activeSlide: original.id, pages: [{id: original.id, title: '私人委托摘要修订', paragraphs: original.content.blocks.filter(b => b.kind === 'paragraph').map((b, i) => i ? b.text : '用户确认的私人委托范围')}]});
        single = await workspace.getWorkspace(ctx, saved.project.id);
        assert.equal(single.slides[0].content.title, '私人委托摘要修订');
        assert.equal(single.slides[0].scene.layoutId, 'executive-summary');
        assert.equal(single.slides[0].scene.themeId, 'colliers-render-verification');
        assert.ok(single.slides[0].content.sources.some(s => s.recordId === 'workspace:' + single.project.id));
        const shared = await db.rpc(OWNER, {action: 'get_asset', assetId});
        assert.notEqual(shared.version.content.title, '私人委托摘要修订');
    });
    await check('all eight complete kits run through the persistent executor, preserve every selected section and kit version', async () => { for (const kit of DECK_KITS) {
        const current = await create(), result = await task(current, { mode: 'example', kit: { id: kit.id, version: kit.version }, templateIds: kit.sections.map(s => s.templateId) });
        assert.equal(result.receipt.state, 'completed', kit.id + ': ' + result.receipt.error_code);
        assert.ok(result.detail.slides.length >= kit.sections.length);
        assert.ok(result.detail.slides.length <= 50);
        for (const s of kit.sections)
            assert.ok(result.detail.slides.some(p => p.content.sources.some(source => source.locator === 'template-example:' + s.templateId)), s.templateId);
        assert.ok(Object.values(result.detail.workspace.page_settings).every(s => s.kit.id === kit.id && s.kit.version === kit.version));
    } });
    await check('partial kit, unknown template and forged kit version are explicit; failure preserves old slides', async () => { const partial = await task(single, { mode: 'example', kit: { id: DECK_KITS[0].id, version: 1 }, templateIds: [DECK_KITS[0].sections[0].templateId] }); assert.equal(partial.receipt.state, 'completed'); for (const part of [{ mode: 'example', templateIds: ['unknown-template'] }, { mode: 'example', kit: { id: DECK_KITS[0].id, version: 99 }, templateIds: [DECK_KITS[0].sections[0].templateId] }]) {
        const before = await workspace.getWorkspace(ctx, single.project.id), failed = await task(before, part);
        assert.equal(failed.receipt.state, 'failed');
        assert.deepEqual(failed.detail.slides, before.slides);
    } });
    await check('all eighty registered business templates consume published, permission-checked custom assets; eight real asset bundles run end to end', async () => {
        await db.setup.query('update private.pitch_grants set maintainer=true where user_id=$1', [OWNER]);
        const assetIds = new Map();
        for (const template of ECOSYSTEM_TEMPLATES) {
            const sample = await foundation.createSample(ctx, randomUUID(), scope, undefined, 'zh', { templateId: template.id, page: 0 });
            // Link the synthetic original/page as an imported fixture. Actual parser
            // ingestion is exercised separately by library.mjs and HTTP regressions.
            await db.setup.query('update public.pitch_content_assets a set imported_from_page=(select r.page_id from public.pitch_source_references r where r.asset_id=a.id and r.asset_version=1 limit 1) where a.id=$1', [sample.assetId]);
            await db.setup.query("update public.pitch_source_pages set asset_id=$1,parse_state='completed' where id=(select imported_from_page from public.pitch_content_assets where id=$1)", [sample.assetId]);
            const original = await library.assetContext(ctx, sample.assetId);
            await business.saveBusinessProfile(ctx, { assetId: sample.assetId, expectedVersion: 1, profile: { kind: 'custom', typeCode: template.id, content: original.version.content } });
            const current = await library.assetContext(ctx, sample.assetId), asset = library.assetInput(current.asset, current.version.content);
            asset.state = 'published';
            await library.saveLibraryAsset(ctx, { action: 'save_asset', assetId: sample.assetId, expectedVersion: 2, asset, acknowledgePartial: true });
            const command = { action: 'generate', projectId: randomUUID(), title: template.names.zh, scope, language: 'zh', themeId: 'colliers-default-v1', themeVersion: 2, parts: [{ mode: 'static', templateId: template.id, assetIds: [sample.assetId], length: 'brief', allowFallback: false, variant: 'standard' }] };
            const result = await business.generateBusinessProject(ctx, command);
            assert.ok(result.pages > 0);
            assetIds.set(template.id, sample.assetId);
        }
        for (const kit of DECK_KITS) {
            const result = await task(await create(), { mode: 'bundle', kit: { id: kit.id, version: kit.version }, parts: kit.sections.map(s => ({ mode: 'static', templateId: s.templateId, assetIds: [assetIds.get(s.templateId)], length: 'brief', allowFallback: false, variant: 'standard' })) });
            assert.equal(result.receipt.state, 'completed', kit.id + ': ' + result.receipt.error_code);
            assert.ok(result.detail.slides.length >= kit.sections.length);
        }
    });
    await check('withdrawn layout recipe and revoked account deny further example generation or export', async () => { await db.setup.query("update public.pitch_business_templates set config=jsonb_set(config,'{enabled}','false') where id='mandate-summary'"); const denied = await task(await create(), { mode: 'example', templateIds: ['mandate-summary'] }); assert.equal(denied.receipt.state, 'failed'); assert.equal(denied.detail.slides.length, 0); await db.setup.query('update private.pitch_grants set enabled=false where user_id=$1', [OWNER]); await assert.rejects(() => workspace.getWorkspace(ctx, single.project.id)); await assert.rejects(() => templateThumbnail(ctx, 'market-dashboard', 'default')); });
    console.log(`Pitch ecosystem: ${count} execution groups passed`);
}
finally {
    await db.close();
}
