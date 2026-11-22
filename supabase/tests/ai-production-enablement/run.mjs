import assert from 'node:assert/strict';
import { buildExistingAdminEnablement } from '../../../scripts/intelligence/ai5-enablement.mjs';
import { createAiQueryTestDatabase, grantQuery } from '../ai-query-authority/database.mjs';
import { addSnapshotFixture, BUILDINGS } from '../ai-query-authority/snapshot-fixture.mjs';
import { loadAuditPrerequisites, applyAdminOnly } from '../ai-admin-only/database.mjs';
import { OWNER, OTHER } from '../lease-change-history/database.mjs';
import { installLeaseResearchFixture } from '../ai-lease-research/fixture.mjs';
import { installBusinessFixture } from '../ai-business-research/fixture.mjs';
import { installKnowledgeFixture, seedDocument, DOCUMENTS } from '../ai-knowledge-retrieval/fixture.mjs';

const db = await createAiQueryTestDatabase();
const tables = ['ai_lease_research_grants','ai_business_research_grants','ai_knowledge_grants'];
const check = async (name, fn) => { await fn(); console.log('PASS AI5 enablement: ' + name); };
async function plan(extra = {}) {
  const g = (await db.setup.query('select * from private.ai_query_grants where user_id=$1', [OWNER])).rows[0];
  return { actorId: OWNER, expectedRevision: g.revision, documentIds: [DOCUMENTS[0]], changeReference: "synthetic DBA's reviewed enablement", ...extra };
}
async function apply(input) {
  try { await db.setup.query(buildExistingAdminEnablement(input)); }
  catch (e) { await db.setup.query('rollback'); throw e; }
}
async function counts() { const result=[]; for (const t of tables) result.push(Number((await db.setup.query('select count(*) n from private.' + t)).rows[0].n)); return result; }
try {
  await loadAuditPrerequisites(db); await applyAdminOnly(db); await addSnapshotFixture(db);
  await installLeaseResearchFixture(db.setup); await installBusinessFixture(db.setup); await installKnowledgeFixture(db.setup);
  await db.setup.query("update public.user_roles set role='admin' where user_id=$1", [OWNER]);
  await db.setup.query('update private.ai_query_control set enabled=true');
  await grantQuery(db, OWNER, { allSubmarkets:false, submarkets:['CBD'], allBuildings:false, buildingIds:[BUILDINGS[0]] });
  await seedDocument(db.setup, { buildingId:BUILDINGS[0] });
  await seedDocument(db.setup, { id:DOCUMENTS[1], buildingId:BUILDINGS[1] });
  await check('strict input rejects extra keys, duplicate IDs and SQL delimiter injection', async () => {
    const p = await plan();
    for (const bad of [{...p,documentIds:[DOCUMENTS[0],DOCUMENTS[0]]},{...p,allAdmins:true},{...p,changeReference:'$ai5_enable$; drop table x;'}])
      assert.throws(() => buildExistingAdminEnablement(bad), /INVALID_AI5_ENABLEMENT/);
  });
  await check('no new role, expired, disabled, stale revision or global-off activation', async () => {
    const p = await plan();
    await assert.rejects(apply({...p,actorId:OTHER}), /AI5_EXISTING_ADMIN_REQUIRED/);
    await assert.rejects(apply({...p,expectedRevision:OTHER}), /AI5_EXISTING_ADMIN_REQUIRED/);
    for (const role of ['viewer','editor']) {
      await db.setup.query('update public.user_roles set role=$1 where user_id=$2', [role,OWNER]);
      await assert.rejects(apply(await plan()), /AI5_EXISTING_ADMIN_REQUIRED/);
    }
    await db.setup.query("update public.user_roles set role='admin' where user_id=$1", [OWNER]);
    await db.setup.query('update private.ai_query_control set enabled=false');
    await assert.rejects(apply(await plan()), /AI5_EXISTING_ADMIN_REQUIRED/);
    await db.setup.query('update private.ai_query_control set enabled=true');
    await db.setup.query("update private.ai_query_grants set valid_until=now()-interval '1 second' where user_id=$1", [OWNER]);
    await assert.rejects(apply(await plan()), /AI5_EXISTING_ADMIN_REQUIRED/);
    await grantQuery(db, OWNER, { allSubmarkets:false, submarkets:['CBD'], allBuildings:false, buildingIds:[BUILDINGS[0]] });
    await db.setup.query('update private.ai_query_grants set enabled=false where user_id=$1', [OWNER]);
    await assert.rejects(apply(await plan()), /AI5_EXISTING_ADMIN_REQUIRED/);
    await db.setup.query('update private.ai_query_grants set enabled=true where user_id=$1', [OWNER]);
    assert.deepEqual(await counts(), [0,0,0]);
  });
  await check('explicit source scope, online, confirmed and supported-original gates are atomic', async () => {
    await assert.rejects(apply(await plan({documentIds:[DOCUMENTS[1]]})), /AI5_DOCUMENT_NOT_AUTHORIZED/);
    const old=(await db.setup.query('select * from public.building_sales_materials where id=$1',[DOCUMENTS[0]])).rows[0];
    const mutations=[
      "status='pending',association_status='unconfirmed'",
      "mime_type='image/png',storage_path=replace(storage_path,'original.pdf','original.png')",
      "original_location='local_archive',storage_path=null,archive_reference='sha256:'||source_sha256,content_types=array['brochure'],historical_context='{\"not_current\":true,\"period_label\":\"synthetic\",\"evidence\":\"fixture\"}'::jsonb,extraction=jsonb_set(extraction,'{extraction,historical_import_authorized}','true')",
    ];
    for (const mutation of mutations) {
      await db.setup.query('update public.building_sales_materials set '+mutation+' where id=$1',[DOCUMENTS[0]]);
      await assert.rejects(apply(await plan()), /AI5_DOCUMENT_NOT_AUTHORIZED/);
      await db.setup.query('update public.building_sales_materials set status=$2,association_status=$3,mime_type=$4,storage_path=$5,original_location=$6,archive_reference=$7,content_types=$8,historical_context=$9,extraction=$10 where id=$1',
        [DOCUMENTS[0],old.status,old.association_status,old.mime_type,old.storage_path,old.original_location,old.archive_reference,old.content_types,old.historical_context,old.extraction]);
    }
    assert.deepEqual(await counts(), [0,0,0]);
  });
  await check('exact single-recipient scope and expiry, no sensitive detail or public-search expansion', async () => {
    const original = (await db.setup.query('select * from private.ai_query_grants where user_id=$1',[OWNER])).rows[0];
    await apply(await plan());
    assert.deepEqual(await counts(), [1,1,1]);
    const rows=[];for (const t of tables) rows.push((await db.setup.query('select * from private.'+t)).rows[0]);
    const [lease,business,knowledge] = rows;
    for (const g of [lease,business,knowledge]) { assert.equal(g.user_id,OWNER); assert.deepEqual(g.valid_until,original.valid_until); }
    for (const g of [lease,business]) { assert.equal(g.all_buildings,false);assert.deepEqual(g.building_ids,[BUILDINGS[0]]);assert.equal(g.all_submarkets,false);assert.deepEqual(g.submarkets,['CBD']);assert.equal(g.allow_export,false); }
    assert.equal(lease.allow_details,false);assert.equal(lease.allow_financials,false);assert.equal(lease.min_group_size,3);
    assert.deepEqual(knowledge.document_ids,[DOCUMENTS[0]]);assert.equal(knowledge.allow_public_search,false);
    assert.equal((await db.setup.query("select count(*) n from private.ai_query_policy_events where relation_name=any($1)",[tables])).rows[0].n,'3');
    assert.deepEqual((await db.setup.query('select * from private.ai_query_grants where user_id=$1',[OWNER])).rows[0],original);
    await assert.rejects(apply(await plan()), /AI5_GRANT_ALREADY_EXISTS/);
    await db.setup.query('update private.ai_lease_research_grants set enabled=false where user_id=$1',[OWNER]);
    await assert.rejects(apply(await plan()), /AI5_GRANT_ALREADY_EXISTS/);
  });
} finally { await db.close(); }
