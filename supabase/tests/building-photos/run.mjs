// Only a disposable localhost PostgreSQL 17 service is accepted. No remote URL,
// ambient PG* credentials or production records can enter this harness.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

assert.ok(process.env.GITHUB_ACTIONS === 'true' || process.env.PHOTO_TEST_ALLOW_LOCAL === 'disposable', 'Use a disposable CI service or explicitly acknowledge the disposable local service');
const port = Number(process.env.PHOTO_TEST_PG_PORT);
assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'Missing disposable PostgreSQL service port');
const config = { host: '127.0.0.1', port, user: 'postgres', password: 'synthetic_ci_only', connectionTimeoutMillis: 5000 };
const admin = new pg.Client({ ...config, database: 'postgres' });
const database = `photos_synthetic_${randomUUID().replaceAll('-', '')}`;
const building = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
let setup;
let created = false;
let checks = 0;
await admin.connect();
try {
  const version = (await admin.query("select current_setting('server_version_num')::int as n, version() as version")).rows[0];
  assert.ok(version.n >= 170000 && version.n < 180000, 'PostgreSQL 17 required');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    if (!(await admin.query('select 1 from pg_roles where rolname=$1', [role])).rowCount) await admin.query(`create role ${role}`);
  }
  await admin.query(`create database ${database}`);
  created = true;
  setup = new pg.Client({ ...config, database });
  await setup.connect();
  await setup.query("set statement_timeout='8s'");
  await setup.query('create table public.buildings (id uuid primary key); grant usage on schema public to anon, authenticated, service_role');
  await setup.query('insert into public.buildings (id) values ($1),($2)', [building, other]);
  const migration = await readFile(new URL('../../migrations/20261105153236_building_photos.sql', import.meta.url), 'utf8');
  await setup.query(migration);

  async function asRole(role, sql, args = [], appRole = 'viewer') {
    assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
    await setup.query('begin');
    try {
      await setup.query('select set_config(\'request.jwt.claims\',$1,true)', [JSON.stringify({ sub: building, app_metadata: { role: appRole } })]);
      await setup.query(`set local role ${role}`);
      const result = await setup.query(sql, args);
      await setup.query('commit');
      return result;
    } catch (error) {
      await setup.query('rollback');
      throw error;
    }
  }
  const fresh = (patch = {}) => {
    const id = randomUUID();
    return { id, building_id: building, image_url: `https://images.example.com/${id}.jpg`, source_url: 'https://www.example.com/building', caption: '外观照片', ...patch };
  };
  const insert = (row, role = 'service_role') => {
    const fields = Object.keys(row);
    // Field names are controlled by this fixture, never by external input.
    return asRole(role, `insert into public.building_photos (${fields.join(',')}) values (${fields.map((_, i) => `$${i + 1}`).join(',')}) returning *`, Object.values(row));
  };
  const rejected = async (operation, code) => { await assert.rejects(operation, error => error.code === code); checks += 1; };
  const first = fresh();
  const inserted = (await insert(first)).rows[0];
  assert.equal(inserted.status, 'pending');
  assert.equal(inserted.source_name, '');
  assert.equal(inserted.storage_path, null);
  assert.ok(inserted.collected_at instanceof Date);
  assert.equal((await setup.query("select relrowsecurity from pg_class where oid='public.building_photos'::regclass")).rows[0].relrowsecurity, true);
  checks += 5;

  for (const role of ['anon', 'authenticated']) {
    for (const appRole of ['viewer', 'editor', 'admin']) {
      for (const sql of [
        'select * from public.building_photos',
        "update public.building_photos set caption='改写'",
        'delete from public.building_photos',
        "insert into public.building_photos (building_id,image_url,source_url,caption) values ('11111111-1111-4111-8111-111111111111','https://images.example.com/forbidden.jpg','https://www.example.com/','禁止')",
      ]) await rejected(() => asRole(role, sql, [], appRole), '42501');
    }
  }

  // RLS independently blocks browser roles even if someone later grants table privileges.
  await setup.query('grant select, insert, update, delete on public.building_photos to authenticated');
  assert.equal((await asRole('authenticated', 'select * from public.building_photos')).rowCount, 0);
  assert.equal((await asRole('authenticated', "update public.building_photos set caption='改写'")).rowCount, 0);
  assert.equal((await asRole('authenticated', 'delete from public.building_photos')).rowCount, 0);
  await rejected(() => insert(fresh(), 'authenticated'), '42501');
  await setup.query('revoke all on public.building_photos from authenticated');
  checks += 3;

  for (const patch of [
    { image_url: 'http://images.example.com/photo.jpg' }, { image_url: 'javascript:alert(1)' },
    { source_url: 'file:///private' }, { caption: '' }, { caption: '   ' }, { caption: '图'.repeat(161) },
    { source_name: '源'.repeat(161) }, { photo_kind: 'owner-confirmed' }, { status: 'published' },
    { attribution_text: '字'.repeat(501) }, { license_url: 'http://creativecommons.org/licenses/by-sa/4.0/' },
    { sort_order: -1 }, { width: 0 }, { height: -1 }, { file_size: 0 }, { sha256: 'not-a-digest' },
    { storage_path: 'another-bucket/private.jpg' },
  ]) await rejected(() => insert(fresh(patch)), '23514');
  await rejected(() => insert(fresh({ building_id: randomUUID() })), '23503');
  await rejected(() => insert(fresh({ image_url: first.image_url })), '23505');
  await insert(fresh({ building_id: other, image_url: first.image_url, source_url: 'http://www.example.com/original' }));
  checks += 1;

  const cloud = fresh({ status: 'ready', width: 1200, height: 800, file_size: 54321, sha256: 'a'.repeat(64), attribution_text: '摄影：合成夹具 / CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/' });
  cloud.storage_path = `building-photos/v1/${building}/${cloud.id}/exterior.webp`;
  await insert(cloud);
  const wrongOwner = fresh({ ...cloud, id: randomUUID(), image_url: 'https://images.example.com/wrong-owner.jpg' });
  await rejected(() => insert(wrongOwner), '23514');
  await rejected(() => asRole('service_role', 'update public.building_photos set sha256=null where id=$1', [cloud.id]), '23514');
  await rejected(() => setup.query('delete from public.buildings where id=$1', [building]), '23503');
  assert.equal((await asRole('service_role', "select id from public.building_photos where status='ready'")).rowCount, 1);
  await asRole('service_role', "update public.building_photos set status='archived' where id=$1", [cloud.id]);
  assert.equal((await asRole('service_role', "select id from public.building_photos where status='ready'")).rowCount, 0);
  await asRole('service_role', 'delete from public.building_photos where id=$1', [cloud.id]);
  assert.equal((await asRole('service_role', 'select id from public.building_photos where id=$1', [cloud.id])).rowCount, 0);
  checks += 3;
  console.log(JSON.stringify({ suite: 'building-photos', postgres: version.version, checks, status: 'passed', fixtures: 'synthetic only' }));
} finally {
  await setup?.end().catch(() => {});
  if (created) await admin.query(`drop database ${database} with (force)`);
  await admin.end();
}
