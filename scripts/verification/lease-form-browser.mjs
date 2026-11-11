// Actual form controls, Auth, HTTP and database. Only synthetic, disposable local data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function verifyLeaseBackProtection({ page, app, company }) {
  await page.goto(app + '/intelligence');
  await page.getByRole('link', { name: '预计到期线索（管理员试点）', exact: true }).click();
  await page.getByRole('button').filter({ hasText: company }).click();
  await page.getByText('补充资料或标记问题（可选）', { exact: true }).click();
  const notes = page.getByLabel('补充备注');
  await notes.fill('合成未保存返回保护检查');
  let dialogs = 0;
  let accept = false;
  const dialog = async event => { dialogs++; assert.equal(event.type(), 'beforeunload'); await (accept ? event.accept() : event.dismiss()); };
  page.on('dialog', dialog);
  try {
    // A cancelled traversal has no load event; wait for the real warning, not navigation completion.
    const backWarning = page.waitForEvent('dialog');
    await page.evaluate(() => history.back());
    await backWarning;
    assert.equal(dialogs, 1, 'Browser back must warn before discarding input');
    assert.equal(new URL(page.url()).pathname, '/intelligence/lease-expiry');
    assert.equal(await notes.inputValue(), '合成未保存返回保护检查');
    const linkWarning = page.waitForEvent('dialog');
    await page.getByRole('link', { name: '返回业务智能', exact: true }).click({ noWaitAfter: true });
    await linkWarning;
    assert.equal(dialogs, 2, 'One native leave prompt per link navigation');
    assert.equal(await notes.inputValue(), '合成未保存返回保护检查');
    accept = true;
    await page.goBack();
    await page.waitForURL(app + '/intelligence');
    assert.equal(dialogs, 3);
  } finally { page.off('dialog', dialog); }
}

export async function verifyLeaseFormWorkflow({ page, db, app, actorId }) {
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
    // Wait for schema refresh through the actual browser response, not an HTTP replacement.
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
    const candidate = () => page.getByRole('button', { name: new RegExp('^' + company + ' ·') });
    await page.goto(app + '/intelligence/lease-expiry'); await candidate().click();
    const interval = await page.getByText(/^预计到期区间：/).innerText();
    await page.goto(app + '/lease-submission');
    await page.getByRole('row').filter({ has: page.getByRole('cell', { name: company, exact: true }) }).getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('#lease_term_months').fill('4');
    await page.getByRole('button', { name: '更新记录', exact: true }).click();
    await page.getByRole('button', { name: '确认不是同一笔并提交', exact: true }).click();
    await page.getByRole('button', { name: '确认更新', exact: true }).click();
    await page.getByRole('heading', { name: '提交成功', exact: true }).waitFor();
    await page.goto(app + '/intelligence/lease-expiry'); await candidate().click();
    assert.notEqual(await page.getByText(/^预计到期区间：/).innerText(), interval);
    await page.getByText('补充资料或标记问题（可选）', { exact: true }).click();
    const notes = page.getByLabel('补充备注'); await notes.fill('合成验收：断网后保留输入');
    await context.setOffline(true);
    await page.getByRole('button', { name: '保存补充记录', exact: true }).click(); await page.getByRole('alert').waitFor();
    assert.equal(await notes.inputValue(), '合成验收：断网后保留输入');
    assert.equal((await db.query('select count(*)::int n from public.lease_expiry_reviews where source_id=$1', [recordId])).rows[0].n, 0);
    await context.setOffline(false);
    await page.getByRole('button', { name: '保存补充记录', exact: true }).click();
    await page.getByText('补充记录已保存，预计到期区间仍按成交数据计算。', { exact: true }).waitFor();
    assert.equal((await db.query('select revision from public.lease_expiry_reviews where source_id=$1', [recordId])).rows[0].revision, 1);
    return { fullForm: true, duplicateConfirmation: true, blankOptionalNumbers: true, editRecalculation: true, offlineRetry: true };
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
