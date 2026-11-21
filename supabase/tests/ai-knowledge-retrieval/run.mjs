import assert from 'node:assert/strict';
import { createAiQueryTestDatabase, grantQuery, SESSION } from '../ai-query-authority/database.mjs';
import { addSnapshotFixture, BUILDINGS } from '../ai-query-authority/snapshot-fixture.mjs';
import { loadAuditPrerequisites, applyAdminOnly } from '../ai-admin-only/database.mjs';
import { OWNER, OTHER } from '../lease-change-history/database.mjs';
import { installKnowledgeFixture, grantKnowledge, seedDocument, DOCUMENTS, syntheticText } from './fixture.mjs';
const db = await createAiQueryTestDatabase();
const check = async (name, fn) => { await fn(); console.log('PASS AI5 knowledge: ' + name); };
async function access(input, actor = OWNER, session = SESSION) { await db.setup.query('begin'); try {
    await db.setup.query('set local role service_role');
    const r = await db.setup.query('select public.ai_knowledge_access($1,$1,$2,$3) v', [actor, session, input]);
    await db.setup.query('commit');
    return r.rows[0].v;
}
catch (e) {
    await db.setup.query('rollback');
    throw e;
} }
const meta = () => access({ action: 'metadata', documentIds: [DOCUMENTS[0]] });
const chunk = { ordinal: 0, text: syntheticText, location: '第 2 页', page: 2, tokens: ['空调', '调系', '系统', '停车', '车位'] };
try {
    await loadAuditPrerequisites(db);
    await applyAdminOnly(db);
    await addSnapshotFixture(db);
    await installKnowledgeFixture(db.setup);
    await db.setup.query("update public.user_roles set role='admin' where user_id=$1", [OWNER]);
    await db.setup.query('update private.ai_query_control set enabled=true');
    await grantQuery(db, OWNER);
    await seedDocument(db.setup, { buildingId: BUILDINGS[0] });
    await seedDocument(db.setup, { id: DOCUMENTS[1], buildingId: BUILDINGS[1] });
    await check('legacy AI access does not grant private documents', async () => assert.equal((await meta()).allowed, false));
    await grantKnowledge(db.setup, OWNER, [DOCUMENTS[0]]);
    await check('document ACL intersects source readiness and actual building scope', async () => { const r = await meta(); assert.equal(r.allowed, true); assert.equal(r.documents.length, 1); assert.equal(JSON.stringify(r).includes('storagePath'), false); assert.equal((await access({ action: 'metadata', documentIds: DOCUMENTS })).allowed, false); await grantQuery(db, OWNER, { allBuildings: false, buildingIds: [BUILDINGS[1]] }); assert.equal((await meta()).allowed, false); await grantQuery(db, OWNER); });
    await check('index CAS, literal Chinese retrieval, exact pages and explicit top limit', async () => {
        const m = await meta();
        assert.equal((await access({ action: 'store', documentIds: [DOCUMENTS[0]], version: '0'.repeat(64), chunks: [chunk] })).allowed, false);
        assert.equal((await access({ action: 'store', documentIds: [DOCUMENTS[0]], version: m.documents[0].version, chunks: [chunk, { ...chunk, ordinal: 1, location: '第 3 页', page: 3 }] })).allowed, true);
        const r = await access({ action: 'search', documentIds: [DOCUMENTS[0]], terms: ['空调系统'], tokens: ['空调', '调系', '系统'], limit: 1 });
        assert.equal(r.search.total, 2);
        assert.equal(r.search.matches.length, 1);
        assert.equal(r.search.matches[0].page, 2);
        assert.equal(r.search.matches[0].text, syntheticText);
        const none = await access({ action: 'search', documentIds: [DOCUMENTS[0]], terms: ['%'], tokens: [], limit: 20 });
        assert.equal(none.search.total, 0);
    });
    await check('source update immediately removes chunks and changes version', async () => { const old = (await meta()).documents[0].version; await db.setup.query("update public.building_sales_materials set title='合成更新版' where id=$1", [DOCUMENTS[0]]); assert.notEqual((await meta()).documents[0].version, old); assert.equal((await db.setup.query('select count(*) n from private.ai_document_chunks')).rows[0].n, '0'); });
    await check('withdrawal, per-user isolation, grant revocation and session expiry deny before content read', async () => { assert.equal((await access({ action: 'metadata', documentIds: [DOCUMENTS[0]] }, OTHER)).allowed, false); await db.setup.query("update public.building_sales_materials set status='pending' where id=$1", [DOCUMENTS[0]]); assert.equal((await meta()).allowed, false); await db.setup.query("update public.building_sales_materials set status='ready' where id=$1", [DOCUMENTS[0]]); await db.setup.query('update private.ai_knowledge_grants set enabled=false where user_id=$1', [OWNER]); assert.equal((await meta()).allowed, false); await grantKnowledge(db.setup, OWNER); await db.setup.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [SESSION]); assert.equal((await meta()).allowed, false); await db.setup.query('update auth.sessions set not_after=null where id=$1', [SESSION]); });
    await check('public search needs independent qualification and approved public subject', async () => { assert.equal((await access({ action: 'public_subject', buildingId: BUILDINGS[0] })).allowed, false); await grantKnowledge(db.setup, OWNER, DOCUMENTS, true); assert.equal((await access({ action: 'public_subject', buildingId: BUILDINGS[0] })).allowed, false); await db.setup.query("insert into private.ai_public_research_subjects(building_id,public_name,public_city,enabled,change_reference) values($1,'合成公开楼宇','北京',true,'synthetic public name approval')", [BUILDINGS[0]]); const r = await access({ action: 'public_subject', buildingId: BUILDINGS[0] }); assert.equal(r.subject.name, '合成公开楼宇'); assert.equal(JSON.stringify(r).includes(syntheticText), false); });
    await check('anon/authenticated cannot read indexes or call privileged wrappers; service cannot mutate grants', async () => { for (const role of ['anon', 'authenticated']) {
        await db.setup.query('begin');
        try {
            await db.setup.query('set local role ' + role);
            await assert.rejects(db.setup.query('select public.ai_knowledge_access($1,$1,$2,$3)', [OWNER, SESSION, { action: 'metadata', documentIds: [DOCUMENTS[0]] }]), e => e.code === '42501');
        }
        finally {
            await db.setup.query('rollback');
        }
    } await db.setup.query('begin'); try {
        await db.setup.query('set local role service_role');
        await assert.rejects(db.setup.query('update private.ai_knowledge_grants set enabled=true'), e => e.code === '42501');
    }
    finally {
        await db.setup.query('rollback');
    } });
    await check('source deletion cascades index and policy maintenance is audited', async () => { assert.ok((await db.setup.query("select count(*) n from private.ai_query_policy_events where relation_name='ai_knowledge_grants'")).rows[0].n > 0); const current=await meta();await access({action:'store',documentIds:[DOCUMENTS[0]],version:current.documents[0].version,chunks:[chunk]});
        assert.equal((await db.setup.query('select count(*) n from private.ai_document_chunks where document_id=$1',[DOCUMENTS[0]])).rows[0].n,'1');
        await db.setup.query('delete from public.building_sales_materials where id=$1', [DOCUMENTS[0]]);
        assert.equal((await db.setup.query('select count(*) n from private.ai_document_chunks where document_id=$1',[DOCUMENTS[0]])).rows[0].n,'0'); assert.equal((await meta()).allowed, false); });
}
finally {
    await db.close();
}
