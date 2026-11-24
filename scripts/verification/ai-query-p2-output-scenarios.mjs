import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { BUILDINGS } from '../../supabase/tests/ai-query-authority/snapshot-fixture.mjs';

export function snapshotCopyBusinessText(text, result) {
  // Opaque identifiers can randomly contain the mutation sentinel. Exclude only
  // the exact saved identifiers; keep every business value in the assertion.
  return text.replaceAll(result.dataVersion, '').replaceAll(result.resultId, '');
}

/** Real GoTrue / PostgreSQL / PostgREST / production Next execution. */
export async function verifyP2Outputs({ db, app, check, queryAdmin, person, call, artifact, acknowledge, exportCaps, events, decrypt }) {
  const query = () => call(queryAdmin, { idempotencyKey: randomUUID(), question: '2026Q3CBD净有效租金' });
  let source;
  await check('P2 T18 复制同样要求独立导出资格，禁止通过本机复制动作绕过后端', async () => {
    await grantQuery({ setup: db }, queryAdmin.id);
    const response = await query(); assert.equal(response.status, 200); source = response.body;
    const copy = await artifact(queryAdmin, { requestId: source.requestId, resultId: source.result.resultId, action: 'copy', format: 'conclusion' });
    assert.equal(copy.status, 403); assert.equal(copy.body.text, undefined);
    assert.equal((await events(copy.body.attemptId)).at(-1).kind, 'denied');
  });
  await check('P2 T08/T17 复制结论、数字与摘要保留原季度、单位和样本；业务数据修改不替换快照', async () => {
    await grantQuery({ setup: db }, queryAdmin.id, { capabilities: exportCaps });
    const response = await query(); assert.equal(response.status, 200); source = response.body;
    assert.equal(source.result.table.rows[0].cells.value.value.numeric, 170);
    await db.query('update public.building_metrics set net_effective_rent=9999 where building_id=$1 and record_year=2026 and record_quarter=3', [BUILDINGS[0]]);
    try {
      for (const format of ['conclusion', 'figures', 'summary']) {
        const copy = await artifact(queryAdmin, { requestId: source.requestId, resultId: source.result.resultId, action: 'copy', format });
        assert.equal(copy.status, 200); assert.equal(copy.body.resultId, source.result.resultId); assert.equal(copy.body.format, format);
        assert.match(copy.body.text, /2026Q3/); assert.match(copy.body.text, /170/); assert.match(copy.body.text, /元\/㎡\/月/);
        assert.match(copy.body.text, /有效 3 栋|参与 3 栋/);
        assert.doesNotMatch(snapshotCopyBusinessText(copy.body.text, source.result), /9999|9,999/);
        assert.equal(copy.body.result, undefined); assert.match(copy.headers.get('cache-control'), /no-store/);
        assert.equal(copy.headers.get('x-query-body-sha256'), createHash('sha256').update(JSON.stringify(copy.body)).digest('hex'));
        const logged = decrypt((await events(copy.body.attemptId)).find(event => event.kind === 'response_generated')).content.result.artifact;
        assert.equal(logged.kind, 'copy'); assert.equal(logged.text, copy.body.text); assert.equal(logged.format, format);
        assert.equal((await acknowledge(queryAdmin, copy)).status, 200);
        assert.equal((await acknowledge(queryAdmin, copy, 'browser_download_dispatched')).status, 403);
      }
    } finally {
      await db.query('update public.building_metrics set net_effective_rent=100 where building_id=$1 and record_year=2026 and record_quarter=3', [BUILDINGS[0]]);
    }
  });
  await check('P2 T09 下载名显示真实分析对象、指标与季度，历史结果不改名为当前季度', async () => {
    const file = await artifact(queryAdmin, { requestId: source.requestId, resultId: source.result.resultId, action: 'export', format: 'xlsx' });
    assert.equal(file.status, 200);
    const header = file.headers.get('content-disposition');
    assert.match(header, /^attachment; filename="[a-zA-Z0-9._-]+"; filename\*=UTF-8''/);
    const filename = decodeURIComponent(header.split("filename*=UTF-8''")[1]);
    assert.match(filename, /CBD_净有效租金_2026Q3/); assert.ok(filename.endsWith('.xlsx'));
  });
  await check('P2 T12/T18 复制拒绝跨账号、模拟身份、跨源、伪造结果和客户端正文', async () => {
    const other = await person('admin', 'p2-copy-other'); await grantQuery({ setup: db }, other.id, { capabilities: exportCaps });
    const input = { requestId: source.requestId, resultId: source.result.resultId, action: 'copy', format: 'summary' };
    for (const response of [await artifact(other, input), await artifact(queryAdmin, input, { 'X-Colliers-Impersonate-User': other.id }),
      await artifact(queryAdmin, input, { Origin: 'https://foreign.invalid' }), await artifact(queryAdmin, { ...input, text: 'invented' })]) {
      assert.equal(response.status, 403); assert.equal(response.body.text, undefined);
    }
    assert.equal((await artifact(queryAdmin, { ...input, resultId: randomUUID() })).status, 422);
  });
  await check('P2 T12 复制生成后撤回资格或候选来源，最终响应不泄露已生成正文', async () => {
    const input = { requestId: source.requestId, resultId: source.result.resultId, action: 'copy', format: 'conclusion' };
    for (const fault of ['grant', 'source']) {
      await db.query(`create or replace function private.withdraw_p2_copy_after_prepare() returns trigger language plpgsql set search_path='' as $$ begin if new.kind='delivery_receipt' then ${fault === 'grant' ? `update private.ai_query_grants set capabilities=array['query:catalog','query:brochure','query:quarter'] where user_id='${queryAdmin.id}';` : `update public.buildings set merged_into_id='${BUILDINGS[0]}' where id='${BUILDINGS[1]}';`} end if;return new;end $$;create trigger withdraw_p2_copy_after_prepare after insert on private.ai_query_audit_events for each row execute function private.withdraw_p2_copy_after_prepare()`);
      try {
        const response = await artifact(queryAdmin, input, { Origin: app });
        assert.equal(response.status, 403); assert.equal(response.body.text, undefined);
        const tail = (await events(response.body.attemptId)).at(-1); assert.equal(tail.kind, 'correction');
        assert.equal(decrypt(tail).content.delivery, 'not_sent');
      } finally {
        await db.query('drop trigger withdraw_p2_copy_after_prepare on private.ai_query_audit_events');
        await grantQuery({ setup: db }, queryAdmin.id, { capabilities: exportCaps });
        await db.query('update public.buildings set merged_into_id=null where id=$1', [BUILDINGS[1]]);
      }
    }
  });
}
