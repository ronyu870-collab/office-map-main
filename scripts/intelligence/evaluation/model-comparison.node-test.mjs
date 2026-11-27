import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { comparisonPlan, comparisonPricingSource, runModelComparison } from './model-comparison.mjs';

const revision = { commit: 'a'.repeat(40), dirty: false };

function approval(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ai6-comparison-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const taskId = 'comparison-test';
  return { taskId, runDirectory: path.join(directory, taskId), commit: revision.commit, totalNanodollars: 250_000_000,
    currency: 'USD', pricingSource: comparisonPricingSource, pricingCheckedAt: new Date().toISOString(),
    rates: { 'deepseek-flash': { input: .30, output: 1.20 }, 'deepseek-v4-pro': { input: 1.32, output: 3.96 } } };
}

function result(model, value, usage = {}) {
  return { model, inputTokens: 150, outputTokens: 30, message: { content: JSON.stringify(value) }, ...usage };
}

function records(journal) {
  return readFileSync(journal, 'utf8').trim().split('\n').map(line => JSON.parse(line));
}

test('AI6 comparison plan reserves all twelve requests for the same four cases', () => {
  const plan = comparisonPlan();
  assert.equal(plan.providerRequests, 0);
  assert.equal(plan.totalProposedUsd, .24192);
  assert.equal(plan.rows.length, 12);
  for (const [offset, row] of plan.rows.entries()) {
    assert.equal(row.status, 'BUDGET_BLOCKED');
    assert.equal(row.inputLimit, 5000);
    assert.equal(row.outputLimit, 8000);
    assert.equal(row.reasoningEffort, [undefined, 'low', 'high'][offset % 3]);
    assert.equal(row.model, ['deepseek-flash', 'deepseek-flash', 'deepseek-v4-pro'][offset % 3]);
  }
});

test('AI6 comparison rejects absent, stale or insufficient approval before loading the adapter', async t => {
  const approved = approval(t);
  const neverLoad = async () => assert.fail('adapter loaded before approval validation');
  await assert.rejects(runModelComparison(null, neverLoad, revision), /APPROVAL_REQUIRED/);
  await assert.rejects(runModelComparison(approved, neverLoad, { ...revision, commit: 'b'.repeat(40) }), /APPROVAL_REQUIRED/);
  await assert.rejects(runModelComparison(approved, neverLoad, { ...revision, dirty: true }), /APPROVAL_REQUIRED/);
  await assert.rejects(runModelComparison({ ...approved, pricingCheckedAt: 'invalid' }, neverLoad, revision), /PRICE_RECHECK/);
  await assert.rejects(runModelComparison({ ...approved, totalNanodollars: 241_919_999 }, neverLoad, revision), /BUDGET_BLOCKED/);
  await assert.rejects(runModelComparison({ ...approved, totalNanodollars: 250_000_001 }, neverLoad, revision), /APPROVAL_REQUIRED/);
  await assert.rejects(runModelComparison({ ...approved, rates: { ...approved.rates, 'deepseek-v4-pro': { input: 1.31, output: 3.96 } } }, neverLoad, revision), /PRICE_UPPER_BOUND/);
});

test('AI6 comparison runs sequentially with matched inputs, records assertions, and never repeats an approved run', async t => {
  const approved = approval(t);
  const seen = [];
  const load = async () => async (messages, _signal, onDelta, options) => {
    seen.push({ messages, options });
    assert.equal(onDelta, undefined);
    assert.deepEqual(options.tools, []);
    assert.equal(options.responseFormat, 'json_object');
    const correctFirstCase = { facts: { period: '2026Q2', rent: 180, sample: 1, unit: 'CNY/m2/month', sources: ['K1', 'Q1'] },
      suggestedTools: ['query_quarterly_metrics'], answer: '2026Q2 净有效租金为 180 元/㎡/月。' };
    return result(options.model, seen.length <= 3 ? correctFirstCase : { ...correctFirstCase, facts: {} });
  };
  const run = await runModelComparison(approved, load, revision);
  assert.equal(run.halted, null);
  assert.equal(run.actualBill, null);
  assert.equal(run.providerAttempts, 12);
  assert.equal(run.pendingNanodollars, 0);
  assert.equal(run.failures, 9);
  assert.ok(run.estimatedNanodollars > 0 && run.estimatedNanodollars < approved.totalNanodollars);
  const log = records(run.journal);
  assert.equal(log.length, 14);
  assert.deepEqual(log.slice(1, 4).map(row => row.status), ['PARTIAL', 'PARTIAL', 'PARTIAL']);
  assert.ok(log.slice(4, 13).every(row => row.status === 'FAIL' && !row.assertions.facts && !row.answer));
  for (let offset = 0; offset < seen.length; offset += 3) {
    assert.deepEqual(seen[offset].messages, seen[offset + 1].messages);
    assert.deepEqual(seen[offset].messages, seen[offset + 2].messages);
    assert.deepEqual(seen.slice(offset, offset + 3).map(call => call.options.reasoningEffort), [undefined, 'low', 'high']);
  }
  await assert.rejects(runModelComparison(approved, load, revision), { code: 'EEXIST' });
  renameSync(approved.runDirectory, approved.runDirectory + '-archive');
  await assert.rejects(runModelComparison(approved, load, revision), { code: 'EEXIST' });
  assert.equal(seen.length, 12);
});

test('AI6 comparison keeps the reservation and stops every later model on supplier rejection or unknown usage', async t => {
  for (const reason of ['payment_required', 'USAGE_MISSING', 'usage_exceeded_reservation']) {
    await t.test(reason, async subtest => {
      const approved = approval(subtest);
      const run = await runModelComparison(approved, async () => async (_messages, _signal, _delta, options) => {
        if (reason === 'payment_required') throw Object.assign(Error(), { code: reason });
        return result(options.model, {}, { outputTokens: reason === 'USAGE_MISSING' ? null : 8001 });
      }, revision);
      assert.equal(run.halted, reason);
      assert.equal(run.providerAttempts, 1);
      assert.equal(run.pendingNanodollars, reason === 'usage_exceeded_reservation' ? 0 : 11_100_000);
      assert.equal(records(run.journal)[1].status, 'BLOCKED');
      assert.ok(records(run.journal).slice(2, 13).every(row => row.status === 'NOT_RUN'));
    });
  }
});
