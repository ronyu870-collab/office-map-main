// Task-local SQLite ledger. This is evaluation tooling, never a shared-key bill cap.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const integer = n => { if (!Number.isSafeInteger(n) || n < 0) throw Error('INVALID_AMOUNT'); return n; };
export const nanos = amount => integer(Math.ceil(amount * 1e9));
export function envelope(messages, options, rates) {
  const messageBytes = Buffer.byteLength(JSON.stringify(messages)), toolBytes = Buffer.byteLength(JSON.stringify(options.tools));
  const continuationBytes = messages.reduce((n, m) => n + integer(m.continuationBudgetBytes ?? 0), 0), framingBytes = 1024;
  const input = messageBytes + toolBytes + continuationBytes + framingBytes;
  const output = integer(options.maxOutputTokens);
  if (!output) throw Error('OUTPUT_CAP_REQUIRED');
  return { input, output, messageBytes, toolBytes, continuationBytes, framingBytes,
    amount: nanos((input * rates.input + output * rates.output) / 1e6) };
}
export function usageCost(value, rates) {
  const input = integer(value.inputTokens), output = integer(value.outputTokens);
  // DeepSeek prompt_tokens includes cache hits; completion_tokens includes reasoning.
  const cached = integer(value.cachedInputTokens ?? 0), reasoning = integer(value.reasoningTokens ?? 0);
  if (cached > input || reasoning > output) throw Error('INVALID_USAGE');
  return nanos(((input - cached) * rates.input + cached * rates.cachedInput + output * rates.output) / 1e6);
}

export class BudgetLedger {
  constructor(file, config) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file); chmodSync(file, 0o600);
    this.db.exec(`PRAGMA busy_timeout=10000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL, halted TEXT);
      CREATE TABLE IF NOT EXISTS pools (id TEXT PRIMARY KEY, kind TEXT NOT NULL, remaining INTEGER NOT NULL CHECK(remaining>=0), closed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, pool TEXT NOT NULL, state TEXT NOT NULL,
        reserved INTEGER NOT NULL, estimated INTEGER, metadata TEXT NOT NULL, usage TEXT);`);
    if (config) this.tx(() => {
      const saved = this.db.prepare('SELECT config FROM settings WHERE id=1').get();
      if (saved) { if (saved.config !== JSON.stringify(config)) throw Error('IMMUTABLE_BUDGET_CONFIG'); return; }
      integer(config.total); integer(config.acceptance); integer(config.buffer);
      if (config.acceptance + config.buffer > config.total || !['USD', 'CNY'].includes(config.currency)) throw Error('INVALID_BUDGET');
      if (!config.taskId || !config.model || !config.pricingSource || !config.pricingCheckedAt) throw Error('PRICING_METADATA_REQUIRED');
      for (const r of ['input', 'cachedInput', 'output']) if (!Number.isFinite(config.rates?.[r]) || config.rates[r] < 0) throw Error('INVALID_RATES');
      if (config.rates.cachedInput > config.rates.input) throw Error('INVALID_RATES');
      this.db.prepare('INSERT INTO settings VALUES(1,?,NULL)').run(JSON.stringify(config));
      this.db.prepare('INSERT INTO pools(id,kind,remaining) VALUES(?,?,?)').run('acceptance-hold', 'hold', config.acceptance);
      this.db.prepare('INSERT INTO pools(id,kind,remaining) VALUES(?,?,?)').run('buffer-hold', 'hold', config.buffer);
    });
    const row = this.db.prepare('SELECT config FROM settings WHERE id=1').get();
    if (!row) throw Error('BUDGET_NOT_INITIALIZED');
    this.config = JSON.parse(row.config);
  }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  snapshot() {
    const requests = this.db.prepare('SELECT * FROM requests ORDER BY rowid').all();
    const pools = this.db.prepare('SELECT * FROM pools ORDER BY id').all();
    const settled = requests.reduce((n, r) => n + (r.state === 'settled' ? r.estimated : 0), 0);
    const pending = requests.reduce((n, r) => n + (['reserved', 'sent', 'unresolved'].includes(r.state) ? r.reserved : 0), 0);
    const held = pools.reduce((n, p) => n + p.remaining, 0);
    return { config: this.config, settled, pending, held, available: this.config.total - settled - pending - held,
      halted: this.db.prepare('SELECT halted FROM settings WHERE id=1').get().halted,
      actualBill: null, billingStatus: 'not_reconciled', requests, pools };
  }
  active() { if (this.snapshot().halted) throw Error('BUDGET_HALTED'); }
  startWorkflow(id, phase, amount) {
    return this.tx(() => {
      this.active(); integer(amount);
      if (!['diagnostic', 'acceptance', 'buffer'].includes(phase) || !amount) throw Error('INVALID_WORKFLOW');
      if (phase === 'diagnostic') {
        if (amount > this.snapshot().available) throw Error('BUDGET_BLOCKED');
      } else {
        const hold = this.db.prepare('SELECT remaining FROM pools WHERE id=?').get(phase + '-hold');
        if (amount > hold.remaining) throw Error('BUDGET_BLOCKED');
        this.db.prepare('UPDATE pools SET remaining=remaining-? WHERE id=?').run(amount, phase + '-hold');
      }
      this.db.prepare('INSERT INTO pools(id,kind,remaining) VALUES(?,?,?)').run(id, phase, amount);
    });
  }
  reserve(id, pool, amount, metadata = {}) {
    return this.tx(() => {
      this.active(); integer(amount);
      const row = this.db.prepare('SELECT * FROM pools WHERE id=?').get(pool);
      if (!row || row.closed || row.kind === 'hold' || amount > row.remaining) throw Error('BUDGET_BLOCKED');
      this.db.prepare('INSERT INTO requests VALUES(?,?,\'reserved\',?,NULL,?,NULL)').run(id, pool, amount, JSON.stringify(metadata));
      this.db.prepare('UPDATE pools SET remaining=remaining-? WHERE id=?').run(amount, pool);
    });
  }
  sent(id) { this.transition(id, ['reserved'], 'sent', true); }
  unknown(id) { this.transition(id, ['sent'], 'unresolved'); }
  transition(id, from, to, requireActive = false) {
    return this.tx(() => {
      if (requireActive) this.active();
      const row = this.db.prepare('SELECT state FROM requests WHERE id=?').get(id);
      if (!row || !from.includes(row.state)) throw Error('INVALID_TRANSITION');
      this.db.prepare('UPDATE requests SET state=? WHERE id=?').run(to, id);
    });
  }
  releaseNotSent(id) {
    return this.tx(() => {
      const row = this.db.prepare('SELECT * FROM requests WHERE id=?').get(id);
      if (row?.state !== 'reserved') throw Error('REQUEST_MAY_HAVE_BEEN_SENT');
      this.db.prepare('UPDATE requests SET state=\'released\' WHERE id=?').run(id);
      this.db.prepare('UPDATE pools SET remaining=remaining+? WHERE id=?').run(row.reserved, row.pool);
    });
  }
  settle(id, usage, bound) {
    // Invalid usage leaves the existing reservation intact and stops all workers.
    let amount;
    try {
      if (usage.model && ![this.config.model, ...(this.config.returnedModels ?? [])].includes(usage.model)) throw Error('UNPRICED_RETURNED_MODEL');
      amount = usageCost(usage, this.config.rates);
    }
    catch (e) { this.tx(() => this.db.prepare('UPDATE settings SET halted=? WHERE id=1').run('invalid_usage')); throw e; }
    return this.tx(() => {
      const row = this.db.prepare('SELECT * FROM requests WHERE id=?').get(id);
      if (!row || !['sent', 'unresolved'].includes(row.state)) throw Error('INVALID_TRANSITION');
      this.db.prepare('UPDATE requests SET state=\'settled\',estimated=?,usage=? WHERE id=?').run(amount, JSON.stringify(usage), id);
      this.db.prepare('UPDATE pools SET remaining=remaining+? WHERE id=?').run(Math.max(0, row.reserved - amount), row.pool);
      if (amount > row.reserved || usage.inputTokens > bound.input || usage.outputTokens > bound.output)
        this.db.prepare('UPDATE settings SET halted=? WHERE id=1').run('usage_exceeded_reservation');
      return amount;
    });
  }
  finishWorkflow(id) {
    return this.tx(() => {
      const row = this.db.prepare('SELECT * FROM pools WHERE id=?').get(id);
      if (!row || row.kind === 'hold' || row.closed) throw Error('INVALID_WORKFLOW');
      if (this.db.prepare("SELECT 1 FROM requests WHERE pool=? AND state IN ('reserved','sent','unresolved') LIMIT 1").get(id)) throw Error('UNSETTLED_WORKFLOW');
      if (row.kind !== 'diagnostic') this.db.prepare('UPDATE pools SET remaining=remaining+? WHERE id=?').run(row.remaining, row.kind + '-hold');
      this.db.prepare('UPDATE pools SET remaining=0,closed=1 WHERE id=?').run(id);
    });
  }
  close() { this.db.close(); }
}

/** Decorates the existing adapter; every supplier attempt draws from one durable task pool.
 * Mark sent BEFORE entering adapter: crashes, cancellation and malformed responses retain funds. */
export function budgetedAdapter(adapter, ledger, workflow, attemptPrefix) {
  let sequence = 0;
  return async (messages, signal, onDelta, options) => {
    signal.throwIfAborted();
    if (options.model !== ledger.config.model) throw Error('MODEL_CONFIG_CHANGED');
    const bound = envelope(messages, options, ledger.config.rates), id = `${attemptPrefix}:${++sequence}`;
    ledger.reserve(id, workflow, bound.amount, { model: options.model, thinking: 'disabled', ...bound });
    ledger.sent(id);
    let result;
    try { result = await adapter(messages, signal, onDelta, options); }
    catch (e) { ledger.unknown(id); throw e; }
    if (result.inputTokens === null || result.outputTokens === null) ledger.unknown(id);
    else ledger.settle(id, { inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      cachedInputTokens: result.cachedInputTokens, reasoningTokens: result.reasoningTokens,
      model: result.model, providerRequestId: result.providerRequestId }, bound);
    if (ledger.snapshot().halted) throw Error('BUDGET_HALTED');
    return result;
  };
}
