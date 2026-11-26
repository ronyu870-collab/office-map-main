import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { ADMIN, createLeaseTestDatabase } from '../lease-change-history/database.mjs';
import { readEdition } from '../../../scripts/submarket-research/edition.mjs';
import { verifySubmarketHttp } from './http.mjs';
import { editionImportSql } from '../../../scripts/submarket-research/import-edition.mjs';

const source = name => readFile(new URL('../../migrations/' + name, import.meta.url), 'utf8');
const db = await createLeaseTestDatabase();
const sql = db.setup;
const edition = readEdition();
const updatedAt = '2026-11-20T04:55:02.983Z';
const config = { host: '127.0.0.1', port: Number(process.env.LEASE_TEST_PG_PORT),
  user: 'postgres', password: 'synthetic_ci_only', database: db.database };

async function one(query, args) {
  return (await sql.query(query, args)).rows[0];
}

try {
  await sql.query(await source('20261119122000_map_submarket_profiles.sql'));
  await sql.query(await source('20261120123000_submarket_client_publication.sql'));
  await sql.query(`
    create table public.buildings (
      id uuid primary key, submarket text, is_active boolean default true,
      tracking_scope text default 'tracked', project_type text
    );
    grant select, insert on public.audit_logs to service_role;
    grant usage on sequence public.audit_logs_id_seq to service_role;
    alter role service_role bypassrls;
  `);
  for (const row of edition) {
    await sql.query(`insert into public.map_submarket_profiles(submarket,headline,overview,industries,transport,updated_at,is_published,published_at)
      values ($1,'某区域旧版定位','某区域旧版资料','既有产业资料','既有交通资料',$2,$1 <> '燕莎',$2)`, [row.market, updatedAt]);
    for (const project of row.projects) {
      await sql.query('insert into public.buildings(id,submarket) values ($1,$2)', [project.buildingId, row.market]);
    }
  }
  const migration = await source('20261126164732_map_submarket_structured_research.sql');
  await sql.query(migration);
  await sql.query(migration);
  for (const role of ['anon', 'authenticated']) {
    await sql.query(`set role ${role}`);
    await assert.rejects(sql.query('select research from public.map_submarket_profiles'), { code: '42501' });
    await assert.rejects(sql.query('select research from public.map_submarket_research_versions'), { code: '42501' });
    await assert.rejects(sql.query("update public.map_submarket_profiles set research=null where submarket='CBD'"), { code: '42501' });
    await sql.query('reset role');
  }
  const cbd = edition.find(item => item.market === 'CBD');
  const id = cbd.projects[0].buildingId;
  await sql.query("update buildings set submarket='燕莎' where id=$1", [id]);
  await assert.rejects(sql.query(editionImportSql(edition, true)), /outside its active market/);
  await sql.query('rollback');
  assert.equal((await one('select count(research)::int as n from map_submarket_profiles')).n, 0);
  await sql.query("update buildings set submarket='CBD' where id=$1", [id]);

  // An audit failure in the import must roll back profiles and snapshots.
  await sql.query("alter table public.audit_logs add constraint fixture_fail check (action_type <> 'ADMIN_DATA_OPERATION')");
  await assert.rejects(sql.query(editionImportSql(edition, true)), { code: '23514' });
  await sql.query('rollback');
  assert.equal((await one('select count(research)::int as n from map_submarket_profiles')).n, 0);
  assert.equal((await one('select count(*)::int as n from map_submarket_research_versions')).n, 0);
  await sql.query('alter table public.audit_logs drop constraint fixture_fail');
  await sql.query(editionImportSql(edition, false));
  assert.equal((await one('select count(research)::int as n from map_submarket_profiles')).n, 0);
  await sql.query(editionImportSql(edition, true));
  await sql.query(editionImportSql(edition, true));
  assert.equal((await one('select count(research)::int as n from map_submarket_profiles')).n, 15);
  assert.equal((await one('select count(*)::int as n from map_submarket_research_versions')).n, 15);
  assert.equal((await one("select count(*)::int as n from audit_logs where details->>'operation'='auto_publish_structured_research'")).n, 15);
  assert.deepEqual(await one("select research,headline,overview,is_published from map_submarket_profiles where submarket='CBD'"),
    { research: cbd, headline: '某区域旧版定位', overview: '某区域旧版资料', is_published: true });
  assert.equal((await one("select research from map_submarket_profiles where submarket='燕莎'")).research, null);

  await sql.query("update map_submarket_profiles set is_published=true where submarket='燕莎'");
  await sql.query(editionImportSql(edition, true));
  assert.equal((await one('select count(research)::int as n from map_submarket_profiles')).n, 16);

  // Two editors loaded the same edition. The same update predicate as the REST
  // write must affect exactly one row even when PostgreSQL waits on a row lock.
  const tx1 = new pg.Client(config);
  const tx2 = new pg.Client(config);
  await Promise.all([tx1.connect(), tx2.connect()]);
  try {
    const before = await one("select updated_at::text as token from map_submarket_profiles where submarket='CBD'");
    const update = `update map_submarket_profiles set research=$1,updated_at=clock_timestamp(),updated_by=$2
      where submarket='CBD' and updated_at=$3 returning research`;
    const draft = { ...cbd, positioning: '并发验证后的新定位' };
    await Promise.all([tx1.query('begin; set local role service_role'), tx2.query('set role service_role')]);
    assert.equal((await tx1.query(update, [draft, ADMIN, before.token])).rowCount, 1);
    const competing = tx2.query(update, [{ ...cbd, positioning: '过期编辑' }, ADMIN, before.token]);
    await tx1.query('commit');
    assert.equal((await competing).rowCount, 0);
    assert.equal((await one("select research from map_submarket_profiles where submarket='CBD'")).research.positioning, draft.positioning);
    const previous = await one("select research, was_published, replaced_by from map_submarket_research_versions where submarket='CBD' and research is not null");
    assert.deepEqual(previous, { research: cbd, was_published: true, replaced_by: ADMIN });
    await tx2.query("update map_submarket_profiles set research=research where submarket='CBD'");
    assert.equal((await one("select count(*)::int as n from map_submarket_research_versions where submarket='CBD'")).n, 2);

    await assert.rejects(tx2.query("update map_submarket_profiles set research=$1 where submarket='CBD'",
      [{ ...draft, market: '燕莎' }]), { code: '23514' });
    await assert.rejects(tx2.query("delete from map_submarket_research_versions where submarket='CBD'"), { code: '42501' });
    // Roll back the structured edition to the prior legacy presentation; a rerun of
    // the deterministic import respects that explicit choice.
    await tx2.query("update map_submarket_profiles set research=null where submarket='CBD'");
    await sql.query(editionImportSql(edition, true));
    assert.equal((await one("select research from map_submarket_profiles where submarket='CBD'")).research, null);
    assert.equal((await one("select count(*)::int as n from map_submarket_research_versions where submarket='CBD'")).n, 3);
  } finally {
    await Promise.all([tx1.end(), tx2.end()]);
  }
  if (process.argv.includes('--http')) await verifySubmarketHttp(db, edition, source);
  console.log(`${db.version}: structured import, audit rollback, denied roles, concurrency, version restore and idempotency passed`);
} finally {
  await db.close();
}
