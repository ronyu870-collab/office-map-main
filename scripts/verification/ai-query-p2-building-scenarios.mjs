import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';

/** Load only existing production catalogue schema into the disposable local Auth fixture. */
export async function setupP2Buildings(db, load) {
  for (const [table, file, end] of [
    ['lease_building_name_map', '20260915053000_create_historical_lease_read_layer_v1.sql', 'with candidate_aliases as ('],
    ['lease_building_project_map', '20260915060530_expand_historical_building_identity_governance_v2.sql', 'create temp table _safe_exact_aliases ('],
  ]) {
    if ((await db.query('select to_regclass($1) relation', [`public.${table}`])).rows[0].relation) continue;
    const source = await load(file), start = source.indexOf(`create table if not exists public.${table} (`), finish = source.indexOf(end);
    assert.ok(start >= 0 && finish > start); await db.query(source.slice(start, finish));
  }
  if (!(await db.query("select to_regclass('public.building_photos') relation")).rows[0].relation) {
    await db.query(await load('20261105153236_building_photos.sql'));
  }
}

/** T01-T07/T12/T17/T18: real login, HTTP, scoped PostgreSQL and immutable result recovery. */
export async function verifyP2Buildings({ db, app, check, person, call, recover, events, decrypt, exportCaps }) {
  const owner = await person('admin', 'p2-buildings'), other = await person('admin', 'p2-buildings-other');
  const ids = Array.from({ length: 3 }, () => randomUUID()), photoId = randomUUID();
  const grant = (who, overrides = {}) => grantQuery({ setup: db }, who.id, { capabilities: exportCaps,
    allBuildings: false, buildingIds: ids, ...overrides });
  const submit = (question, extra = {}, who = owner) => call(who, { idempotencyKey: randomUUID(), question, conversation: { id: randomUUID() }, ...extra });
  const buildings = async (who, requestId, extra = {}, headers = {}) => {
    const response = await fetch(app + '/api/intelligence/query/buildings', { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: 'Bearer ' + who.token, ...headers,
    }, body: JSON.stringify({ requestId, action: 'buildings', ...extra }) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  let single, multiple;
  try {
    for (let index = 0; index < ids.length; index++) {
      await db.query(`insert into public.buildings(id,name,submarket,grade,former_names,location_lng,location_lat)
        values($1,$2,'CBD','A',$3,$4,$5)`, [ids[index], `P2合成中心${index + 1}座`, JSON.stringify([index < 2 ? 'P2同名旧称' : 'P2独有旧称']), index === 2 ? null : 116.4 + index * 0.01, index === 2 ? null : 39.9]);
      await db.query(`insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,is_draft)
        values($1,2026,3,10000,$2,$3,false)`, [ids[index], index === 2 ? null : 100 + index * 50, index === 2 ? null : 1000]);
      await db.query('insert into public.building_brochure_data(building_id,building_height) values($1,$2)', [ids[index], index === 2 ? null : 210]);
    }
    await db.query("insert into public.lease_building_name_map(alias_name,building_id,match_method) values('P2治理别名',$1,'manual')", [ids[0]]);
    for (const id of ids.slice(0, 2)) await db.query("insert into public.lease_building_project_map(alias_name,building_id) values('P2合成项目',$1)", [id]);
    // A stored rendering is deliberately present: it must never masquerade as a real building photograph.
    await db.query(`insert into public.building_photos(id,building_id,image_url,source_url,caption,photo_kind,storage_path,width,height,sha256,file_size,status)
      values($1,$2,'https://example.invalid/p2-rendering.jpg','https://example.invalid/p2','合成效果图','rendering',$3,100,100,$4,100,'ready')`,
    [photoId, ids[0], `building-photos/v1/${ids[0]}/${photoId}/rendering.jpg`, '0'.repeat(64)]);
    await grant(owner); await grant(other);

    await check('P2 T01/T03/T17 楼宇介绍按主键绑定已有可信字段及真实季度，不生成缺失参数或效果图照片', async () => {
      single = await submit('介绍一下P2合成中心1座'); assert.equal(single.status, 200, JSON.stringify(single.body));
      const result = single.body.result, row = result.table.rows[0];
      assert.equal(row.entityId, ids[0]); assert.equal(row.cells.name.value, 'P2合成中心1座');
      assert.equal(row.cells.netEffectiveRent.value.numeric, 100); assert.equal(row.cells.vacancy.value.numeric, 0.1);
      assert.deepEqual(result.parameters.executedPlan.period, { year: 2026, quarter: 3 });
      assert.equal(row.cells.year, undefined); assert.equal(row.cells.gfa, undefined); assert.equal(row.cells.parking, undefined);
      const context = await buildings(owner, single.body.requestId, { resultId: result.resultId });
      assert.equal(context.status, 200); assert.equal(context.body.buildings[0].id, ids[0]);
      assert.equal(context.body.buildings[0].photo, null); assert.equal(context.body.buildings[0].located, true);
      const audited = decrypt((await events(context.body.attemptId)).find(event => event.kind === 'response_generated')).content.result.buildingMetadata;
      assert.equal(audited.metadataReadAt, context.body.metadataReadAt); assert.deepEqual(audited.buildings, context.body.buildings);
      assert.equal((await submit('介绍P2治理别名')).body.result.table.rows[0].entityId, ids[0]);
      const missing = await submit('介绍P2独有旧称'); assert.equal(missing.status, 200);
      assert.equal(missing.body.result.table.rows[0].cells.height.kind, 'unknown');
      assert.equal(missing.body.result.table.rows[0].cells.netEffectiveRent.kind, 'unknown');
      assert.equal(missing.body.result.table.rows[0].cells.totalArea.value.numeric, 10000);
    });
    await check('P2 T02 同名与项目别名必须确认候选，确认后只有所选主键且不会使用模糊同名跳转', async () => {
      for (const name of ['P2同名旧称', 'P2合成项目']) {
        const conversation = { id: randomUUID() }, question = '介绍' + name;
        const candidates = await submit(question, { conversation }); assert.equal(candidates.status, 422);
        assert.deepEqual(candidates.body.options.map(value => value.id).sort(), ids.slice(0, 2).map(id => `building:${id}`).sort());
        const option = candidates.body.options.find(value => value.id === `building:${ids[1]}`);
        const selected = await submit(option.question, { conversation: { ...conversation, parentRequestId: candidates.body.requestId } });
        assert.equal(selected.status, 200, JSON.stringify(selected.body));
        assert.deepEqual(selected.body.result.table.rows.map(row => row.entityId), [ids[1]]);
      }
      const partial = await submit('介绍P2合成中心1'); assert.equal(partial.status, 422); assert.equal(partial.body.result, undefined);
    });
    await check('P2 T04/T05/T06 多项目地图补充保持原身份、分页与未知坐标，不携带重新查询的季度指标', async () => {
      const ranked = await submit('把2026Q3 CBD净有效租金最高的十栋写字楼标在地图上。');
      assert.equal(ranked.status, 200, JSON.stringify(ranked.body)); assert.equal(ranked.body.result.parameters.executedPlan.limit, 10);
      assert.equal((await buildings(owner, ranked.body.requestId)).body.buildings.length, 2);
      multiple = await submit('比较选中楼宇最新有数据季度的净有效租金和空置面积', { buildingSelection: { ids, intent: 'compare' } });
      assert.equal(multiple.status, 200, JSON.stringify(multiple.body));
      const first = await buildings(owner, multiple.body.requestId, { limit: 2 });
      const second = await buildings(owner, multiple.body.requestId, { limit: 2, offset: 2 });
      assert.equal(first.status, 200); assert.equal(second.status, 200);
      assert.equal(first.body.total, 3); assert.equal(first.body.hasMore, true); assert.equal(second.body.hasMore, false);
      const returned = [...first.body.buildings, ...second.body.buildings];
      assert.deepEqual(returned.map(value => value.id).sort(), [...ids].sort());
      assert.equal(returned.filter(value => value.located).length, 2);
      assert.equal(returned.find(value => value.id === ids[2]).unavailableReason, 'missing_coordinates');
      assert.ok(returned.every(value => !('location_lng' in value) && !('netEffectiveRent' in value)));
      await db.query('update public.building_metrics set net_effective_rent=9999 where building_id=$1', [ids[0]]);
      try {
        assert.equal((await buildings(owner, single.body.requestId)).status, 200);
        assert.equal((await recover(owner, single.body.requestId)).body.result.table.rows[0].cells.netEffectiveRent.value.numeric, 100);
      } finally { await db.query('update public.building_metrics set net_effective_rent=100 where building_id=$1', [ids[0]]); }
    });
    await check('P2 T07 地图传入明确ID且重审当前范围，问题/动作不符时澄清，趋势沿用P1同一快照', async () => {
      const trend = await submit('查看选中楼宇最近四个季度的净有效租金趋势', { buildingSelection: { ids: [ids[0]], intent: 'rent_trend' } });
      assert.equal(trend.status, 200, JSON.stringify(trend.body)); assert.equal(trend.body.result.operation, 'trend');
      assert.deepEqual(trend.body.result.parameters.executedPlan.scope.buildingIds, [ids[0]]);
      assert.equal((await buildings(owner, trend.body.requestId)).body.buildings[0].id, ids[0]);
      const mismatch = await submit('查看所有楼宇业主联系方式', { buildingSelection: { ids: [ids[0]], intent: 'profile' } });
      assert.equal(mismatch.status, 422); assert.equal(mismatch.body.result, undefined);
      const denied = await submit('介绍选中的楼宇', { buildingSelection: { ids: [randomUUID()], intent: 'profile' } });
      assert.equal(denied.status, 403); assert.equal(denied.body.result, undefined);
    });
    await check('P2 T12/T18 卡片/地图拒绝他人记录、伪造主键、效果图、跨源、模拟身份及撤销字段资格', async () => {
      const requestId = single.body.requestId;
      for (const response of [await buildings(other, requestId), await buildings(owner, requestId, { buildingId: ids[1] }),
        await buildings(owner, requestId, { buildingId: ids[0], photoId }), await buildings(owner, requestId, {}, { Origin: 'https://foreign.invalid' }),
        await buildings(owner, requestId, {}, { 'X-Colliers-Impersonate-User': other.id })]) {
        assert.equal(response.status, 403); assert.equal(response.body.buildings, undefined); assert.equal(response.body.photoAccess, undefined);
      }
      await grant(owner, { fields: ['height'] });
      assert.equal((await buildings(owner, requestId)).status, 403);
      await grant(owner);
    });
  } finally {
    await db.query('delete from public.building_photos where building_id=any($1::uuid[])', [ids]);
    await db.query('delete from public.lease_building_name_map where building_id=any($1::uuid[])', [ids]);
    await db.query('delete from public.lease_building_project_map where building_id=any($1::uuid[])', [ids]);
    await db.query('delete from public.building_metrics where building_id=any($1::uuid[])', [ids]);
    await db.query('delete from public.building_brochure_data where building_id=any($1::uuid[])', [ids]);
    await db.query('delete from public.buildings where id=any($1::uuid[])', [ids]);
  }
}
