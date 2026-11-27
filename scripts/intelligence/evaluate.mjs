#!/usr/bin/env node
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cases, statuses } from './evaluation/cases.mjs';
import { BudgetLedger } from './evaluation/budget.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [command = 'plan', ...args] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--case', '--out', '--trace', '--budget', '--ledger', '--phase', '--batch', '--auth-evidence'].includes(args[i]) || !args[i + 1]) throw Error('INVALID_ARGUMENT');
  flags[args[i].slice(2)] = args[i + 1];
}
const selected = flags.case ? cases.filter(c => flags.case.split(',').includes(c.id) || flags.case.split(',').includes(c.family)) : cases;
if (!selected.length) throw Error('UNKNOWN_CASE');
const output = path.resolve(flags.out ?? path.join(root, 'verification/ai-evaluation'));
await mkdir(output, { recursive: true });
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const diff = execFileSync('git', ['diff', 'HEAD'], { cwd: root });
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
const sourceFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const sourceHash = createHash('sha256');
for (const file of [...new Set(sourceFiles)].sort()) {
  try { sourceHash.update(file + '\0'); sourceHash.update(await readFile(path.join(root, file))); }
  catch (e) { if (e.code !== 'ENOENT') throw e; sourceHash.update('<deleted>'); }
}
const revision = { commit, dirty: !!dirty, sourceSha256: sourceHash.digest('hex'), trackedDiffSha256: createHash('sha256').update(diff).digest('hex') };
const batchId = randomUUID();
const plan = { protocol: 'ai-evaluation/1', batchId, revision, environment: 'synthetic-local',
  authorizedTotal: 0, currency: 'USD', liveConcurrency: 1,
  model: 'deepseek-flash', thinking: 'disabled', fixture: 'synthetic-v1', clock: '2026-11-22T04:00:00Z',
  pricing: { source: 'https://api-docs.deepseek.com/quick_start/pricing/', checkedOn: '2026-11-22 Asia/Shanghai',
    inputUpperPerMillion: .3, cachedInputUpperPerMillion: .006, outputUpperPerMillion: 1.2,
    basis: 'published_peak_USD_conservative_no_assumed_cache_hit', recheckBeforePaidExecution: true },
  proposedLivePackage: { diagnosticWorkflowUpperUsd: .072, acceptanceHoldUsd: .144, bufferHoldUsd: .02,
    totalProposedUpperUsd: .236, basis: '60000 cumulative tokens * maximum applicable rate 1.2 / 1e6 per complete workflow',
    limitation: 'Synthetic model/tool seam only. Real Auth/DB/HTTP is a separate scripted evidence layer; production not authorized.' },
  rows: selected.map(c => ({ id: c.id, family: c.family, declaredSupported: true, status: c.live ? 'BUDGET_BLOCKED' : 'NOT_RUN',
    question: c.question, evidence: c.live ? 'real_model_not_run' : c.externalRunner ? 'real_auth_http_not_run' : 'deterministic_suite' })) };

async function save(batch) {
  batch.statusDistribution = Object.fromEntries(statuses.map(status => [status, batch.rows.filter(r => r.status === status).length]));
  batch.completion = { n: batch.rows.filter(r => r.status === 'PASS').length, N: batch.rows.length,
    evaluated: batch.rows.filter(r => ['PASS', 'PARTIAL', 'FAIL', 'EXPECTED_DENIAL'].includes(r.status)).length,
    unit: 'predeclared semantic families; not test assertions or production success probability' };
  const name = `${command}-${batchId}.json`;
  await writeFile(path.join(output, name), JSON.stringify(batch, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ file: path.join(output, name), completion: batch.completion, statuses: batch.statusDistribution, spending: batch.spending ?? { realProviderRequests: 0, estimated: 0, unsettled: 0, actualBill: null } }, null, 2));
}
async function runNode(argv, log) {
  const guard = path.join(root, 'scripts/intelligence/evaluation/offline-guard.cjs');
  const child = spawn(process.execPath, ['--require', guard, ...argv], { cwd: root, env: { ...process.env,
    NODE_OPTIONS: `--require=${guard}`, COLLIERS_EVAL_OFFLINE: '1', AI_MODEL_FALLBACK_ENABLED: 'false',
    DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '', BRAVE_SEARCH_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = ''; child.stdout.on('data', b => { text += b; }); child.stderr.on('data', b => { text += b; });
  const [code] = await once(child, 'exit'); await writeFile(log, text, { flag: 'wx', mode: 0o600 }); return code;
}
async function harness() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-eval-bundle-')), file = path.join(dir, 'harness.cjs');
  const { rolldown } = await import('rolldown');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const bundle = await rolldown({ input: path.join(root, 'scripts/intelligence/evaluation/harness.ts'), platform: 'node',
    resolve: { alias: { '@': root } }, external: [...Object.keys(pkg.dependencies), 'node:sqlite'] });
  try { await bundle.write({ file, format: 'cjs', codeSplitting: false }); } finally { await bundle.close(); }
  // Dependencies resolve from the repo, not the generated /tmp file.
  const { symlink } = await import('node:fs/promises'); await symlink(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  return import(pathToFileURL(file).href);
}

if (command === 'compare-plan') {
  const { comparisonPlan } = await import('./evaluation/model-comparison.mjs');
  console.log(JSON.stringify({ revision, ...comparisonPlan() }, null, 2));
} else if (command === 'compare-live') {
  if (!flags.budget || revision.dirty) throw Error('COMPARISON_APPROVAL_AND_CLEAN_REVISION_REQUIRED');
  const approval = JSON.parse(await readFile(flags.budget, 'utf8'));
  const { runModelComparison } = await import('./evaluation/model-comparison.mjs');
  const keys = ['DEEPSEEK_API_KEY', 'DEEPSEEK_API_BASE_URL'];
  let saved;
  try {
    const result = await runModelComparison(approval, async () => {
      const testKey = process.env.COLLIERS_AI6_EVAL_DEEPSEEK_KEY?.trim();
      if (!testKey || testKey === process.env.DEEPSEEK_API_KEY?.trim()) throw Error('DEDICATED_COMPARISON_KEY_REQUIRED');
      saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
      process.env.DEEPSEEK_API_KEY = testKey;
      process.env.DEEPSEEK_API_BASE_URL = 'https://api.deepseek.com';
      const evaluation = await harness();
      return evaluation.createDeepSeekAdapter();
    }, revision);
    console.log(JSON.stringify(result, null, 2));
    if (result.halted || result.failures) process.exitCode = 1;
  } finally {
    for (const key of Object.keys(saved ?? {})) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
} else if (command === 'plan') await save(plan);
else if (command === 'offline') {
  for (const row of plan.rows) {
    const spec = cases.find(c => c.id === row.id);
    if (spec.live) continue;
    if (spec.externalRunner) { row.status = 'NOT_RUN'; row.reason = 'Run the existing dedicated disposable Auth/PG harness separately; this command never initializes databases.'; continue; }
    const log = path.join(output, `${batchId}-${row.id}.log`);
    const argv = spec.nodeTests ? ['--test', ...spec.nodeTests]
      : ['node_modules/vitest/vitest.mjs', 'run', ...spec.tests, '--reporter=dot'];
    const start = performance.now(); row.status = (await runNode(argv, log)) === 0 ? 'PASS' : 'FAIL';
    row.durationMs = Math.round(performance.now() - start); row.log = log;
    console.log(`${row.status} ${row.id}`);
  }
  await save(plan); if (plan.rows.some(r => r.status === 'FAIL')) process.exitCode = 1;
} else if (command === 'replay') {
  // Recorded trajectories are executed against exact current inputs, not returned as application cache.
  createRequire(import.meta.url)('./evaluation/offline-guard.cjs');
  const h = await harness();
  const trace = flags.trace ? JSON.parse(await readFile(flags.trace, 'utf8')) : h.newTrace('scripted');
  const question = '查询 CBD 2026Q3 的净有效租金，说明单位和有效样本。';
  if (!flags.trace) await h.runScenario({ question, trace, attempt: batchId, mode: 'scripted' });
  const result = await h.runScenario({ question: trace.question ?? question, trace, attempt: batchId, mode: 'replay' });
  await writeFile(path.join(output, `trace-${batchId}.json`), JSON.stringify({ ...trace, question: trace.question ?? question, revision }, null, 2), { flag: 'wx', mode: 0o600 });
  await save({ ...plan, rows: [{ id: 'exact-trajectory-replay', family: 'replay-contract', status: result.protocolMatched ? 'PASS' : 'FAIL', evidence: trace.source + '_trajectory_replay', result }] });
} else if (command === 'live') {
  // Never read a key, import a provider, or create a ledger without explicit funding.
  if (!flags.budget || !flags.ledger) { await save({ ...plan, rows: plan.rows.filter(r => cases.find(c => c.id === r.id)?.live) }); }
  else {
    const config = JSON.parse(await readFile(flags.budget, 'utf8'));
    if (!(config.total > 0)) throw Error('BUDGET_BLOCKED');
    if (config.pricingSource !== plan.pricing.source || config.rates?.input < .3 || config.rates?.cachedInput < .006
      || config.rates?.output < 1.2) throw Error('PRICE_UPPER_BOUND_REQUIRED');
    if (Date.now() - Date.parse(config.pricingCheckedAt) > 86400000 || !Number.isFinite(Date.parse(config.pricingCheckedAt))
      || Date.parse(config.pricingCheckedAt) > Date.now()) throw Error('PRICE_RECHECK_REQUIRED');
    const configuredModel = process.env.DEEPSEEK_CHAT_MODEL?.trim() || process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash';
    if (configuredModel !== config.model || config.model !== 'deepseek-flash' || config.currency !== 'USD'
      || !['', 'https://api.deepseek.com', 'https://api.deepseek.com/v1'].includes(process.env.DEEPSEEK_API_BASE_URL?.replace(/\/$/, '') ?? '')
      || !process.env.DEEPSEEK_API_KEY?.trim()) throw Error('LIVE_CONFIGURATION_MISMATCH');
    // Existing product limits continue to apply. No fallback supplier is allowed by this package.
    for (const mode of ['QUICK', 'PROFESSIONAL', 'DEEP']) if ((process.env[`AI_PROVIDER_${mode}`] ?? 'deepseek') !== 'deepseek') throw Error('UNBUDGETED_PROVIDER');
    if (process.env.AI_MODEL_FALLBACK_ENABLED === 'true') throw Error('UNBUDGETED_FALLBACK');
    const phase = flags.phase ?? 'diagnostic';
    if (!['diagnostic', 'acceptance'].includes(phase)) throw Error('INVALID_PHASE');
    const workflowUpper = Math.ceil(60000 * Math.max(config.rates.input, config.rates.output) / 1e6 * 1e9);
    const acceptanceIds = config.acceptanceCaseIds ?? ['live-capabilities', 'live-quarter'];
    if (!Array.isArray(acceptanceIds) || !acceptanceIds.length || new Set(acceptanceIds).size !== acceptanceIds.length
      || acceptanceIds.some(id => !cases.some(c => c.id === id && c.phase === 'acceptance'))
      || config.acceptance < acceptanceIds.length * workflowUpper || config.buffer < Math.ceil(.02 * 1e9)) throw Error('ACCEPTANCE_AND_BUFFER_RESERVE_REQUIRED');
    const ledger = new BudgetLedger(path.resolve(flags.ledger), config), h = await harness();
    const rows = plan.rows.filter(r => { const c = cases.find(c => c.id === r.id); return c?.live && c.phase === phase
      && (phase !== 'acceptance' || acceptanceIds.includes(c.id)); });
    if (!rows.length) throw Error('NO_CASE_IN_SELECTED_PHASE');
    try {
      for (const row of rows) {
        const workflow = `${batchId}:${row.id}`;
        // Full workflow cap at configured rates, including failed calls. No overlap with per-request reservations.
        const amount = Math.ceil(60000 * Math.max(config.rates.input, config.rates.output) / 1e6 * 1e9);
        try { ledger.startWorkflow(workflow, phase, amount); }
        catch (e) { row.status = 'BUDGET_BLOCKED'; row.reason = e.message; continue; }
        const trace = h.newTrace('real_model'); trace.question = row.question; trace.revision = revision;
        try {
          row.result = await h.runScenario({ question: row.question, trace, ledger, workflow, attempt: workflow, mode: 'live' });
          row.status = row.result.protocolMatched ? 'PARTIAL' : 'FAIL';
          row.reason = 'Final narrative requires independent evidence review; protocol execution alone is not PASS.';
        } catch (e) {
          const taskBlocked = ['BUDGET_BLOCKED', 'BUDGET_HALTED'].includes(e.message);
          row.status = taskBlocked ? 'BUDGET_BLOCKED' : 'FAIL';
          row.reason = taskBlocked ? e.message : e.code === 'budget_exceeded'
            ? 'PRODUCT_REQUEST_TOKEN_MONEY_OR_ATTEMPT_LIMIT' : 'MODEL_OR_EXECUTION_FAILED';
        }
        finally {
          await writeFile(path.join(output, `trace-${workflow.replaceAll(':', '-')}.json`), JSON.stringify(trace, null, 2), { flag: 'wx', mode: 0o600 });
          try { ledger.finishWorkflow(workflow); } catch { /* Unsettled reservations survive process exit. */ }
        }
        if (ledger.snapshot().halted) break;
      }
      const s = ledger.snapshot();
      await save({ ...plan, authorizedTotal: config.total / 1e9, rows, spending: { taskId: config.taskId,
        providerAttemptsPossiblySent: s.requests.filter(r => r.state !== 'released' && r.state !== 'reserved').length,
        confirmedProviderResponses: s.requests.filter(r => r.state === 'settled').length,
        estimated: s.settled / 1e9, unsettled: s.pending / 1e9, holds: s.held / 1e9, actualBill: null, halted: s.halted } });
    } finally { ledger.close(); }
  }
} else if (command === 'resume') {
  if (!flags.ledger) throw Error('LEDGER_REQUIRED');
  const ledger = new BudgetLedger(path.resolve(flags.ledger));
  console.log(JSON.stringify(ledger.snapshot(), null, 2)); ledger.close();
  // Inspection only: never resend an unknown request or reset a task budget.
} else if (command === 'report') {
  if (!flags.batch) throw Error('BATCH_REQUIRED');
  const batch = JSON.parse(await readFile(flags.batch, 'utf8'));
  if (flags['auth-evidence']) {
    const bytes = await readFile(flags['auth-evidence']), auth = JSON.parse(bytes);
    if (auth.production !== false || auth.modelCalls !== false || !auth.scenarios?.length
      || auth.scenarios.some(s => s.status !== 'passed') || !/PostgreSQL 17\./.test(auth.database)) throw Error('INVALID_AUTH_EVIDENCE');
    const row = batch.rows.find(r => r.id === 'auth-http');
    if (!row) throw Error('AUTH_CASE_NOT_IN_BATCH');
    Object.assign(row, { status: 'PASS', evidence: 'real_auth_db_http_scripted_model', scenarios: auth.scenarios.length,
      testedCommit: auth.testedCommit, evidencePath: flags['auth-evidence'], evidenceSha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await save({ ...batch, parentBatch: flags.batch, batchId });
} else throw Error('UNKNOWN_COMMAND');
