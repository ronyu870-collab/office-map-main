import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { BUILDINGS } from '../../supabase/tests/ai-query-authority/snapshot-fixture.mjs';

/** Actual GoTrue -> production-built Next -> PostgREST -> disposable PG17.
 * The SQL oracle is independent of the application formula implementation.
 * Synthetic rows and grant changes are restored before returning to the harness. */
export async function verifyMultiMetricAnalysis({ db, check, queryAdmin, call, recover, artifact, exportCaps }) {
  assert.equal(process.env.AI_QUERY_AUTH_ALLOW_LOCAL, 'disposable');
  assert.equal(db.connectionParameters.host, '127.0.0.1');
  assert.equal(Number(db.connectionParameters.port), 55992);
  const original = (await db.query('select id,submarket,grade from public.buildings where id=any($1::uuid[]) order by id', [BUILDINGS])).rows;
  const query = question => call(queryAdmin, { idempotencyKey: randomUUID(), question, conversation: { id: randomUUID() } });
  const fields = ['height', 'totalArea', 'netEffectiveRent', 'vacantArea'];
  let response;
  try {
    await grantQuery({ setup: db }, queryAdmin.id, { capabilities: exportCaps, fields });
    await db.query("update public.buildings set submarket=case when id=any($1::uuid[]) then 'CBD' else '金融街' end,grade=case when id=any($1::uuid[]) then 'A' else 'B' end where id=any($2::uuid[])", [[BUILDINGS[0], BUILDINGS[2]], BUILDINGS]);
    await check('P1多指标：同一获权快照按子市场同时计算租金和空置率，与独立SQL逐组核对', async () => {
      const result = await query('2026Q3 CBD、金融街净有效租金和空置率按子市场比较');
      assert.equal(result.status, 200, JSON.stringify(result.body)); response = result.body;
      const r = result.body.result;
      assert.equal(r.operation, 'group_aggregate');
      assert.deepEqual(r.parameters.metrics, ['rent', 'vacancy']);
      assert.deepEqual(r.parameters.executedPlan.metrics, ['rent', 'vacancy']);
      const oracle = (await db.query(`select b.submarket,
        sum(m.net_effective_rent*m.total_area) filter(where m.total_area>0 and m.net_effective_rent>0)/nullif(sum(m.total_area) filter(where m.total_area>0 and m.net_effective_rent>0),0) rent,
        sum(m.vacant_area) filter(where m.total_area>0 and m.vacant_area>=0 and m.vacant_area<=m.total_area)/nullif(sum(m.total_area) filter(where m.total_area>0 and m.vacant_area>=0 and m.vacant_area<=m.total_area),0) vacancy,
        count(*) filter(where m.total_area>0 and m.net_effective_rent>0)::int rent_count,
        count(*) filter(where m.total_area>0 and m.vacant_area>=0 and m.vacant_area<=m.total_area)::int vacancy_count,
        sum(m.total_area) filter(where m.total_area>0 and m.net_effective_rent>0) rent_denominator,
        sum(m.total_area) filter(where m.total_area>0 and m.vacant_area>=0 and m.vacant_area<=m.total_area) vacancy_denominator
        from public.buildings b join public.building_metrics m on m.building_id=b.id
        where b.id=any($1::uuid[]) and m.record_year=2026 and m.record_quarter=3 and not m.is_draft group by b.submarket`, [BUILDINGS])).rows;
      assert.equal(r.table.rows.length, oracle.length);
      for (const expected of oracle) {
        const row = r.table.rows.find(row => row.cells.name.value === expected.submarket);
        assert.ok(row);
        for (const [key, value] of [['value', expected.rent], ['vacancy_value', expected.vacancy], ['usedCount', expected.rent_count],
          ['vacancy_usedCount', expected.vacancy_count], ['denominator', expected.rent_denominator], ['vacancy_denominator', expected.vacancy_denominator]]) {
          if (value === null) assert.equal(row.cells[key].kind, 'unknown');
          else assert.ok(Math.abs(row.cells[key].value.numeric - Number(value)) < 1e-10, `${expected.submarket} ${key}`);
        }
      }
      assert.equal(new Set(r.sources.map(source => source.id)).size, r.sources.length);
      const known = new Set(r.sources.map(source => source.id));
      for (const row of r.table.rows) for (const cell of Object.values(row.cells)) assert.ok(cell.sourceIds.every(id => known.has(id)));
      const actions = (await db.query("select kind,count(*)::int count from private.ai_query_audit_events where request_id=$1 and kind in ('tool_started','tool_finished') group by kind", [result.body.requestId])).rows;
      // The existing audit protocol records the validated plan as one
      // tool_finished event; deterministic questions have no provider start.
      assert.deepEqual(Object.fromEntries(actions.map(row => [row.kind, row.count])), { tool_finished: 1 });
    });

    await check('P1多指标：恢复、图表和CSV保存两项完整来源，不把空置率图绑定到租金列', async () => {
      assert.ok(response);
      const restored = await recover(queryAdmin, response.requestId);
      assert.equal(restored.status, 200); assert.deepEqual(restored.body.result, response.result);
      const chart = await artifact(queryAdmin, { requestId: response.requestId, resultId: response.result.resultId,
        action: 'chart', chart: { kind: 'bar', field: 'value', metric: 'vacancy' } });
      assert.equal(chart.status, 200); assert.equal(chart.body.chart.yUnit, 'ratio');
      assert.ok(chart.body.chart.points.every(point => point.yCell.key === 'vacancy_value'));
      for (const point of chart.body.chart.points) {
        const cell = response.result.table.rows.find(row => row.entityId === point.yCell.entityId).cells.vacancy_value;
        assert.deepEqual(point.yCell.sourceIds, cell.sourceIds);
        assert.equal(point.y, cell.kind === 'number' ? cell.value.numeric * 100 : null);
      }
      const file = await artifact(queryAdmin, { requestId: response.requestId, resultId: response.result.resultId, action: 'export', format: 'csv_zip' });
      assert.equal(file.status, 200);
      const zip = await JSZip.loadAsync(file.bytes), manifest = JSON.parse(await zip.file('manifest.json').async('string'));
      assert.deepEqual(manifest.sources, response.result.sources); assert.deepEqual(manifest.analysis, response.result.analysis);
      assert.deepEqual(manifest.parameters.metrics, ['rent', 'vacancy']);
      assert.match(await zip.file('data.csv').async('string'), /vacancy_value:精确值/);
    });

    await check('P1多指标：共同样本按指标分别配对，缺期和百分点不被另一指标覆盖', async () => {
      const result = await query('CBD、金融街净有效租金和空置率2026Q2至2026Q3按子市场趋势全期间共同样本');
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.result.operation, 'group_trend');
      const series = result.body.result.parameters.researchAnalysis.series;
      assert.equal(series.length, 4);
      const financialRent = series.find(item => item.metric === 'rent' && item.label.includes('金融街'));
      const financialVacancy = series.find(item => item.metric === 'vacancy' && item.label.includes('金融街'));
      assert.deepEqual(financialRent.commonEntityIds, [BUILDINGS[1], BUILDINGS[3]]);
      assert.deepEqual(financialVacancy.commonEntityIds, [BUILDINGS[1]]);
      assert.equal(financialVacancy.overall.changeUnit, 'percentage_point');
      assert.equal(financialVacancy.overall.change.numeric, 10);
      const missing = await query('2020Q1 CBD净有效租金和空置率');
      assert.equal(missing.status, 200);
      for (const key of ['value', 'vacancy_value']) assert.equal(missing.body.result.table.rows[0].cells[key].kind, 'unknown');
    });

    await check('P1多指标最新期：不同楼宇各自提供有效指标时仍使用真实共同季度，不强求同楼联合有效', async () => {
      const ids = [];
      try {
        for (const [building, rent, vacant] of [[BUILDINGS[0], 120, null], [BUILDINGS[2], null, 2000]]) {
          const created = await db.query('insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,is_draft) values($1,2027,1,10000,$2,$3,false) returning id', [building, rent, vacant]);
          ids.push(created.rows[0].id);
        }
        const result = await query('CBD最新季度净有效租金和空置率');
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.deepEqual(result.body.result.parameters.executedPlan.period, { year: 2027, quarter: 1 });
        const row = result.body.result.table.rows[0];
        assert.equal(row.cells.value.value.numeric, 120); assert.equal(row.cells.vacancy_value.value.numeric, .2);
        assert.equal(row.cells.usedCount.value.numeric, 1); assert.equal(row.cells.vacancy_usedCount.value.numeric, 1);
        const series = result.body.result.parameters.researchAnalysis.series;
        assert.deepEqual(series.find(item => item.metric === 'rent').periods[0].usedEntityIds, [BUILDINGS[0]]);
        assert.deepEqual(series.find(item => item.metric === 'vacancy').periods[0].usedEntityIds, [BUILDINGS[2]]);
      } finally { if (ids.length) await db.query('delete from public.building_metrics where id=any($1::bigint[])', [ids]); }
    });

    await check('P1多指标真实父轮：改分组与共同/各期样本保留指标和季度，每轮只读取一次事实快照', async () => {
      const originalDefinition = (await db.query("select pg_get_functiondef('public.ai_query_snapshot_read(uuid,uuid,uuid,text,text[],jsonb,text,text[],uuid[])'::regprocedure) definition")).rows[0].definition;
      const probe = `ai_query_multi_probe_${randomUUID().replaceAll('-', '')}`;
      await db.query(`create sequence private.${probe}; revoke all on sequence private.${probe} from public,anon,authenticated; grant usage on sequence private.${probe} to service_role`);
      try {
        // Count real PostgREST calls; keep the existing private authorization,
        // row visibility and complete SQL statement untouched. Disposable only.
        await db.query(`create or replace function public.ai_query_snapshot_read(p_actor uuid,p_effective uuid,p_session uuid,p_permission_revision text,p_fields text[],p_periods jsonb,p_inventory text,p_submarkets text[],p_building_ids uuid[]) returns jsonb language plpgsql security invoker set search_path='' as $$ begin
          perform nextval('private.${probe}'::regclass);
          return private.ai_query_snapshot_read(p_actor,p_effective,p_session,p_permission_revision,p_fields,p_periods,p_inventory,p_submarkets,p_building_ids);
        end $$`);
        // The formerly rejected two-axis trend now has its own positive HTTP
        // regression. An unauthorized third dimension must still fail before
        // a fact read or provider call; never silently drop that condition.
        const rejected = await query('CBD、金融街净有效租金和空置率2026Q2至2026Q3按等级和楼龄趋势各期样本');
        assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
        assert.equal(rejected.body.reason, 'unsupported');
        assert.equal((await db.query(`select is_called from private.${probe}`)).rows[0].is_called, false);
        assert.equal((await db.query("select 1 from private.ai_query_audit_events where request_id=$1 and kind='tool_started'", [rejected.body.requestId])).rowCount, 0);
        const conversation = { id: randomUUID() }, bodies = []; let parentRequestId;
        const steps = [
          ['CBD净有效租金和空置率2026Q2至2026Q3按等级趋势各期样本', 'grade', 'per_period', ['rent', 'vacancy'], ['CBD']],
          ['按子市场比较CBD、金融街呢', 'submarket', 'per_period', ['rent', 'vacancy'], ['CBD', '金融街']],
          ['共同有效样本呢', 'submarket', 'paired', ['rent', 'vacancy'], ['CBD', '金融街']],
          ['各期样本呢', 'submarket', 'per_period', ['rent', 'vacancy'], ['CBD', '金融街']],
          ['空置率呢', 'submarket', 'per_period', ['vacancy'], ['CBD', '金融街']],
        ];
        for (const [index, [question, groupBy, mode, metrics, submarkets]] of steps.entries()) {
          const body = { idempotencyKey: randomUUID(), question, conversation: { ...conversation, ...(parentRequestId ? { parentRequestId } : {}) } };
          bodies.push(body);
          const result = await call(queryAdmin, body);
          assert.equal(result.status, 200, JSON.stringify(result.body));
          const p = result.body.result.parameters.executedPlan;
          assert.equal(p.operation, 'group_trend'); assert.equal(p.groupBy, groupBy); assert.equal(p.mode, mode);
          assert.deepEqual(p.scope.submarkets, submarkets);
          assert.deepEqual(p.start, { year: 2026, quarter: 2 }); assert.deepEqual(p.end, { year: 2026, quarter: 3 });
          assert.equal(p.metric, metrics[0]);
          if (metrics.length > 1) assert.deepEqual(p.metrics, metrics); else assert.equal(Object.hasOwn(p, 'metrics'), false);
          assert.equal(Number((await db.query(`select last_value from private.${probe}`)).rows[0].last_value), index + 1);
          const actions = (await db.query("select kind,count(*)::int count from private.ai_query_audit_events where request_id=$1 and kind in ('tool_started','tool_finished') group by kind", [result.body.requestId])).rows;
          assert.deepEqual(Object.fromEntries(actions.map(row => [row.kind, row.count])), { tool_finished: 1 });
          parentRequestId = result.body.requestId;
        }
        const replay = await call(queryAdmin, bodies[1]);
        assert.equal(replay.status, 202);
        assert.equal(Number((await db.query(`select last_value from private.${probe}`)).rows[0].last_value), steps.length);
      } finally {
        await db.query(originalDefinition);
        await db.query(`drop sequence private.${probe}`);
      }
    });

    await check('P1范围限制：真实网关54000错误保留失败审计并返回可缩小范围的413，不伪造结果或后台任务', async () => {
      const originalDefinition = (await db.query("select pg_get_functiondef('public.ai_query_snapshot_read(uuid,uuid,uuid,text,text[],jsonb,text,text[],uuid[])'::regprocedure) definition")).rows[0].definition;
      let limited;
      try {
        // Explicit failure injection for the existing DB resource-error branch;
        // this does not claim to be a production or large-inventory load test.
        await db.query("create or replace function public.ai_query_snapshot_read(p_actor uuid,p_effective uuid,p_session uuid,p_permission_revision text,p_fields text[],p_periods jsonb,p_inventory text,p_submarkets text[],p_building_ids uuid[]) returns jsonb language plpgsql security invoker set search_path='' as $$ begin raise exception using errcode='54000',message='QUERY_SCOPE_REQUIRES_BACKGROUND_JOB'; end $$");
        limited = await call(queryAdmin, { idempotencyKey: randomUUID(), question: '合成范围限制验证', plan: {
          operation: 'aggregate', metric: 'rent', metrics: ['rent', 'vacancy'], period: { year: 2026, quarter: 3 }, scope: { inventory: 'tracked', submarkets: ['CBD'] },
        } });
        assert.equal(limited.status, 413); assert.equal(limited.body.status, 'failed'); assert.equal(limited.body.reason, 'scope_limit');
        assert.equal(Object.hasOwn(limited.body, 'result'), false); assert.match(limited.body.error, /缩小.*子市场.*季度.*指标/);
        assert.doesNotMatch(limited.body.error, /后台|稍后重试/);
      } finally { await db.query(originalDefinition); }
      assert.equal((await db.query('select state from private.ai_query_audit_streams where request_id=$1', [limited.body.requestId])).rows[0].state, 'failed');
      assert.equal((await db.query("select 1 from private.ai_query_audit_events where request_id=$1 and kind in ('response_generated','succeeded')", [limited.body.requestId])).rowCount, 0);
      const status = await recover(queryAdmin, limited.body.requestId);
      assert.equal(status.status, 200); assert.equal(status.body.status, 'failed'); assert.equal(Object.hasOwn(status.body, 'result'), false);
    });

    await check('P1多指标权限：缺少任一指标字段则整体拒绝，旧结果撤权恢复同样拒绝', async () => {
      await grantQuery({ setup: db }, queryAdmin.id, { capabilities: exportCaps, fields: ['totalArea', 'netEffectiveRent'] });
      try {
        const denied = await call(queryAdmin, { idempotencyKey: randomUUID(), question: '2026Q3 CBD净有效租金和空置率',
          plan: { operation: 'aggregate', metric: 'rent', metrics: ['rent', 'vacancy'], period: { year: 2026, quarter: 3 }, scope: { inventory: 'tracked', submarkets: ['CBD'] } } });
        assert.equal(denied.status, 403);
        const finished = await db.query("select 1 from private.ai_query_audit_events where request_id=$1 and kind='tool_finished'", [denied.body.requestId]);
        assert.equal(finished.rowCount, 0);
        assert.equal((await recover(queryAdmin, response.requestId)).status, 403);
      } finally { await grantQuery({ setup: db }, queryAdmin.id, { capabilities: exportCaps, fields }); }
    });
  } finally {
    for (const row of original) await db.query('update public.buildings set submarket=$2,grade=$3 where id=$1', [row.id, row.submarket, row.grade]);
    await grantQuery({ setup: db }, queryAdmin.id, { capabilities: exportCaps, fields });
  }
}
