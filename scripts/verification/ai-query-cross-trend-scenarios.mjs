import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { BUILDINGS } from '../../supabase/tests/ai-query-authority/snapshot-fixture.mjs';
import { CROSS_TREND_METRICS, crossTrendOracleRows, validateCrossTrendResult } from './ai-query-cross-trend-oracle.mjs';

export async function verifyCrossTrend({ db, check, queryAdmin, person, call, recover, artifact, acknowledge, exportCaps, load }) {
  assert.equal(process.env.AI_QUERY_AUTH_ALLOW_LOCAL, 'disposable');
  assert.equal(db.connectionParameters.host, '127.0.0.1'); assert.equal(Number(db.connectionParameters.port), Number(process.env.AI_QUERY_AUTH_DB_PORT ?? 55992));
  const original = (await db.query('select id,submarket,grade from public.buildings where id=any($1::uuid[])', [BUILDINGS])).rows;
  const periods = [{ year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }];
  const fields = ['height', 'totalArea', 'netEffectiveRent', 'vacantArea'];
  const plan = (metrics = CROSS_TREND_METRICS, mode = 'per_period', extra = {}) => ({ operation: 'cross_trend',
    metric: metrics[0], ...(metrics.length > 1 ? { metrics } : {}), start: periods[0], end: periods[1], mode,
    scope: { inventory: 'tracked', submarkets: ['CBD', '金融街'] }, ...extra });
  const query = (p = plan(), who = queryAdmin) => call(who, { idempotencyKey: randomUUID(), question: '合成交叉趋势执行回归', plan: p }, { 'Accept-Encoding': 'gzip' });
  const assertCompressedDelivery = response => {
    // Fetch decodes the wire representation. The existing receipt still binds
    // every byte of the full decoded JSON, including all source evidence.
    const bytes = Buffer.from(JSON.stringify(response.body));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('x-query-body-sha256'), createHash('sha256').update(bytes).digest('hex'));
    if (bytes.length >= 16 * 1024) assert.equal(response.headers.get('content-encoding'), 'gzip');
  };
  const checked = async (response, p, ids = BUILDINGS, qs = periods) => {
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assertCompressedDelivery(response);
    const rows = await crossTrendOracleRows(db, { ids, periods: qs, mode: p.mode, submarkets: p.scope.submarkets ?? null });
    validateCrossTrendResult(response.body.result, rows, p.metrics ?? [p.metric]);
    assert.ok(response.body.result.sources.every(source => ids.includes(source.entityId)));
    return response.body;
  };
  let saved, limitedResult, limited;
  try {
    await grantQuery({ setup: db }, queryAdmin.id, { capabilities: exportCaps, fields });
    for (const [i, id] of BUILDINGS.entries()) await db.query('update public.buildings set submarket=$2,grade=$3 where id=$1',
      [id, i < 2 ? 'CBD' : '金融街', i % 2 === 0 ? 'A' : 'B']);
    await check('交叉趋势：一至三指标各期/共同样本对照独立SQL，每次只读一次，伪造轴拒绝且零事实读取', async () => {
      const definition = (await db.query("select pg_get_functiondef('public.ai_query_snapshot_read(uuid,uuid,uuid,text,text[],jsonb,text,text[],uuid[])'::regprocedure) definition")).rows[0].definition;
      const probe = `ai_query_cross_probe_${randomUUID().replaceAll('-', '')}`;
      await db.query(`create sequence private.${probe}; revoke all on sequence private.${probe} from public,anon,authenticated; grant usage on sequence private.${probe} to service_role`);
      try {
        // Disposable service-only counter around the unchanged private access
        // function. This proves one actual PostgREST snapshot call per plan.
        await db.query(`create or replace function public.ai_query_snapshot_read(p_actor uuid,p_effective uuid,p_session uuid,p_permission_revision text,p_fields text[],p_periods jsonb,p_inventory text,p_submarkets text[],p_building_ids uuid[]) returns jsonb language plpgsql security invoker set search_path='' as $$ begin
          perform nextval('private.${probe}'::regclass);
          return private.ai_query_snapshot_read(p_actor,p_effective,p_session,p_permission_revision,p_fields,p_periods,p_inventory,p_submarkets,p_building_ids);
        end $$`);
        let expectedCalls = 0, lastInput;
        for (const metrics of [['rent'], ['rent', 'vacancy'], CROSS_TREND_METRICS]) for (const mode of ['per_period', 'paired']) {
          const p = plan(metrics, mode);
          lastInput = { idempotencyKey: randomUUID(), question: '合成交叉趋势快照计数', plan: p };
          const body = await checked(await call(queryAdmin, lastInput), p);
          assert.deepEqual(body.result.parameters.executedPlan, p);
          assert.equal(body.result.table.rows.length, 8);
          assert.equal(Number((await db.query(`select last_value from private.${probe}`)).rows[0].last_value), ++expectedCalls);
          if (metrics.length === 3 && mode === 'per_period') saved = body;
        }
        assert.equal((await call(queryAdmin, lastInput)).status, 202);
        assert.equal(Number((await db.query(`select last_value from private.${probe}`)).rows[0].last_value), expectedCalls);
        const forged = await query(plan(CROSS_TREND_METRICS, 'per_period', { rowGroups: [{ value: 'ungranted' }] }));
        assert.equal(forged.status, 403, JSON.stringify({ httpStatus: forged.status, status: forged.body.status }));
        assert.equal(forged.body.status, 'denied'); assert.equal(Object.hasOwn(forged.body, 'result'), false);
        assert.equal(Number((await db.query(`select last_value from private.${probe}`)).rows[0].last_value), expectedCalls);
        assert.equal((await db.query('select state from private.ai_query_audit_streams where request_id=$1', [forged.body.requestId])).rows[0].state, 'denied');
        assert.equal((await db.query("select 1 from private.ai_query_audit_events where request_id=$1 and kind in ('running','tool_started','tool_finished','response_generated','succeeded')", [forged.body.requestId])).rowCount, 0);
      } finally {
        await db.query(definition); await db.query(`drop sequence private.${probe}`);
      }
    });
    await check('交叉趋势：缺期、空组合与未知分类保留未知；共同样本不得跳过无记录季度', async () => {
      const qs = [{ year: 2026, quarter: 1 }, ...periods];
      for (const mode of ['per_period', 'paired']) {
        const p = plan(CROSS_TREND_METRICS, mode, { start: qs[0] });
        const body = await checked(await query(p), p, BUILDINGS, qs);
        assert.equal(body.result.table.rows.length, 12);
        if (mode === 'paired') assert.ok(body.result.table.rows.every(row => ['value', 'vacancy_value', 'totalArea_value'].every(key => row.cells[key].kind === 'unknown')));
      }
      await db.query('update public.buildings set submarket=null,grade=null where id=$1', [BUILDINGS[3]]);
      try {
        const p = plan(CROSS_TREND_METRICS, 'per_period', { scope: { inventory: 'tracked' } });
        const body = await checked(await query(p), p);
        assert.equal(body.result.table.rows.length, 18);
        assert.ok(body.result.table.rows.some(row => row.cells.name.value === '未知（子市场未填写）'));
        assert.ok(body.result.table.rows.some(row => row.cells.grade.value === '未知（等级未填写）'));
        assert.ok(body.result.table.rows.some(row => row.cells.value.kind === 'unknown'));
      } finally { await db.query("update public.buildings set submarket='金融街',grade='B' where id=$1", [BUILDINGS[3]]); }
    });
    await check('交叉趋势：原双维跨季问题现在执行，单季父轮追问保留双维、三指标及期间并保持幂等', async () => {
      const formerlyRejected = await call(queryAdmin, { idempotencyKey: randomUUID(), question: 'CBD、金融街净有效租金和空置率2026Q2至2026Q3按等级趋势各期样本' });
      await checked(formerlyRejected, plan(['rent', 'vacancy']));
      const conversation = { id: randomUUID() };
      const parent = await call(queryAdmin, { idempotencyKey: randomUUID(), conversation,
        question: '2026Q3 CBD、金融街净有效租金、空置率和季度总面积按子市场和等级交叉统计' });
      assert.equal(parent.status, 200, JSON.stringify(parent.body)); assert.equal(parent.body.result.operation, 'cross_aggregate');
      const follow = { idempotencyKey: randomUUID(), conversation: { ...conversation, parentRequestId: parent.body.requestId }, question: '再看看过去四个季度的变化' };
      const first = await call(queryAdmin, follow);
      const qs = [{ year: 2025, quarter: 4 }, { year: 2026, quarter: 1 }, ...periods];
      await checked(first, plan(CROSS_TREND_METRICS, 'per_period', { start: qs[0] }), BUILDINGS, qs);
      const paired = await call(queryAdmin, { idempotencyKey: randomUUID(), conversation: { ...conversation, parentRequestId: first.body.requestId }, question: '共同有效样本呢' });
      await checked(paired, plan(CROSS_TREND_METRICS, 'paired', { start: qs[0] }), BUILDINGS, qs);
      assert.deepEqual(paired.body.result.parameters.executedPlan.metrics, CROSS_TREND_METRICS);
      assert.equal(paired.body.result.parameters.executedPlan.mode, 'paired');
      const replay = await call(queryAdmin, follow); assert.equal(replay.status, 202); assert.equal(replay.body.requestId, first.body.requestId);
      assert.deepEqual((await recover(queryAdmin, first.body.requestId)).body.result, first.body.result);
      const events = (await db.query("select kind,count(*)::int n from private.ai_query_audit_events where request_id=$1 and kind in ('tool_started','tool_finished') group by kind", [first.body.requestId])).rows;
      assert.deepEqual(Object.fromEntries(events.map(row => [row.kind, row.n])), { tool_finished: 1 });
    });
    await check('交叉趋势：恢复、三指标同源分面图及真实CSV/XLSX/SVG保存完整长表和来源', async () => {
      assert.ok(saved); const common = { requestId: saved.requestId, resultId: saved.result.resultId };
      const restored = await recover(queryAdmin, saved.requestId, 'recover', { 'Accept-Encoding': 'gzip' });
      assertCompressedDelivery(restored); assert.deepEqual(restored.body.result, saved.result);
      const identity = await recover(queryAdmin, saved.requestId, 'recover', { 'Accept-Encoding': 'identity' });
      assert.equal(identity.headers.get('content-encoding'), null); assert.deepEqual(identity.body.result, saved.result);
      for (const [index, metric] of CROSS_TREND_METRICS.entries()) {
        const chart = await artifact(queryAdmin, { ...common, action: 'chart', chart: { kind: 'grouped_time_series', metric } });
        assert.equal(chart.status, 200, JSON.stringify(chart.body)); assert.equal(chart.body.chart.kind, 'faceted_line');
        assertCompressedDelivery(chart);
        assert.equal(chart.body.chart.points.length, 8); assert.equal(chart.body.chart.facets.length, 4);
        const key = index === 0 ? 'value' : `${metric}_value`;
        for (const point of chart.body.chart.points) {
          const cell = saved.result.table.rows.find(row => row.entityId === point.yCell.entityId)?.cells[key];
          assert.ok(cell); assert.equal(point.yCell.key, key); assert.deepEqual(point.yCell.sourceIds, cell.sourceIds);
          assert.equal(point.y, cell.kind === 'number' ? cell.value.numeric * (metric === 'vacancy' ? 100 : 1) : null);
        }
        assert.equal((await acknowledge(queryAdmin, chart, 'client_dom_committed', { surface: 'chart', page: 0, pageSize: 25, layout: 'faceted_line_all' })).status, 200);
      }
      for (const format of ['csv_zip', 'svg_zip', 'xlsx']) {
        const file = await artifact(queryAdmin, { ...common, action: 'export', format,
          ...(format === 'svg_zip' ? { chart: { kind: 'grouped_time_series', metric: 'vacancy' } } : {}) });
        assert.equal(file.status, 200, JSON.stringify(file.body));
        if (format === 'xlsx') {
          const book = XLSX.read(file.bytes, { type: 'array' });
          const rows = XLSX.utils.sheet_to_json(book.Sheets['数据'], { header: 1 }); assert.equal(rows.length, 9);
          assert.ok(rows[0].some(value => String(value).includes('空置率'))); assert.ok(rows[0].some(value => String(value).includes('季度总面积')));
        } else {
          const zip = await JSZip.loadAsync(file.bytes), manifest = JSON.parse(await zip.file('manifest.json').async('string'));
          assert.deepEqual(manifest.sources, saved.result.sources); assert.deepEqual(manifest.parameters, saved.result.parameters);
          if (format === 'csv_zip') assert.match(await zip.file('data.csv').async('string'), /totalArea_value:精确值/);
          else { assert.equal(manifest.chart.points.length, 8); assert.match(await zip.file('chart.svg').async('string'), /<svg/); }
        }
      }
    });
    await check('交叉趋势：普通角色和缺少任一次指标字段都不能扩大数据读取', async () => {
      const ordinary = await person('viewer', 'cross-trend-viewer'); await grantQuery({ setup: db }, ordinary.id, { capabilities: exportCaps, fields });
      assert.equal((await query(plan(), ordinary)).status, 403);
      await grantQuery({ setup: db }, queryAdmin.id, { capabilities: exportCaps, fields: ['totalArea', 'netEffectiveRent'] });
      try {
        const denied = await query(); assert.equal(denied.status, 403); assert.equal((await recover(queryAdmin, saved.requestId)).status, 403);
        assert.equal((await db.query("select 1 from private.ai_query_audit_events where request_id=$1 and kind='tool_finished'", [denied.body.requestId])).rowCount, 0);
      } finally { await grantQuery({ setup: db }, queryAdmin.id, { capabilities: exportCaps, fields }); }
      limited = await person('admin', 'cross-trend-limited');
      await grantQuery({ setup: db }, limited.id, { capabilities: exportCaps, fields, allSubmarkets: false, submarkets: ['CBD'] });
      const p = plan(CROSS_TREND_METRICS, 'per_period', { scope: { inventory: 'tracked' } });
      limitedResult = await checked(await query(p, limited), p, BUILDINGS.slice(0, 2));
      assert.equal(limitedResult.result.table.rows.length, 4);
      assert.ok(!JSON.stringify(limitedResult.result).includes(BUILDINGS[2]));
    });
    await check('交叉趋势：参与楼宇移出当前权限、资格撤回及历史季度草稿均阻止旧结果恢复和图表导出', async () => {
      await db.query("update public.buildings set submarket='金融街' where id=$1", [BUILDINGS[0]]);
      try {
        assert.equal((await recover(limited, limitedResult.requestId)).status, 403);
        assert.equal((await artifact(limited, { requestId: limitedResult.requestId, resultId: limitedResult.result.resultId, action: 'chart', chart: { kind: 'grouped_time_series', metric: 'vacancy' } })).status, 403);
      } finally { await db.query("update public.buildings set submarket='CBD' where id=$1", [BUILDINGS[0]]); }
      await db.query('update public.building_metrics set is_draft=true where building_id=$1 and record_year=2026 and record_quarter=2', [BUILDINGS[0]]);
      try {
        assert.equal((await recover(queryAdmin, saved.requestId)).status, 403);
        assert.equal((await artifact(queryAdmin, { requestId: saved.requestId, resultId: saved.result.resultId, action: 'export', format: 'xlsx' })).status, 403);
      } finally { await db.query('update public.building_metrics set is_draft=false where building_id=$1 and record_year=2026 and record_quarter=2', [BUILDINGS[0]]); }
      await db.query('update private.ai_query_grants set enabled=false where user_id=$1', [limited.id]);
      assert.equal((await recover(limited, limitedResult.requestId)).status, 403);
    });
    await check('交叉趋势：旧来源协议拒绝恢复/图表/导出，恢复当前协议后原快照可用', async () => {
      const sql = await load('20261113145743_ai_query_group_dimensions.sql');
      assert.ok(sql.includes(",'source_policy','catalog-dimensions/1'"));
      await db.query(sql.replace(",'source_policy','catalog-dimensions/1'", ''));
      try {
        assert.equal((await recover(queryAdmin, saved.requestId)).status, 503);
        for (const action of [{ action: 'chart', chart: { kind: 'grouped_time_series', metric: 'vacancy' } }, { action: 'export', format: 'xlsx' }])
          assert.equal((await artifact(queryAdmin, { requestId: saved.requestId, resultId: saved.result.resultId, ...action })).status, 503);
      } finally { await db.query(sql); }
      assert.deepEqual((await recover(queryAdmin, saved.requestId)).body.result, saved.result);
    });
    await check('交叉趋势：真实50组合与1000指标点容量拒绝，不截断；旧单季度56格仍可执行', async () => {
      const ids = Array.from({ length: 8 }, () => randomUUID());
      try {
        for (const [i, id] of ids.entries()) {
          await db.query('insert into public.buildings(id,name,submarket,grade) values($1,$2,$3,$4)', [id, `交叉容量合成${i}`, `容量区${i % 7}`, `等级${i}`]);
          await db.query('insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,is_draft) values($1,2026,3,10000,100,1000,false)', [id]);
        }
        await grantQuery({ setup: db }, queryAdmin.id, { capabilities: exportCaps, fields, allBuildings: false, buildingIds: ids });
        const scope = { inventory: 'tracked' };
        const tooMany = await query(plan(CROSS_TREND_METRICS, 'per_period', { scope }));
        assert.equal(tooMany.status, 413); assert.equal(tooMany.body.reason, 'scope_limit'); assert.equal(Object.hasOwn(tooMany.body, 'result'), false);
        const single = await query({ operation: 'cross_aggregate', metric: 'rent', period: periods[1], scope });
        assert.equal(single.status, 200); assert.equal(single.body.result.table.rows.length, 56);
        for (const [i, id] of ids.entries()) await db.query('update public.buildings set submarket=$2,grade=$3 where id=$1', [id, `容量区${i % 5}`, `等级${i % 5}`]);
        const tooManyPoints = await query(plan(CROSS_TREND_METRICS, 'per_period', { scope, start: { year: 2016, quarter: 4 } }));
        assert.equal(tooManyPoints.status, 413); assert.equal(tooManyPoints.body.reason, 'scope_limit'); assert.equal(Object.hasOwn(tooManyPoints.body, 'result'), false);
        for (const response of [tooMany, tooManyPoints]) {
          assert.equal((await db.query('select state from private.ai_query_audit_streams where request_id=$1', [response.body.requestId])).rows[0].state, 'failed');
          assert.equal((await db.query("select 1 from private.ai_query_audit_events where request_id=$1 and kind in ('response_generated','succeeded')", [response.body.requestId])).rowCount, 0);
        }
      } finally {
        await db.query('delete from public.building_metrics where building_id=any($1::uuid[])', [ids]);
        await db.query('delete from public.buildings where id=any($1::uuid[])', [ids]);
        await grantQuery({ setup: db }, queryAdmin.id, { capabilities: exportCaps, fields });
      }
    });
  } finally {
    for (const row of original) await db.query('update public.buildings set submarket=$2,grade=$3 where id=$1', [row.id, row.submarket, row.grade]);
    await grantQuery({ setup: db }, queryAdmin.id, { capabilities: exportCaps, fields });
  }
}
