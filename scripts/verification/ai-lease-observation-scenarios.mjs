import {verifyLeaseQueryEntry} from './ai-lease-query-entry-scenarios.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { rolldown } from 'rolldown';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';

export async function setupLeaseObservation(db, load) {
  // Reuse the historical table fixture and the CURRENT real governed view definition.
  // Do not run historical production-data repair migrations against synthetic data.
  const fixture = await readFile('supabase/tests/lease-expiry/fixture.sql', 'utf8');
  const history = fixture.slice(fixture.indexOf('create table public.lease_transactions_history'), fixture.indexOf('create table public.audit_logs')).replaceAll('submitter_id uuid', 'submitter_id varchar');
  await db.query(history);
  await db.query(`create table public.lease_building_record_map(source_uid text primary key, market_code text, building_id uuid);
    alter table public.buildings add column if not exists tracking_scope text not null default 'tracked';
    alter table public.lease_transactions_history enable row level security;
    alter table public.lease_building_name_map enable row level security;
    alter table public.lease_building_project_map enable row level security;
    alter table public.lease_building_record_map enable row level security;
    revoke all on public.lease_transactions_history,public.lease_building_name_map,public.lease_building_project_map,public.lease_building_record_map from public,anon,authenticated;
    grant select on public.lease_transactions,public.lease_transactions_history,public.lease_building_name_map,public.lease_building_project_map,public.lease_building_record_map to service_role;`);
  const source = await load('20260921020006_separate_reference_buildings_from_operational_inventory_v19.sql');
  const start = source.indexOf('create or replace view public.lease_transactions_read_v1');
  const end = source.indexOf('do $$', start);
  assert.ok(start >= 0 && end > start);
  await db.query(source.slice(start, end));
  await db.query(await load('20261114072043_ai_lease_observation.sql'));
  await db.query(await load('20261114075152_ai_lease_query_entry.sql'));
}

export async function verifyLeaseObservation({ db, service, check, person, output, keyId, encryptionKey, digestKey, app, call, recover, artifact, acknowledge, capabilities }) {
  const entry = path.join(output, 'lease-entry.mjs'), file = path.join(output, 'lease-adapter.cjs');
  await writeFile(entry, `export {readLeaseSnapshot,loadLeaseAuthority} from '../../src/lib/intelligence/query/leases/reader.ts';
    export {analyzeLeaseSnapshot} from '../../src/lib/intelligence/query/leases/analyze.ts';
    export {verifyQueryIdentity,loadDataAuthority} from '../../src/lib/intelligence/query/serverAuthority.ts';
    export {createRpcAuditPort} from '../../src/lib/intelligence/query/auditStore.ts';`);
  const bundle = await rolldown({ input: entry, platform: 'node' });
  try { await bundle.write({ file, format: 'cjs', codeSplitting: false }); } finally { await bundle.close(); }
  const api = createRequire(import.meta.url)(file), who = await person('admin', 'lease-data');
  const fields = ['area_sqm','face_rent','effective_rent','lease_term_months','industry','sub_industry','demand_type','source_evidence'];
  const signal = () => new AbortController().signal;
  const identity = () => api.verifyQueryIdentity(new Request('http://127.0.0.1:3289', { headers: { Authorization: 'Bearer ' + who.token } }), service);
  const grant = async (extra = {}) => {
    await grantQuery({ setup: db }, who.id, { capabilities: extra.capabilities ?? ['query:leases'], fields: [], allSubmarkets: extra.allSubmarkets ?? true, submarkets: extra.submarkets ?? [], allBuildings: extra.stock ?? false });
    await db.query('update private.ai_query_grants set all_lease_records=$2,lease_record_ids=$3,lease_sources=$4,lease_fields=$5 where user_id=$1', [who.id, extra.all ?? true, extra.ids ?? [], extra.sources ?? ['live','history'], extra.fields ?? fields]);
  };
  const defaultRead = { sources: ['live','history'], fields, submarkets: ['AI成交样本'] };
  const read = async (spec = defaultRead, after) => {
    const ident = await identity(), authority = await api.loadLeaseAuthority(service, ident, signal()), requestId = randomUUID();
    const audit = api.createRpcAuditPort(service, ident, { keyId, encryptionKey, digestKey });
    await audit.receive({ requestId, submittedText: '隔离验收：企业与楼宇成交', plan: spec, authority });
    await audit.append(requestId, 'running', { entry: 'isolated_lease_adapter' });
    const client = after ? { rpc(name, args) { const r = service.rpc(name, args); return name === 'ai_query_lease_snapshot_read' ? { abortSignal: async s => { const result = await r.abortSignal(s); await after(); return result; } } : r; } } : service;
    try { return await api.readLeaseSnapshot(client, ident, requestId, spec, signal()); }
    finally { await audit.append(requestId, 'cancelled', { reason: 'isolated_adapter_check_finished_without_user_delivery' }); }
  };
  const bid = [randomUUID(), randomUUID(), randomUUID()], live = [randomUUID(), randomUUID()], hist = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const uid = n => 'ai-synthetic-' + hist[n], market = 'AI成交样本';
  await db.query("insert into public.buildings(id,name,tracking_scope,project_type,is_active) values($1,'AI成交一座','tracked','stock',true),($2,'AI成交二座','tracked','stock',true),($3,'AI历史参考','reference_only','reference',false)", bid);
  await db.query("insert into public.lease_building_name_map(market_code,alias_name,building_id) values('BJ','AI成交一座',$1),('BJ','AI历史参考',$2)", [bid[0], bid[2]]);
  await db.query("insert into public.lease_building_project_map(market_code,alias_name,building_id) values('BJ','AI成交项目',$1),('BJ','AI成交项目',$2)", [bid[0], bid[1]]);
  for (let i = 0; i < live.length; i++) await db.query(`insert into public.lease_transactions(id,company,new_building,sub_market,area_sqm,face_rent,effective_rent,lease_term_months,transaction_year,transaction_quarter,is_face_rent_estimated,is_effective_rent_estimated,remarks)
    values($1,'同名合成企业',$2,$3,$4,15,$5,36,2026,'Q3',true,false,'不可读取的日常备注')`, [live[i], i ? 'AI成交项目' : 'AI成交一座', market, i ? '300' : '100', i ? '12' : '8']);
  for (let i = 0; i < hist.length; i++) await db.query(`insert into public.lease_transactions_history(id,source_uid,company,new_building,sub_market,area_sqm,face_rent,effective_rent,lease_term_months,transaction_year,transaction_quarter,quality_status,period_source,source_lease_term_raw,source_file,source_sheet,source_row,created_at,agency_person,remarks)
    values($1,$2,'同名合成企业',$3,$4,$5,15,8,36,$6,$7,'待核','info_date_inferred_same_year','36','合成.xlsx','Sheet1',$8,now(),'不可读取的联系人','不可读取的历史备注')`,
    [hist[i], uid(i), ['AI成交项目','AI历史参考','AI未映射名称','AI原同名'][i], market, i === 2 ? null : '100', i === 2 ? null : 2026, i === 1 || i === 2 ? null : 'Q3', i + 2]);
  await db.query("insert into public.lease_building_record_map(source_uid,market_code,building_id) values($1,'BJ',$2)", [uid(3), bid[1]]);
  try {
    await check('成交独立资格/来源/记录/字段默认拒绝，不继承存量或未来范围', async () => {
      await assert.rejects(api.loadLeaseAuthority(service, await identity(), signal()), /QUERY_DENIED/);
      await grant({ all: false, ids: [] }); await assert.rejects(read(), /QUERY_DENIED/);
      await grant({ sources: [] }); await assert.rejects(read(), /QUERY_DENIED/);
      await grant(); await assert.rejects(api.loadDataAuthority(service, await identity(), signal()), /QUERY_DENIED/);
      await grant({ sources: ['live'] }); await assert.rejects(read(), /QUERY_DENIED/);
      await grant({ fields: [] }); await assert.rejects(read(), /QUERY_DENIED/);
      await grant();
    });
    await check('真实成交读层保留项目/参考/逐行映射，按来源分开计算且来源可追溯', async () => {
      const raw = await read(), a = api.analyzeLeaseSnapshot(raw); assert.equal(a.recordCount, 6); assert.equal(a.uniqueBusinessDealCount, null);
      const daily = a.summaries.find(x => x.source === 'live'); assert.equal(daily.area.sum.numeric, 400);
      assert.equal(daily.rents.effective_rent.find(x => x.nature === 'not_marked_estimated').weightedRent.numeric, 11);
      assert.equal(a.summaries.find(x => x.source === 'history').area.sum.numeric, 300);
      assert.equal(raw.records.find(x => x.sourceRecordId === hist[3]).buildingId, bid[1]);
      assert.equal(raw.records.find(x => x.sourceRecordId === hist[1]).buildingScope, 'reference');
      assert.equal(a.rows.find(x => x.sourceRecordId === hist[2]).period.state, 'unknown');
      assert.equal(a.rows.find(x => x.sourceRecordId === hist[1]).period.state, 'year');
      assert.ok(a.sources.every(x => x.original === null)); assert.equal(a.sources.find(x => x.field === 'source_file').rawValue, '合成.xlsx');
      assert.ok(!JSON.stringify(raw).includes('不可读取'));
      assert.equal(raw.records.find(x => x.sourceRecordId === hist[0]).estimates.effective_rent, null);
    });
    await check('成交楼座/项目筛选不复制面积，企业精确文字筛选不自动合并相似法人', async () => {
      const related = await read({ ...defaultRead, building: { id: bid[0], scope: 'related' } }); assert.equal(related.records.length, 3);
      assert.equal((await read({ ...defaultRead, building: { id: bid[0], scope: 'tower' } })).records.length, 1);
      assert.equal((await read({ ...defaultRead, building: { id: bid[0], scope: 'project' } })).records.length, 2);
      assert.equal((await read({ ...defaultRead, companyExact: ' 同名合成企业 ' })).records.length, 6);
      assert.equal((await read({ ...defaultRead, companyExact: '同名合成企业有限公司' })).records.length, 0);
      assert.equal((await read({ ...defaultRead, companyExact: "%') OR true --" })).records.length, 0);
    });
    await check('成交字段最小读取：隐藏字段变化不影响可见版本，授权单条无范围外计数', async () => {
      const spec = { ...defaultRead, fields: [] }, before = await read(spec);
      await db.query('update public.lease_transactions set effective_rent=99,remarks=$2 where id=$1', [live[0], '隐藏变更']);
      await db.query('update public.lease_transactions_history set source_file=$2,agency_person=$3 where id=$1', [hist[0], '隐藏原件.xlsx', '隐藏人员变更']);
      const after = await read(spec); assert.deepEqual(after.records.map(r => r.version), before.records.map(r => r.version));
      assert.ok(after.records.every(r => Object.keys(r.values).length === 0 && r.evidence === null));
      await db.query('update public.lease_transactions set effective_rent=8 where id=$1', [live[0]]);
      await grant({ all: false, ids: ['live:' + live[0]], sources: ['live'] });
      const limited = await read({ ...defaultRead, sources: ['live'] }); assert.equal(limited.expected, 1);
      await assert.rejects(read({ ...defaultRead, sources: ['live'], recordIds: ['live:' + live[1]] }), /QUERY_DENIED/);
      await grant({ allSubmarkets: false, submarkets: ['另一个获权区域'] }); await assert.rejects(read(), /QUERY_DENIED/);
      assert.equal((await read({ sources: ['live','history'], fields: [] })).expected, 0); await grant();
    });
    await check('成交必须先持久审计；非admin/模拟/直调与读取后撤权均拒绝', async () => {
      const ident = await identity(); await assert.rejects(api.readLeaseSnapshot(service, ident, randomUUID(), defaultRead, signal()), /QUERY_DENIED/);
      for (const role of ['viewer','editor']) { await db.query('update public.user_roles set role=$1 where user_id=$2', [role, who.id]); await assert.rejects(read(), /QUERY_DENIED/); }
      await db.query("update public.user_roles set role='admin' where user_id=$1", [who.id]);
      await assert.rejects(api.verifyQueryIdentity(new Request('http://127.0.0.1:3289', { headers: { Authorization: 'Bearer ' + who.token, 'X-Colliers-Impersonate-User': who.id } }), service), /QUERY_UNAUTHENTICATED/);
      assert.equal((await who.client.rpc('ai_query_lease_authority', { p_actor: who.id, p_effective: who.id, p_session: who.sessionId })).error?.code, '42501');
      await assert.rejects(read(defaultRead, async () => grant({ fields: [] })), /QUERY_DENIED/); await grant();
      await grant({ capabilities: ['query:catalog','query:leases'], stock: true }); assert.ok((await api.loadDataAuthority(service, await identity(), signal())).grants.includes('query:leases')); await grant();
    });
    await check('成交超过Data API默认1000行仍完整读回，未知与零值保留', async () => {
      const bulk = (await db.query("insert into public.lease_transactions(id,company,new_building,sub_market,area_sqm,transaction_year) select gen_random_uuid(),'完整合成企业','未关联','AI完整成交',case when n=1 then null else 0 end,2025 from generate_series(1,1205) n returning id")).rows.map(x => x.id);
      try { const raw = await read({ sources: ['live'], fields: ['area_sqm'], submarkets: ['AI完整成交'] }); assert.equal(raw.expected, 1205);
        const a = api.analyzeLeaseSnapshot(raw); assert.equal(a.summaries[0].area.valid, 1204); assert.equal(a.summaries[0].area.missing, 1); assert.equal(a.summaries[0].area.sum.numeric, 0);
      } finally { await db.query('delete from public.lease_transactions where id=any($1::uuid[])', [bulk]); }
    });
    await check('成交快照检查所有稳定记录身份，不用去重掩盖损坏映射或重复来源', async () => {
      const bad = randomUUID();
      await db.query('insert into public.lease_transactions_history(id,source_uid,company,new_building,sub_market) values($1,$2,$3,$4,$5)', [bad, uid(0), '重复来源', 'AI成交项目', market]);
      try { await assert.rejects(read(), /QUERY_READ_UNAVAILABLE/); } finally { await db.query('delete from public.lease_transactions_history where id=$1', [bad]); }
    });
    if(app)await verifyLeaseQueryEntry({db,service,check,person,who,grant,fields,live,hist,market,call,recover,artifact,acknowledge,capabilities,app});
  } finally {
    await db.query('delete from public.lease_transactions where id=any($1::uuid[])', [live]);
    await db.query('delete from public.lease_transactions_history where id=any($1::uuid[])', [hist]);
    await db.query('delete from public.lease_building_name_map where building_id=any($1::uuid[])', [bid]);
    await db.query('delete from public.lease_building_project_map where building_id=any($1::uuid[])', [bid]);
    await db.query('delete from public.lease_building_record_map where building_id=any($1::uuid[])', [bid]);
    await db.query('delete from public.buildings where id=any($1::uuid[])', [bid]);
  }
}
