import type { QueryPlan } from './plan';
import { parseQueryPlan, planOutputFields } from './plan';
import { numericFields, type NumericField } from './registry';
import type { QuestionClarification } from './question';

export type QueryGrant = 'query:catalog' | 'query:brochure' | 'query:quarter' | 'export:internal';
/** Produced by a fresh trusted server authorization lookup, never by a request body. */
export type QueryAuthority = Readonly<{
  actorId: string;
  effectiveUserId: string;
  sessionActive: boolean;
  policyVersion: string;
  permissionRevision: string;
  grants: readonly QueryGrant[];
  fields: readonly NumericField[];
}>;

export function authorizePlan(plan: QueryPlan, authority: QueryAuthority): void {
  if (!authority.sessionActive || !authority.actorId || !authority.effectiveUserId || !authority.policyVersion || !authority.permissionRevision) throw new Error('QUERY_DENIED');
  const fields = planOutputFields(plan);
  const required = new Set<NumericField>(fields);
  const visit = (filter: NonNullable<QueryPlan['filter']>) => {
    if ('terms' in filter) filter.terms.forEach(visit);
    else required.add(filter.field);
  };
  if (plan.filter) visit(plan.filter);
  if (!authority.grants.includes('query:catalog')) throw new Error('QUERY_DENIED');
  for (const field of required) {
    const grant = numericFields[field].temporal === 'quarter' ? 'query:quarter' : 'query:brochure';
    if (!authority.fields.includes(field) || !authority.grants.includes(grant)) throw new Error('QUERY_DENIED');
  }
  // This is function/field admission only. The data adapter must separately apply
  // current row/source ACLs and the validated scope, including aggregate inputs.
}

export type AuditPort = {
  receive: (request: { requestId: string; submittedText: string; plan: unknown; authority: QueryAuthority; metadata?: unknown }) => Promise<{ replayed: boolean }>;
  append: (requestId: string, kind: 'running' | 'tool_started' | 'tool_finished' | 'accounting' | 'response_generated' | 'succeeded' | 'denied' | 'failed' | 'cancelled' | 'correction' | 'delivery_receipt', detail: unknown) => Promise<void>;
};
export type QueryExecutionPort<T> = {
  freshAuthority: () => Promise<QueryAuthority>;
  execute: (plan: QueryPlan, authority: QueryAuthority, signal: AbortSignal) => Promise<T>;
  /** Runs only after durable receipt and fresh authorization; at most once per request. */
  prepare?: (authority: QueryAuthority) => Promise<{ plan: unknown; clarification?: QuestionClarification; metadata?: unknown }>;
  /** Restores an already audited interpretation, never calls the model or business reader. */
  replay?: (authority: QueryAuthority) => Promise<{ plan?: unknown; clarification?: QuestionClarification }>;
};

/** A reusable execution boundary; it is not an enabled HTTP endpoint or a substitute for durable storage. */
type AuditedRequest = { requestId: string; submittedText: string; plan: unknown; authority: QueryAuthority; signal: AbortSignal; metadata?: unknown; clarification?: QuestionClarification; resolutionMetadata?: unknown; preparationStarted?: boolean };
type ExecutionResult<T> = { status: 'ready'; result: T } | { status: 'clarification'; clarification: QuestionClarification }
  | { status: 'already_received' | 'denied' | 'cancelled' } | { status: 'failed'; reason?: 'scope_limit' };

export async function runAuditedQuery<T>(
  request: AuditedRequest,
  audit: AuditPort,
  execution: QueryExecutionPort<T>,
): Promise<ExecutionResult<T>> {
  // Even invalid/denied plans are recorded. No database query or model invocation precedes this await.
  const receipt = await audit.receive(request);
  if (receipt.replayed) return { status: 'already_received' };
  return executeReceived(request, audit, execution);
}

/** HTTP admission records a verified actor's full submission before querying
 * feature eligibility. The initial authority is explicitly unevaluated, not a grant. */
export async function runAuditedSubmission<T>(request: AuditedRequest, audit: AuditPort, execution: QueryExecutionPort<T>): Promise<ExecutionResult<T>> {
  const receipt = await audit.receive(request);
  let authority: QueryAuthority;
  try {
    if (request.signal.aborted) throw new Error('QUERY_CANCELLED');
    authority = await execution.freshAuthority();
    if (authority.actorId !== request.authority.actorId || authority.effectiveUserId !== request.authority.effectiveUserId) throw new Error('QUERY_DENIED');
    if (execution.prepare) {
      authorizePlan({ operation: 'list', fields: [], period: null, scope: { inventory: 'all_authorized' } }, authority);
      if (receipt.replayed) {
        const saved = await execution.replay?.(authority);
        if (saved?.plan) authorizePlan(parseQueryPlan(saved.plan), authority);
        if (saved?.clarification) return { status: 'clarification', clarification: saved.clarification };
        return { status: 'already_received' };
      }
      await audit.append(request.requestId, 'running', { phase: 'planning', policyVersion: authority.policyVersion,
        permissionRevision: authority.permissionRevision, authority });
      const prepared = await execution.prepare(authority);
      const current = await execution.freshAuthority();
      if (current.permissionRevision !== authority.permissionRevision || current.policyVersion !== authority.policyVersion) throw new Error('QUERY_DENIED');
      request = { ...request, plan: prepared.plan, clarification: prepared.clarification, resolutionMetadata: prepared.metadata, preparationStarted: true };
    }
    if (request.clarification) authorizePlan({ operation: 'list', fields: [], period: null, scope: { inventory: 'all_authorized' } }, authority);
    if (receipt.replayed && !request.clarification) {
      // A retry is not a new execution, but withdrawn tool/field access must
      // still reject before reporting that the request can be resumed.
      try { authorizePlan(parseQueryPlan(request.plan), authority); }
      catch { throw new Error('QUERY_DENIED'); }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    const timedOut = request.signal.aborted && request.signal.reason?.name === 'TimeoutError';
    const status = timedOut ? 'failed' : request.signal.aborted || reason === 'QUERY_CANCELLED' ? 'cancelled' : reason === 'QUERY_DENIED' ? 'denied' : 'failed';
    if (!receipt.replayed) await audit.append(request.requestId, status, { status, delivery: 'not_sent', reason: timedOut ? 'execution_deadline_exceeded' : 'admission_not_granted' });
    return { status };
  }
  if (request.clarification) {
    // The attempted query is refused until its conditions are understood. This
    // is not a successful factual result and cannot be recovered as one.
    if (!receipt.replayed) await audit.append(request.requestId, 'denied', {
      reason: 'clarification_required', response: request.clarification, authority, delivery: 'not_yet_sent',
      ...(request.resolutionMetadata ? { resolution: request.resolutionMetadata } : {}),
    });
    return { status: 'clarification', clarification: request.clarification };
  }
  if (receipt.replayed) return { status: 'already_received' };
  return executeReceived({ ...request, authority }, audit, execution);
}

async function executeReceived<T>(request: AuditedRequest, audit: AuditPort, execution: QueryExecutionPort<T>): Promise<ExecutionResult<T>> {
  let executionRecorded = false;
  let executionPending = false;
  const recheck = async (plan: QueryPlan) => {
    if (request.signal.aborted) throw new Error('QUERY_CANCELLED');
    const current = await execution.freshAuthority();
    if (current.actorId !== request.authority.actorId || current.effectiveUserId !== request.authority.effectiveUserId || current.permissionRevision !== request.authority.permissionRevision || current.policyVersion !== request.authority.policyVersion) throw new Error('QUERY_DENIED');
    authorizePlan(plan, current);
    return current;
  };
  try {
    let plan: QueryPlan;
    try { plan = parseQueryPlan(request.plan); } catch { throw new Error('QUERY_DENIED'); }
    const authority = await recheck(plan);
    await audit.append(request.requestId, request.preparationStarted ? 'tool_finished' : 'running', { policyVersion: authority.policyVersion, permissionRevision: authority.permissionRevision, authority,
      ...(request.resolutionMetadata ? { plan, resolution: request.resolutionMetadata } : {}) });
    const beforeRead = await recheck(plan);
    executionPending = true;
    const result = await execution.execute(plan, beforeRead, request.signal);
    executionPending = false;
    await recheck(plan);
    await audit.append(request.requestId, 'response_generated', { result });
    await recheck(plan);
    await audit.append(request.requestId, 'succeeded', { delivery: 'not_yet_sent' });
    executionRecorded = true;
    await recheck(plan);
    return { status: 'ready', result };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const timedOut = request.signal.aborted && request.signal.reason?.name === 'TimeoutError';
    const status = timedOut ? 'failed' : request.signal.aborted || message === 'QUERY_CANCELLED' ? 'cancelled' : message === 'QUERY_DENIED' ? 'denied' : 'failed';
    // Only the trusted executor's exact capacity sentinel is user-actionable.
    // Audit, permission, cancellation and arbitrary provider errors stay opaque.
    const scopeLimited = executionPending && status === 'failed' && !request.signal.aborted && message === 'QUERY_SCOPE_REQUIRES_BACKGROUND_JOB';
    // Storage failures propagate if terminal recording is also unavailable; never deliver the result.
    await audit.append(request.requestId, executionRecorded ? 'correction' : status, { delivery: 'not_sent', status, reason: timedOut ? 'execution_deadline_exceeded' : status === 'denied' ? 'authorization_or_plan_rejected' : status === 'cancelled' ? 'request_cancelled' : scopeLimited ? 'query_scope_limit' : 'execution_unavailable' });
    return scopeLimited ? { status: 'failed', reason: 'scope_limit' } : { status };
  }
}
