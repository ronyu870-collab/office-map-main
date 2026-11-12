// Disposable real PostgreSQL 17; uses the existing loopback-only lease harness.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createLeaseTestDatabase } from '../lease-change-history/database.mjs';

const fixture = await createLeaseTestDatabase();
const migration = new URL('../../migrations/20261111084119_lease_company_ai_assessment.sql', import.meta.url);
const openService = async () => {
  const client = new pg.Client({
    host: '127.0.0.1', port: Number(process.env.LEASE_TEST_PG_PORT), user: 'postgres',
    password: 'synthetic_ci_only', database: fixture.database, connectionTimeoutMillis: 5000,
  });
  await client.connect();
  await client.query("set statement_timeout='8s'; set role service_role");
  return client;
};
const claim = (client, policy, query, candidates) => client.query(
  'select * from public.lease_company_ai_claim_v1($1,$2,$2,$3)',
  [policy, query, JSON.stringify(candidates.map(name => ({ key: name, name })))],
);
const complete = (client, policy, results) => client.query(
  'select public.lease_company_ai_complete_v1($1,$2)', [policy, JSON.stringify(results)],
);
const hints = async (client, policy, query, scope) => (await client.query(
  'select * from public.lease_company_ai_hints_v1($1,$2,$3)', [policy, query, scope],
)).rows;
const clients = [];
try {
  await fixture.setup.query(`
    create table public.fixture_company_visibility (company text, record_source text);
    create view public.lease_transactions_read_v1 as select * from public.fixture_company_visibility;
    grant select on public.lease_transactions_read_v1 to service_role;
    insert into public.fixture_company_visibility values
      ('样本证券股份有限公司', 'live'), ('样本银行股份有限公司', 'live'),
      ('样本海外控股有限公司', 'history'), ('曾用名企业有限公司', 'live'),
      ('错误关联有限公司', 'live'), ('弱相关有限公司', 'live');
  `);
  await fixture.setup.query(await readFile(migration, 'utf8'));
  const [service, other] = await Promise.all([openService(), openService()]);
  clients.push(service, other);

  const concurrent = await Promise.all([
    claim(service, 'run', '并发示例', ['并发示例', '并发示例公司', '并发示例公司']),
    claim(other, 'run', '并发示例公司', ['并发示例']),
  ]);
  const claimed = concurrent.flatMap(result => result.rows);
  assert.equal(claimed.length, 1);
  await complete(service, 'wrong-version', [{ assessment_id: claimed[0].assessment_id, relation: 'same_company', strength: 'strong' }]);
  assert.equal((await service.query('select status from public.lease_company_ai_assessments')).rows[0].status, 'claimed');
  await complete(service, 'run', [{ assessment_id: claimed[0].assessment_id, relation: null, strength: null }]);
  await complete(other, 'run', [{ assessment_id: claimed[0].assessment_id, relation: 'same_company', strength: 'strong' }]);
  assert.equal((await service.query('select status from public.lease_company_ai_assessments')).rows[0].status, 'failed');
  assert.equal((await claim(other, 'run', '并发示例公司', ['并发示例'])).rowCount, 0);
  console.log('PASS concurrent and reversed pairs claim once; failed claims stay terminal');

  const contenders = [service, other];
  const admitted = await Promise.all(contenders.map(async (client, worker) => {
    let count = 0;
    for (let step = 0; step < 20; step++) {
      const result = await claim(client, 'budget', `预算示例${worker}-${step}`, ['测试一', '测试二', '测试三', '测试四', '测试五']);
      assert.ok(result.rowCount <= 4);
      count += result.rowCount;
    }
    return count;
  }));
  assert.equal(admitted[0] + admitted[1], 119); // One UTC-day slot already claimed above.
  assert.equal((await claim(service, 'another-policy', '预算已满', ['测试一'])).rowCount, 0);
  console.log('PASS four-pair request limit and shared 120-pair daily budget under contention');

  // A reviewed cohort is selected by completion order, never by correctness.
  const seed = (policy, kind, query, candidate, offset, reviewed, strength = 'strong') => fixture.setup.query(`
    insert into public.lease_company_ai_assessments (
      policy_key, key_a, key_b, name_a, name_b, status, relation, strength, completed_at, reviewed_relation, review_evidence
    )
    values ($1, least($3::text collate "C",$4::text collate "C"), greatest($3::text collate "C",$4::text collate "C"),
      $3, $4, 'scored', $2, $7, timestamptz '2026-10-01 00:00Z' + $5 * interval '1 second', $6,
      case when $6::text is not null then 'synthetic review evidence' end)
    returning id
  `, [policy, kind, query, candidate, offset, reviewed, strength]);
  const review = (id, relation) => fixture.setup.query(
    'update public.lease_company_ai_assessments set reviewed_relation=$2, review_evidence=$3 where id=$1',
    [id, relation, 'synthetic review evidence'],
  );
  await seed('pilot', 'same_company', '集团简称', '样本证券股份有限公司', 1, 'same_company');
  const sameIds = [];
  for (let i = 2; i <= 100; i++) {
    const reviewed = i >= 95 && i <= 99 ? 'uncertain' : i === 100 ? null : 'same_company';
    sameIds[i] = (await seed('pilot', 'same_company', `同名测试${i}`, `同一测试${i}`, i, reviewed)).rows[0].id;
  }
  await seed('pilot', 'related_company', '集团简称', '样本银行股份有限公司', 1, 'related_company');
  await seed('pilot', 'related_company', '集团简称', '样本海外控股有限公司', 2, 'related_company');
  for (let i = 3; i <= 100; i++) await seed('pilot', 'related_company', `关联测试${i}`, `关联示例${i}`, i, 'related_company');

  const related = { company: '样本银行股份有限公司', relation: 'related_company' };
  const same = { company: '样本证券股份有限公司', relation: 'same_company' };
  assert.deepEqual(await hints(service, 'pilot', '集团简称', 'live'), [related]); // Incomplete same-company sample.
  await review(sameIds[100], 'unrelated');
  assert.deepEqual(await hints(service, 'pilot', '集团简称', 'live'), [related]); // 94/100.
  await seed('pilot', 'same_company', '另一组合', '曾用名企业有限公司', 101, 'same_company');
  assert.deepEqual(await hints(service, 'pilot', '集团简称', 'live'), [related]); // Cannot skip earlier errors.
  await review(sameIds[100], 'same_company');
  assert.deepEqual(await hints(service, 'pilot', '集团简称', 'live'), [same, related]); // 95/100.
  assert.deepEqual(await hints(service, 'pilot', '集团简称', 'history'), [
    { company: '样本海外控股有限公司', relation: 'related_company' },
  ]);
  assert.equal((await hints(service, 'pilot', '集团简称', 'all')).length, 3);
  assert.deepEqual(await hints(service, 'pilot', '集团简称', 'bogus'), []);
  assert.deepEqual(await hints(service, 'new-policy', '集团简称', 'all'), []);
  await seed('pilot', 'same_company', '集团简称', '错误关联有限公司', 102, 'related_company');
  await seed('pilot', 'related_company', '集团简称', '弱相关有限公司', 103, null, 'uncertain');
  assert.deepEqual(await hints(service, 'pilot', '集团简称', 'live'), [same, related]); // Overruled/weak rows suppressed.
  await fixture.setup.query("delete from public.fixture_company_visibility where company = '样本证券股份有限公司'");
  assert.deepEqual(await hints(service, 'pilot', '集团简称', 'live'), [related]);
  await review(sameIds[100], 'uncertain');
  assert.deepEqual(await hints(service, 'pilot', '另一组合', 'live'), []); // Corrections close a gate.
  console.log('PASS separate calibration gates, fixed cohorts, review corrections, source scope and stale data');

  for (const role of ['anon', 'authenticated']) {
    await fixture.setup.query(`set role ${role}`);
    try {
      const denied = { code: '42501' };
      await assert.rejects(fixture.setup.query('select * from public.lease_company_ai_assessments'), denied);
      await assert.rejects(claim(fixture.setup, 'run', '演示名称', ['演示公司']), denied);
      await assert.rejects(complete(fixture.setup, 'run', []), denied);
      await assert.rejects(hints(fixture.setup, 'pilot', '集团简称', 'all'), denied);
      await assert.rejects(fixture.setup.query("select * from public.lease_company_ai_review_sample_v1('pilot','same_company')"), denied);
    } finally { await fixture.setup.query('reset role'); }
  }
  await assert.rejects(service.query("update public.lease_company_ai_assessments set reviewed_relation='same_company'"), { code: '42501' });
  await assert.rejects(service.query('delete from public.lease_company_ai_assessments'), { code: '42501' });
  console.log('PASS browser roles have no assessment access; runtime cannot label or erase reviews');
  console.log(fixture.version);
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
  await fixture.close();
}
