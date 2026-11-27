import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { BudgetLedger, envelope, nanos } from './budget.mjs';

export const comparisonPricingSource = 'https://api-docs.deepseek.com/quick_start/pricing/';
const currency = 'USD';
const approvedCeiling = nanos(.25);
const input = 5000;
const output = 8000;
const priceFloor = {
  'deepseek-flash': { input: .30, output: 1.20 },
  'deepseek-v4-pro': { input: 1.32, output: 3.96 },
};
const modes = [
  { name: 'quick', model: 'deepseek-flash' },
  { name: 'professional', model: 'deepseek-flash', reasoningEffort: 'low' },
  { name: 'deep', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
];

const cases = [
  {
    id: 'concept-with-case',
    question: '解释净有效租金，并用获权楼宇甲 2026Q2 的正式记录举例。',
    evidence: '定义 K1：净有效租金反映免租等优惠后的有效租金。正式记录 Q1：楼宇甲，2026Q2，净有效租金 180 元/㎡/月（CNY/m2/month），有效样本 1。可建议 query_quarterly_metrics。',
    expected: { period: '2026Q2', rent: 180, sample: 1, unit: 'CNY/m2/month', sources: ['K1', 'Q1'] },
    tools: ['query_quarterly_metrics'],
  },
  {
    id: 'market-comparison',
    question: '按甲、乙、丙的顺序，比较三个市场 2026Q2 的净有效租金、空置率、获权跟踪面积三项正式指标。',
    evidence: '来源 Q2。每个市场用一行数组，四个元素依次为租金（元/㎡/月）、空置率（%）、跟踪面积（㎡）、各指标样本数组：甲 210、10、20000、[3,3,4]；乙 190、15、16000、[2,2,3]；丙 160、20、12000、[2,1,2]。跟踪面积口径为 tracked，不代表全市场。可建议 execute_query_plan。',
    expected: { period: '2026Q2', rows: [[210, 10, 20000, [3, 3, 4]], [190, 15, 16000, [2, 2, 3]], [160, 20, 12000, [2, 1, 2]]], stockBasis: 'tracked', sources: ['Q2'] },
    tools: ['execute_query_plan'],
  },
  {
    id: 'site-screening',
    question: '给预算 300 元/㎡/月、需要 2000㎡ 连续面积、地铁步行不超过 800 米的客户初筛。',
    evidence: '候选正规记录 R1：楼宇甲 260 元/㎡/月、甲级、目录空置共 3200㎡，连续可租面积未知。获权楼书 B1：可到达地铁站，未核实步行路线。楼宇乙 310 元/㎡/月。可建议 query_building_dossier。',
    expected: { candidates: ['楼宇甲'], rent: 260, contiguousArea: null, walkMeters: null, sources: ['R1', 'B1'] },
    tools: ['query_building_dossier'],
  },
  {
    id: 'research-brief',
    question: '写一段跨期研究简报，对照租金趋势和已获权的成交汇总，并写清缺项。',
    evidence: '来源 Q3 仅同样本的 2026Q1、2026Q2 净有效租金 200、190，有效样本 3，单位元/㎡/月；来源 L1 仅 2026Q2 8 笔租赁成交。未来供应字段无权限，不可推断。可建议 analyze_market_trends、query_lease_transactions。',
    expected: { periods: ['2026Q1', '2026Q2'], rent: [200, 190], sharedSample: 3, transactions: 8, futureSupply: null, sources: ['Q3', 'L1'] },
    tools: ['analyze_market_trends', 'query_lease_transactions'],
  },
];

function requestBound(rates) {
  return { input, output, amount: nanos((input * rates.input + output * rates.output) / 1e6) };
}

function createComparison(rates) {
  const rows = [];
  for (const spec of cases) {
    for (const mode of modes) {
      const messages = [
        { role: 'system', content: '只使用用户已获权的合成证据。禁止补造数值、来源或权限。返回 JSON 对象：facts 使用指定键，未知为 null；suggestedTools 使用可建议的工具名称；answer 为中文短答，说明单位及缺项。来源按证据出现的顺序。工具仅为建议，不执行。' },
        { role: 'user', content: `${spec.question}\n${spec.evidence}\nfacts 键：${Object.keys(spec.expected).join(', ')}。` },
      ];
      const options = { model: mode.model, reasoningEffort: mode.reasoningEffort, tools: [], responseFormat: 'json_object',
        maxOutputTokens: output, timeoutMs: 60_000 };
      const bound = requestBound(rates[mode.model]);
      if (envelope(messages, options, rates[mode.model]).input > bound.input) throw Error('COMPARISON_INPUT_ENVELOPE_EXCEEDED');
      rows.push({ id: `${spec.id}:${mode.name}`, spec, mode, messages, options, bound });
    }
  }
  return rows;
}

export function comparisonPlan() {
  const rows = createComparison(priceFloor);
  return {
    environment: 'authorized-synthetic-snapshots', currency, pricingSource: comparisonPricingSource,
    ratesPerMillion: priceFloor, liveConcurrency: 1, providerRequests: 0,
    totalProposedUsd: rows.reduce((sum, row) => sum + row.bound.amount, 0) / 1e9,
    maximumApprovalUsd: approvedCeiling / 1e9,
    rows: rows.map(({ id, mode, bound }) => ({ id, ...mode, thinking: mode.reasoningEffort ? 'enabled' : 'disabled',
      inputLimit: bound.input, outputLimit: bound.output, reservedUsd: bound.amount / 1e9, status: 'BUDGET_BLOCKED' })),
  };
}

function validateApproval(approval, revision) {
  const now = Date.now();
  const checkedAt = Date.parse(approval?.pricingCheckedAt);
  if (approval?.currency !== currency || approval.pricingSource !== comparisonPricingSource
    || !Number.isSafeInteger(approval.totalNanodollars) || approval.totalNanodollars <= 0
    || approval.totalNanodollars > approvedCeiling || typeof approval.taskId !== 'string' || !/^[a-z0-9-]{8,80}$/.test(approval.taskId)
    || typeof approval.runDirectory !== 'string' || !path.isAbsolute(approval.runDirectory)
    || path.basename(path.resolve(approval.runDirectory)) !== approval.taskId
    || !/^[0-9a-f]{40}$/.test(approval.commit) || approval.commit !== revision?.commit || revision.dirty) throw Error('COMPARISON_APPROVAL_REQUIRED');
  if (!Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt > 86_400_000) throw Error('PRICE_RECHECK_REQUIRED');
  const rates = {};
  for (const [model, floor] of Object.entries(priceFloor)) {
    const rate = approval.rates?.[model];
    if (!Number.isFinite(rate?.input) || rate.input < floor.input
      || !Number.isFinite(rate?.output) || rate.output < floor.output) throw Error('PRICE_UPPER_BOUND_REQUIRED');
    rates[model] = { input: rate.input, output: rate.output, cachedInput: rate.input };
  }
  const rows = createComparison(rates);
  if (rows.reduce((sum, row) => sum + row.bound.amount, 0) > approval.totalNanodollars) throw Error('COMPARISON_BUDGET_BLOCKED');
  return { rows, rates };
}

function assertResponse(content, spec) {
  let parsed;
  try { parsed = JSON.parse(content); } catch { return { json: false }; }
  const suppliedTools = parsed?.suggestedTools;
  return {
    json: true, facts: isDeepStrictEqual(parsed?.facts, spec.expected),
    tools: Array.isArray(suppliedTools) && isDeepStrictEqual([...suppliedTools].sort(), [...spec.tools].sort()),
    answer: typeof parsed?.answer === 'string' && parsed.answer.trim().length > 0 && parsed.answer.length <= 1600,
  };
}

export async function runModelComparison(approval, loadAdapter, revision) {
  const { rows, rates } = validateApproval(approval, revision);
  const adapter = await loadAdapter();
  const directory = path.resolve(approval.runDirectory);
  // Keep consumption outside the result directory so archiving it does not renew the approval.
  const receipt = path.join(path.dirname(directory), `.ai6-comparison-${approval.taskId}.receipt.json`);
  writeFileSync(receipt, JSON.stringify({ taskId: approval.taskId, revision, directory, consumedAt: new Date().toISOString() }) + '\n',
    { flag: 'wx', mode: 0o600, flush: true });
  mkdirSync(directory, { mode: 0o700 });
  const journal = path.join(directory, 'comparison.jsonl');
  const log = record => appendFileSync(journal, JSON.stringify(record) + '\n', { mode: 0o600 });
  const ledgers = new Map();
  let halted;
  let failures = 0;
  log({ type: 'plan', revision, taskId: approval.taskId, currency, approvedNanodollars: approval.totalNanodollars,
    pricingSource: comparisonPricingSource, pricingCheckedAt: approval.pricingCheckedAt, rates,
    planned: rows.map(({ id, bound }) => ({ id, ...bound })), actualBill: null });
  try {
    for (const [model, rate] of Object.entries(rates)) {
      const total = rows.filter(row => row.mode.model === model).reduce((sum, row) => sum + row.bound.amount, 0);
      ledgers.set(model, new BudgetLedger(path.join(directory, `${model}.sqlite`), { taskId: approval.taskId, model,
        total, acceptance: total, buffer: 0, currency, rates: rate,
        pricingSource: comparisonPricingSource, pricingCheckedAt: approval.pricingCheckedAt }));
    }
    for (const { id, mode, spec, messages, options, bound } of rows) {
      if (halted) { log({ type: 'result', id, status: 'NOT_RUN', reason: halted }); continue; }
      const ledger = ledgers.get(mode.model);
      ledger.startWorkflow(id, 'acceptance', bound.amount);
      ledger.reserve(id, id, bound.amount, { ...mode, ...bound });
      ledger.sent(id);
      let result;
      const start = performance.now();
      try { result = await adapter(messages, AbortSignal.timeout(options.timeoutMs), undefined, options); }
      catch (error) {
        ledger.unknown(id);
        halted = ['unauthorized', 'payment_required', 'rate_limited', 'model_not_found', 'timeout'].includes(error?.code)
          ? error.code : 'SUPPLIER_OUTCOME_UNKNOWN';
      }
      const durationMs = Math.round(performance.now() - start);
      if (!halted && (result.inputTokens == null || result.outputTokens == null)) {
        ledger.unknown(id);
        halted = 'USAGE_MISSING';
      }
      if (halted) { log({ type: 'result', id, status: 'BLOCKED', reason: halted, durationMs }); continue; }
      const usage = { model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        cachedInputTokens: result.cachedInputTokens, reasoningTokens: result.reasoningTokens,
        providerRequestId: result.providerRequestId };
      let estimated;
      try { estimated = ledger.settle(id, usage, bound); } catch { halted = 'INVALID_PROVIDER_USAGE'; }
      halted ??= ledger.snapshot().halted ?? undefined;
      if (halted) { log({ type: 'result', id, status: 'BLOCKED', reason: halted, durationMs, usage }); continue; }
      ledger.finishWorkflow(id);
      const assertions = assertResponse(result.message.content, spec);
      const passed = Object.values(assertions).every(Boolean);
      if (!passed) failures++;
      log({ type: 'result', id, status: passed ? 'PARTIAL' : 'FAIL', ...mode, usage, durationMs,
        assertions, estimatedNanodollars: estimated, ...(passed ? { answer: JSON.parse(result.message.content).answer } : {}) });
    }
    const totals = [...ledgers.values()].map(ledger => ledger.snapshot());
    const summary = { type: 'summary', failures, halted: halted ?? null, actualBill: null,
      estimatedNanodollars: totals.reduce((sum, state) => sum + state.settled, 0),
      pendingNanodollars: totals.reduce((sum, state) => sum + state.pending, 0),
      providerAttempts: totals.reduce((sum, state) => sum + state.requests.length, 0) };
    log(summary);
    return { journal, ...summary };
  } finally {
    for (const ledger of ledgers.values()) ledger.close();
  }
}
