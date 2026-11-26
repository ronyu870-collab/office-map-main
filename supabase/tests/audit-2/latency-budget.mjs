import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Preserve the existing P95 allowance; malformed or incomplete samples are
 * test errors, never retryable latency noise. */
export function assessLatencyBudget(operation, before, after) {
  for (const sample of [before, after]) {
    assert.equal(sample.samples, 100, operation + ' requires 100 measured observations');
    assert.ok(Number.isFinite(sample.p95Ms) && sample.p95Ms >= 0, operation + ' invalid P95');
  }
  const addedP95Ms = after.p95Ms - before.p95Ms;
  const limitMs = Math.max(10, before.p95Ms * 0.03);
  return { operation, beforeP95Ms: before.p95Ms, afterP95Ms: after.p95Ms, addedP95Ms, limitMs, withinBudget: addedP95Ms <= limitMs };
}

export class LatencyBudgetExceeded extends Error {
  constructor(failures) {
    super('Audit 2 P95 budget exceeded: ' + JSON.stringify(failures));
    this.name = 'LatencyBudgetExceeded';
    this.failures = failures;
  }
}

export function assertLatencyBudgets(assessments) {
  assert.ok(assessments.length > 0, 'Missing latency assessments');
  const failures = assessments.filter(item => !item.withinBudget);
  if (failures.length) throw new LatencyBudgetExceeded(failures);
}

/** Report every measurement before any timing assertion, including failed
 * attempts. Keep the original artifact filename for downstream consumers. */
export async function writeLatencyEvidence(name, attempt, report, directory = 'verification/audit-2') {
  assert.ok(attempt === 1 || attempt === 2, 'Invalid attempt');
  const evidence = { ...report, attempt, latencyStatus: report.latency.every(item => item.withinBudget) ? 'within_budget' : 'over_budget' };
  await mkdir(directory, { recursive: true });
  const content = JSON.stringify(evidence, null, 2);
  await writeFile(join(directory, name + '-attempt-' + attempt + '.json'), content);
  await writeFile(join(directory, name + '.json'), content);
  console.log(JSON.stringify({ event: 'audit_2_latency_measurement', suite: name, ...evidence }));
  return evidence;
}

/** A single, independent before/after repeat is allowed ONLY after every
 * behavioral assertion in the first attempt succeeds. The caller owns fresh
 * disposable DB creation and cleanup. Functional, SQL, invalid-evidence and
 * cleanup errors propagate unchanged; a second timing breach fails the job. */
export async function withLatencyRecheck(verify, notify = event => console.warn(JSON.stringify(event))) {
  try {
    const value = await verify(1);
    return { attempts: 1, value };
  } catch (error) {
    if (!(error instanceof LatencyBudgetExceeded)) throw error;
    notify({ event: 'audit_2_latency_recheck', firstAttempt: 'over_budget', failures: error.failures, nextAttempt: 2 });
    const value = await verify(2);
    notify({ event: 'audit_2_latency_recheck_result', status: 'passed_on_independent_recheck', firstAttempt: 'over_budget', attempts: 2 });
    return { attempts: 2, value };
  }
}
