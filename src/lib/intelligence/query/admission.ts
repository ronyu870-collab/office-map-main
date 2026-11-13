import type { QueryPlan } from './plan';
import { parseQueryPlan } from './plan';
import { numericFields, type NumericField } from './registry';

export type QueryGrant = 'query:catalog' | 'query:brochure' | 'query:quarter';
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
  const fields: readonly NumericField[] = plan.operation === 'list' ? plan.fields : plan.operation === 'rank' ? [plan.field]
    : plan.metric === 'rent' ? ['totalArea', 'netEffectiveRent'] : plan.metric === 'vacancy' ? ['totalArea', 'vacantArea'] : ['totalArea'];
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
  append: (requestId: string, kind: 'running' | 'response_generated' | 'succeeded' | 'denied' | 'failed' | 'cancelled' | 'correction' | 'delivery_receipt', detail: unknown) => Promise<void>;
};
export type QueryExecutionPort<T> = {
  freshAuthority: () => Promise<QueryAuthority>;
  execute: (plan: QueryPlan, authority: QueryAuthority, signal: AbortSignal) => Promise<T>;
};

/** A reusable execution boundary; it is not an enabled HTTP endpoint or a substitute for durable storage. */
type AuditedRequest = { requestId: string; submittedText: string; plan: unknown; authority: QueryAuthority; signal: AbortSignal; metadata?: unknown };
type ExecutionResult<T> = { status: 'ready'; result: T } | { status: 'already_received' | 'denied' | 'cancelled' | 'failed' };

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
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    const timedOut = request.signal.aborted && request.signal.reason?.name === 'TimeoutError';
    const status = timedOut ? 'failed' : request.signal.aborted || reason === 'QUERY_CANCELLED' ? 'cancelled' : reason === 'QUERY_DENIED' ? 'denied' : 'failed';
    if (!receipt.replayed) await audit.append(request.requestId, status, { status, delivery: 'not_sent', reason: timedOut ? 'execution_deadline_exceeded' : 'admission_not_granted' });
    return { status };
  }
  if (receipt.replayed) return { status: 'already_received' };
  return executeReceived({ ...request, authority }, audit, execution);
}

async function executeReceived<T>(request: AuditedRequest, audit: AuditPort, execution: QueryExecutionPort<T>): Promise<ExecutionResult<T>> {
  let executionRecorded = false;
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
    await audit.append(request.requestId, 'running', { policyVersion: authority.policyVersion, permissionRevision: authority.permissionRevision, authority });
    const beforeRead = await recheck(plan);
    const result = await execution.execute(plan, beforeRead, request.signal);
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
    // Storage failures propagate if terminal recording is also unavailable; never deliver the result.
    await audit.append(request.requestId, executionRecorded ? 'correction' : status, { delivery: 'not_sent', status, reason: timedOut ? 'execution_deadline_exceeded' : status === 'denied' ? 'authorization_or_plan_rejected' : status === 'cancelled' ? 'request_cancelled' : 'execution_unavailable' });
    return { status };
  }
}
