// Colliers AI 5.0 quarterly source regression: actual PostgreSQL 17, disposable schema only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createAiQueryTestDatabase, grantQuery, SESSION } from './database.mjs';
import { addSnapshotFixture, BUILDINGS } from './snapshot-fixture.mjs';
import { loadAuditPrerequisites, applyAdminOnly } from '../ai-admin-only/database.mjs';
import { OWNER, OTHER } from '../lease-change-history/database.mjs';

const db = await createAiQueryTestDatabase();
const migration = name => readFile(new URL('../../migrations/' + name, import.meta.url), 'utf8');
const names = value => value.periods.map(p => p.year + 'Q' + p.quarter);
async function service(sql, params = []) {
  await db.setup.query('begin');
  try {
    await db.setup.query('set local role service_role');
    const res = await db.setup.query(sql, params);
    await db.setup.query('commit');
    return res.rows[0]?.value;
  } catch (error) { await db.setup.query('rollback'); throw error; }
}
async function authority() {
  return service('select public.ai_query_authority($1,$1,$2) value', [OWNER, SESSION]);
}
async function periods(fieldList = ['totalArea', 'netEffectiveRent'], user = OWNER, revision) {
  const a = await authority();
  return service('select public.ai_query_available_periods($1,$2,$3,$4,$5,$6,$7,$8) value',
    [user, user, SESSION, revision ?? a.permission_revision, fieldList, 'tracked', ['CBD'], null]);
}
async function coverage(overrides = {}) {
  const a = await authority();
  const values = [overrides.actor ?? OWNER, overrides.actor ?? OWNER, overrides.session ?? SESSION,
    overrides.revision ?? a.permission_revision, overrides.fields ?? ['totalArea', 'netEffectiveRent'],
    overrides.year ?? 2026, overrides.quarter ?? 3, overrides.inventory ?? 'tracked',
    Object.hasOwn(overrides, 'submarkets') ? overrides.submarkets : ['CBD'],
    overrides.buildings ?? null];
  return service('select public.ai_query_quarterly_coverage($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value', values);
}
async function snapshot(quarter) {
  const a = await authority();
  return service('select public.ai_query_snapshot_read($1,$1,$2,$3,$4,$5,$6,$7,$8) value',
    [OWNER, SESSION, a.permission_revision, ['netEffectiveRent', 'totalArea'],
      JSON.stringify([{ year: 2026, quarter }]), 'tracked', ['CBD'], null]);
}
function check(name, body) {
  return Promise.resolve().then(body).then(() => { console.log('PASS AI5 ' + name); });
}
try {
  await loadAuditPrerequisites(db);
  await applyAdminOnly(db);
  await addSnapshotFixture(db);
  await db.setup.query(await migration('20261115103701_ai_query_available_periods.sql'));
  await db.setup.query("update public.user_roles set role='admin' where user_id=$1", [OWNER]);
  await db.setup.query('update private.ai_query_control set enabled=true');
  await grantQuery(db, OWNER);
  await db.setup.query('create table if not exists public.quarterly_submissions(' +
    'id uuid primary key default gen_random_uuid(),building_id uuid not null references public.buildings(id),' +
    'user_id uuid not null,record_year integer not null,record_quarter integer not null' +
    ' check (record_quarter between 1 and 4),total_area numeric,net_effective_rent numeric,' +
    'vacant_area numeric,created_at timestamptz default now(),updated_at timestamptz default now())');
  await db.setup.query('alter table public.quarterly_submissions enable row level security');
  await db.setup.query('update public.building_metrics set is_locked=false,locked_at=null,locked_by=null where record_year=2026 and record_quarter=3');
  const insert = async (building, area, rent, created) => db.setup.query(
    'insert into public.quarterly_submissions(building_id,user_id,record_year,record_quarter,' +
    'total_area,net_effective_rent,vacant_area,created_at,updated_at) values($1,$2,2026,3,$3,$4,100,$5,$5)',
    [building,OWNER,area,rent,created]);
  await insert(BUILDINGS[0], 10000, 120, '2026-08-01T00:00:00Z');
  await insert(BUILDINGS[0], 10000, 130, '2026-08-02T00:00:00Z');
  await insert(BUILDINGS[1], 0, 80, '2026-08-03T00:00:00Z');
  await insert(BUILDINGS[2], 3000, null, '2026-08-04T00:00:00Z');

  await check('OLD availability incorrectly exposes unlocked Q3: red-phase evidence', async () => {
    assert.ok(names(await periods()).includes('2026Q3'));
    const old = await snapshot(3);
    assert.equal(old.rows.filter(row => row.metrics.length > 0).length, 4);
  });

  await db.setup.query(await migration('20261120095500_ai5_quarterly_sources.sql'));

  await check('Q2 published coverage and existing numeric snapshot remain intact', async () => {
    assert.deepEqual(names(await periods()), ['2026Q2']);
    const s = await snapshot(2);
    assert.equal(s.rows.filter(row => row.metrics.length === 1).length, 4);
    const c = await coverage({ quarter: 2 });
    assert.equal(c.formal.valid_buildings, 4);
    assert.equal(c.formal.buildings, 4);
    assert.equal(c.submitted.rows, 0);
  });
  await check('Q3 unlocked metrics disappear from formal snapshot but submissions are visible as unreviewed aggregate', async () => {
    const c = await coverage();
    assert.equal(c.version, 'quarterly-source-coverage/1');
    assert.equal(c.catalog_buildings, 4);
    assert.equal(c.formal.valid_buildings, 0);
    assert.equal(c.formal.buildings, 0);
    assert.equal(c.formal.unlocked_rows, 4);
    assert.equal(c.submitted.rows, 4);
    assert.equal(c.submitted.buildings, 3);
    assert.equal(c.submitted.latest_rows, 3);
    assert.equal(c.submitted.superseded_rows, 1);
    assert.equal(c.submitted.latest_field_complete, 1);
    assert.equal(c.submitted.zero_area_latest, 1);
    assert.equal(c.submitted.missing_rent_latest, 1);
    assert.equal(c.overlap.buildings, 0);
    assert.equal(c.overlap.conflicting_values, 0);
    assert.ok(c.database_snapshot && c.permission_revision);
    const q3 = await snapshot(3);
    assert.ok(q3.rows.every(row => row.metrics.length === 0));
  });
  await check('one row per building despite historical submissions and same-period source switches', async () => {
    await db.setup.query(
      'update public.building_metrics set is_locked=true,locked_at=now(),locked_by=$1 where building_id=$2 and record_year=2026 and record_quarter=3',
      [OWNER, BUILDINGS[0]]);
    const c = await coverage();
    assert.equal(c.formal.buildings, 1);
    assert.equal(c.formal.valid_buildings, 1);
    assert.equal(c.submitted.buildings, 3);
    assert.equal(c.overlap.buildings, 1);
    assert.equal(c.overlap.conflicting_values, 1);
    assert.equal((await snapshot(3)).rows.filter(row => row.metrics.length === 1).length, 1);
    assert.deepEqual(names(await periods()), ['2026Q2', '2026Q3']);
  });
  await check('ungranted metric fields do not leak through quality or conflict counts', async () => {
    const onlyArea = await coverage({ fields: ['totalArea'] });
    assert.equal(onlyArea.submitted.missing_rent_latest, null);
    assert.equal(onlyArea.overlap.conflicting_values, 0);
    assert.equal(onlyArea.submitted.zero_area_latest, 1);
    const onlyRent = await coverage({ fields: ['netEffectiveRent'] });
    assert.equal(onlyRent.submitted.zero_area_latest, null);
    assert.equal(onlyRent.submitted.missing_rent_latest, 1);
    assert.equal(onlyRent.overlap.conflicting_values, 1);
  });
  await check('zero area, missing rent, invalid quarter and changing catalog scopes are not silently fixed', async () => {
    await db.setup.query("update public.buildings set submarket='金融街' where id=$1", [BUILDINGS[2]]);
    const c = await coverage();
    assert.equal(c.submitted.buildings, 2);
    assert.equal(c.submitted.latest_field_complete, 1);
    await assert.rejects(coverage({ quarter: 5 }), e => e.code === '22023');
    await assert.rejects(coverage({ fields: ['height'] }), e => e.code === '22023' || e.code === '42501');
    await db.setup.query("update public.buildings set submarket='CBD' where id=$1", [BUILDINGS[2]]);
  });
  await check('direct authenticated RPC prohibited, service needs current admin and independent grant', async () => {
    const a = await authority();
    const args = [OWNER, OWNER, SESSION, a.permission_revision, ['totalArea'],2026,3,'tracked',['CBD'],null];
    const signature = 'public.ai_query_quarterly_coverage(uuid,uuid,uuid,text,text[],integer,integer,text,text[],uuid[])';
    for (const role of ['anon','authenticated','service_role']) {
      const has = (await db.setup.query('select has_function_privilege($1,$2,$3) value',[role,signature,'execute'])).rows[0].value;
      assert.equal(has, role === 'service_role');
    }
    await assert.rejects(db.asUser(OWNER,'select public.ai_query_quarterly_coverage($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',args),
      error => error.code === '42501');
    await assert.rejects(coverage({ actor: OTHER }), error => error.code === '42501');
    await assert.rejects(coverage({ session: randomUUID() }), error => error.code === '42501');
    await assert.rejects(coverage({ revision: 'f'.repeat(64) }), error => error.code === '42501');
    await grantQuery(db,OWNER,{ allSubmarkets:false,submarkets:['CBD'] });
    await assert.rejects(coverage({ submarkets: ['金融街'] }), error => error.code === '42501');
    await db.setup.query("update public.user_roles set role='viewer' where user_id=$1", [OWNER]);
    await assert.rejects(coverage(), error => error.code === '42501');
    await db.setup.query("update public.user_roles set role='admin' where user_id=$1", [OWNER]);
    await db.setup.query('update private.ai_query_grants set enabled=false where user_id=$1', [OWNER]);
    await assert.rejects(coverage(), error => error.code === '42501');
  });
  console.log('PASS AI5 all PostgreSQL 17 quarterly source regressions');
} finally { await db.close(); }
