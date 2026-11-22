import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { BudgetLedger, budgetedAdapter, envelope, usageCost, nanos } from './budget.mjs';
const file = () => join(mkdtempSync(join(tmpdir(), 'ai-budget-')), 'budget.sqlite');
const config = (total = 1e9) => ({ taskId: 'synthetic', total, acceptance: Math.floor(total / 5), buffer: Math.floor(total / 10),
  currency: 'USD', model: 'deepseek-flash', rates: { input: .3, cachedInput: .006, output: 1.2 },
  pricingSource: 'synthetic-price-protocol-test', pricingCheckedAt: '2026-11-22T00:00:00Z' });
test('zero authorization blocks adapter; restart cannot reset money or pending requests', async () => {
  const path = file(), c = config(0), ledger = new BudgetLedger(path, c);
  assert.throws(() => ledger.startWorkflow('task', 'diagnostic', 1), /BUDGET_BLOCKED/);
  let sent = 0;
  const adapter = budgetedAdapter(async () => { sent++; }, ledger, 'missing', 'attempt');
  await assert.rejects(adapter([], new AbortController().signal, undefined, { model: c.model, tools: [], maxOutputTokens: 1 }), /BUDGET_BLOCKED/);
  assert.equal(sent, 0); ledger.close();
  const reopened = new BudgetLedger(path, c); assert.equal(reopened.snapshot().available, 0); reopened.close();
  assert.throws(() => new BudgetLedger(path, config(10)), /IMMUTABLE_BUDGET_CONFIG/);
});
test('all phase allocations and request transitions count each reservation once', () => {
  const path = file(), ledger = new BudgetLedger(path, config(1000));
  ledger.startWorkflow('diagnostic', 'diagnostic', 700);
  assert.throws(() => ledger.startWorkflow('steal', 'diagnostic', 1), /BUDGET_BLOCKED/);
  ledger.startWorkflow('accept', 'acceptance', 200);
  ledger.reserve('a', 'accept', 100); ledger.sent('a'); ledger.unknown('a');
  assert.equal(ledger.snapshot().pending, 100); assert.equal(ledger.snapshot().held, 900);
  assert.throws(() => ledger.releaseNotSent('a'), /MAY_HAVE_BEEN_SENT/);
  ledger.close(); const resumed = new BudgetLedger(path);
  assert.equal(resumed.snapshot().pending, 100);
  resumed.settle('a', { inputTokens: 0, outputTokens: 0 }, { input: 100, output: 10 });
  assert.equal(resumed.snapshot().pending, 0); assert.equal(resumed.snapshot().held, 1000);
  assert.throws(() => resumed.settle('a', { inputTokens: 0, outputTokens: 0 }, { input: 100, output: 10 }), /INVALID_TRANSITION/);
  resumed.finishWorkflow('accept'); assert.equal(resumed.snapshot().pools.find(p => p.id === 'acceptance-hold').remaining, 200);
  resumed.reserve('not-sent', 'diagnostic', 50); resumed.releaseNotSent('not-sent');
  resumed.finishWorkflow('diagnostic'); assert.equal(resumed.snapshot().available, 700); resumed.close();
});
test('crashes/timeouts hold money; unexpected usage halts every following worker', async () => {
  const ledger = new BudgetLedger(file(), config()); ledger.startWorkflow('wf', 'diagnostic', 5e8);
  const options = { model: 'deepseek-flash', tools: [{ name: 'x' }], maxOutputTokens: 10 };
  const adapter = budgetedAdapter(async () => { throw Error('timeout'); }, ledger, 'wf', 'a');
  await assert.rejects(adapter([], new AbortController().signal, undefined, options), /timeout/);
  assert.ok(ledger.snapshot().pending > 0); assert.equal(ledger.snapshot().requests[0].state, 'unresolved');
  ledger.reserve('overflow', 'wf', 1); ledger.sent('overflow');
  ledger.settle('overflow', { inputTokens: 100, outputTokens: 10 }, { input: 1, output: 1 });
  assert.equal(ledger.snapshot().halted, 'usage_exceeded_reservation');
  assert.throws(() => ledger.reserve('later', 'wf', 1), /BUDGET_HALTED/); ledger.close();
});
test('cache tokens are a subset of prompt; reasoning is a subset of completion', () => {
  const rates = config().rates;
  assert.equal(usageCost({ inputTokens: 1000, cachedInputTokens: 400, outputTokens: 100, reasoningTokens: 30 }, rates), nanos((600 * .3 + 400 * .006 + 100 * 1.2) / 1e6));
  assert.throws(() => usageCost({ inputTokens: 2, cachedInputTokens: 3, outputTokens: 1 }, rates), /INVALID_USAGE/);
  assert.ok(envelope([{ role: 'user', content: '中文' }], { tools: [], maxOutputTokens: 10 }, rates).input > 1024);
});
test('unpriced returned model and malformed usage keep the full reservation and halt; unresolved pools cannot close', async () => {
  for (const response of [
    { model: 'unpriced-future-model', inputTokens: 1, outputTokens: 1 },
    { model: 'deepseek-flash', inputTokens: -1, outputTokens: 1 },
  ]) {
    const ledger = new BudgetLedger(file(), config()); ledger.startWorkflow('wf', 'diagnostic', 5e8);
    const adapter = budgetedAdapter(async () => response, ledger, 'wf', 'a');
    await assert.rejects(adapter([], new AbortController().signal, undefined, { model: 'deepseek-flash', tools: [], maxOutputTokens: 10 }));
    assert.ok(ledger.snapshot().pending > 0); assert.ok(ledger.snapshot().halted);
    assert.throws(() => ledger.finishWorkflow('wf'), /UNSETTLED_WORKFLOW/); ledger.close();
  }
});
test('a worker reserved before another worker halts must not send after the halt', () => {
  const path = file(), first = new BudgetLedger(path, config()); first.startWorkflow('wf', 'diagnostic', 5e8);
  const second = new BudgetLedger(path);
  first.reserve('overflow', 'wf', 1); second.reserve('waiting', 'wf', 1);
  first.sent('overflow'); first.settle('overflow', { inputTokens: 100, outputTokens: 10 }, { input: 1, output: 1 });
  assert.throws(() => second.sent('waiting'), /BUDGET_HALTED/);
  assert.equal(second.snapshot().requests.find(r => r.id === 'waiting').state, 'reserved');
  second.releaseNotSent('waiting'); first.close(); second.close();
});
test('SQLite serializes two processes competing for the last task allocation', async () => {
  const path = file(), c = config(1000), ledger = new BudgetLedger(path, c);
  const code = `import {BudgetLedger} from ${JSON.stringify(new URL('./budget.mjs', import.meta.url).href)};
    const ledger=new BudgetLedger(process.argv[1]);
    try {ledger.startWorkflow(process.argv[2],'diagnostic',700);process.exitCode=0;}
    catch {process.exitCode=2;}finally{ledger.close();}`;
  const children = ['one', 'two'].map(id => spawn(process.execPath, ['--input-type=module', '-e', code, path, id], { stdio: 'ignore' }));
  const codes = await Promise.all(children.map(async p => (await once(p, 'exit'))[0]));
  assert.deepEqual(codes.sort(), [0, 2]); assert.equal(ledger.snapshot().available, 0); ledger.close();
});
