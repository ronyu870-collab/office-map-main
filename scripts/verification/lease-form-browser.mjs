// Actual form controls, Auth, HTTP and database. Only synthetic, disposable local data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// The expiry screen is read-only: entry and return need no unsaved-input workflow.
export async function verifyLeaseExpiryNavigation({ page, app, company }) {
  await page.goto(app + '/lease-submission');
  await page.getByRole('link', { name: '租约到期', exact: true }).click();
  await page.waitForURL(app + '/lease-submission/expiry');
  await page.getByRole('cell').filter({ hasText: company }).waitFor();
  assert.equal(await page.locator('form').count(), 0);
  await page.getByRole('link', { name: '返回租赁成交', exact: true }).click();
  await page.waitForURL(app + '/lease-submission');
}

export async function verifyLeaseFormWorkflow({ page, db, app, actorId, dataClient }) {
  assert.equal(new URL(app).hostname, '127.0.0.1');
  assert.ok([55792, 55892].includes(Number(db.connectionParameters.port)));
  const suffix = randomUUID().slice(0, 8);
  const company = '合成完整表单验收 ' + suffix;
  const building = '合成表单楼宇 ' + suffix;
  const industry = '合成验收行业 ' + suffix;
  const buildingId = randomUUID(), industryId = randomUUID(), seedId = randomUUID();
  const load = file => readFile(file, 'utf8');
  const context = page.context();
  const now = new Date();
  const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(now));
  const quarter = 'Q' + Math.ceil(Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', month: 'numeric' }).format(now)) / 3);
  let recordId;
  let fixtureReadinessAttempts = 0, schemaCacheMisses = 0;
  try {
    if (!(await db.query("select to_regclass('public.lease_transaction_drafts') r")).rows[0].r) await db.query(await load('supabase/migrations/20260916053811_create_lease_transaction_drafts.sql'));
    if (!(await db.query("select to_regclass('public.industry_classification') r")).rows[0].r) {
      const sql = await load('supabase/migrations/20260801181214_align_database_content.sql');
      await db.query(sql.slice(0, sql.indexOf('insert into public.industry_classification')));
    }
    // The minimal integration fixture starts at the core schema; reproduce its current read column.
    await db.query("alter table public.buildings add column if not exists tracking_scope text default 'tracked'");
    await db.query("insert into public.buildings(id,name,submarket,grade,city,district,leasable_area) values($1,$2,'合成测试子市场','甲级','北京','朝阳区',10000)", [buildingId, building]);
    await db.query('insert into public.industry_classification(id,industry_level1,sub_industry) values($1,$2,$3)', [industryId, industry, '合成验收子行业']);
    await db.query("insert into public.lease_transactions(id,company,new_building,transaction_year,transaction_quarter,lease_term_months,area_sqm,submitter_id,submitter_name) values($1,$2,$3,$4,$5,3,100,$6,'合成重复检测样本')", [seedId, company + '（既有样本）', building, year, quarter, actorId]);
    await db.query("notify pgrst,'reload schema'");
    // NOTIFY requests an asynchronous schema refresh. SQL commit alone does not mean
    // PostgREST can serve a newly created table/column to the signed-in account yet.
    assert.ok(dataClient, 'The real signed-in Data API client is required');
    const deadline = Date.now() + 15000;
    for (;;) {
      fixtureReadinessAttempts++;
      const responses = await Promise.all([
        dataClient.from('industry_classification').select('id,industry_level1').eq('id', industryId),
        dataClient.from('buildings').select('id,tracking_scope').eq('id', buildingId),
        dataClient.from('lease_transaction_drafts').select('user_id').limit(1),
      ]);
      schemaCacheMisses += responses.filter(response => ['PGRST200', 'PGRST204', 'PGRST205'].includes(response.error?.code)).length;
      for (const response of responses) if (response.error && !['PGRST200', 'PGRST204', 'PGRST205'].includes(response.error.code)) {
        throw new Error('Form fixture Data API access failed: ' + response.error.code);
      }
      if (responses.every(response => !response.error) && responses[0].data?.[0]?.industry_level1 === industry && responses[1].data?.[0]?.id === buildingId) break;
      assert.ok(Date.now() < deadline, 'Form fixtures did not become visible through the signed-in Data API');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await page.goto(app + '/lease-submission');
    await page.getByRole('button', { name: '新增成交', exact: true }).click();
    await page.getByPlaceholder('请输入企业名称').waitFor();
    const select = async (locator, value) => { await locator.click(); await page.getByRole('option', { name: value, exact: true }).click(); };
    await page.locator('#company').fill(company);
    await select(page.locator('#enterprise_type'), '其他');
    await select(page.locator('#industry'), industry);
    await select(page.locator('label').filter({ hasText: /^所属子行业/ }).locator('..').getByRole('combobox'), '合成验收子行业');
    await select(page.getByPlaceholder('搜索楼宇名称…'), building);
    await select(page.locator('#demand_type'), '新租');
    for (const [field, value] of Object.entries({ floor_info: '合成A座', floor: '8', area_sqm: '100', face_rent: '100', effective_rent: '90', lease_term_months: '3' })) await page.locator('#' + field).fill(value);
    // Explicitly clear optional numbers: duplicate confirmation must preserve schema normalization.
    for (const field of ['fit_out_months', 'rent_free_months']) { await page.locator('#' + field).fill('1'); await page.locator('#' + field).fill(''); }
    await select(page.getByPlaceholder('年份'), String(year));
    await select(page.getByPlaceholder('季度'), quarter);
    await page.getByRole('button', { name: '提交记录', exact: true }).click();
    await page.getByRole('button', { name: '确认不是同一笔并提交', exact: true }).click();
    await page.getByRole('heading', { name: '提交成功', exact: true }).waitFor();
    const records = (await db.query('select id,lease_term_months,fit_out_months,rent_free_months from public.lease_transactions where company=$1', [company])).rows;
    assert.equal(records.length, 1); recordId = records[0].id;
    assert.equal(Number(records[0].lease_term_months), 3);
    assert.equal(records[0].fit_out_months, null); assert.equal(records[0].rent_free_months, null);
    const candidate = () => page.getByRole('row').filter({ has: page.getByText(company, { exact: true }) });
    await page.goto(app + '/lease-submission/expiry'); await candidate().waitFor();
    const interval = await candidate().innerText();
    await page.goto(app + '/lease-submission');
    await page.getByRole('region', { name: '我的提交记录', exact: true }).getByRole('row').filter({ has: page.getByRole('cell', { name: company, exact: true }) }).getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('#lease_term_months').fill('4');
    await page.getByRole('button', { name: '更新记录', exact: true }).click();
    await page.getByRole('button', { name: '确认不是同一笔并提交', exact: true }).click();
    await page.getByRole('button', { name: '确认更新', exact: true }).click();
    await page.getByRole('heading', { name: '提交成功', exact: true }).waitFor();
    await page.goto(app + '/lease-submission/expiry'); await candidate().waitFor();
    assert.notEqual(await candidate().innerText(), interval);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('alert').filter({ has: page.getByRole('button', { name: '重新读取', exact: true }) }).waitFor();
    assert.equal(await candidate().count(), 0, 'Failed reads clear stale records');
    await context.setOffline(false);
    await page.getByRole('button', { name: '重新读取', exact: true }).click();
    await candidate().waitFor();
    assert.equal((await db.query('select count(*)::int n from public.lease_expiry_reviews where source_id=$1', [recordId])).rows[0].n, 0);
    return { fullForm: true, duplicateConfirmation: true, blankOptionalNumbers: true, editRecalculation: true, offlineRetry: true, fixtureReadinessAttempts, schemaCacheMisses };
  } finally {
    await context.setOffline(false);
    // Exact synthetic fixture identities only, even if a failure happened after commit but before readback.
    const ids = (await db.query('select id from public.lease_transactions where id=$1 or company=$2', [seedId, company])).rows.map(row => row.id);
    if (ids.length) {
      await db.query('delete from public.lease_expiry_review_events where source_kind=\'live\' and source_id=any($1::uuid[])', [ids]);
      await db.query('delete from public.lease_expiry_reviews where source_kind=\'live\' and source_id=any($1::uuid[])', [ids]);
      await db.query('delete from public.lease_transactions where id=any($1::uuid[])', [ids]);
    }
    await db.query('delete from public.industry_classification where id=$1', [industryId]);
    await db.query('delete from public.buildings where id=$1', [buildingId]);
  }
}
