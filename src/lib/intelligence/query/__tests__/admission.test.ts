import { describe, expect, it, vi } from 'vitest';
import { authorizePlan, runAuditedQuery, runAuditedSubmission, type AuditPort, type QueryAuthority } from '../admission';
import { parseQueryPlan } from '../plan';

const authority: QueryAuthority = { actorId: 'actor', effectiveUserId: 'effective', sessionActive: true, policyVersion: 'v1', permissionRevision: 'r1', grants: ['query:catalog', 'query:brochure'], fields: ['height'] };
const plan = { operation: 'rank', scope: { inventory: 'tracked', submarkets: ['CBD'] }, field: 'height', period: null, direction: 'desc', limit: 1 };
const request = () => ({ requestId: crypto.randomUUID(), submittedText: 'CBD最高的楼？', plan, authority, signal: new AbortController().signal });
const ports = () => ({ audit: { receive: vi.fn().mockResolvedValue({ replayed: false }), append: vi.fn().mockResolvedValue(undefined) } satisfies AuditPort, execution: { freshAuthority: vi.fn().mockResolvedValue(authority), execute: vi.fn().mockResolvedValue({ answer: '仅已知高度记录中的最高楼', resultId: 'synthetic' }) } });

describe('fail-closed audited query admission', () => {
  it('records a server deadline as failure rather than falsely claiming the user cancelled', async () => {
    const { audit, execution } = ports();
    const controller = new AbortController(); controller.abort(new DOMException('deadline', 'TimeoutError'));
    expect(await runAuditedSubmission({ ...request(), signal: controller.signal }, audit, execution)).toEqual({ status: 'failed' });
    expect(audit.append).toHaveBeenCalledWith(expect.anything(), 'failed', expect.objectContaining({ reason: 'execution_deadline_exceeded' }));
  });
  it('records submitted text before even checking whether the user has feature eligibility', async () => {
    const { audit, execution } = ports();
    execution.freshAuthority.mockImplementation(async () => {
      expect(audit.receive).toHaveBeenCalledOnce();
      throw new Error('QUERY_DENIED');
    });
    expect(await runAuditedSubmission(request(), audit, execution)).toEqual({ status: 'denied' });
    expect(audit.append).toHaveBeenCalledWith(expect.anything(), 'denied', expect.anything());
    expect(execution.execute).not.toHaveBeenCalled();
  });
  it('rechecks eligibility on duplicate submissions without rerunning or rewriting their terminal state', async () => {
    const { audit, execution } = ports();
    audit.receive.mockResolvedValue({ replayed: true });
    execution.freshAuthority.mockRejectedValue(new Error('QUERY_DENIED'));
    expect(await runAuditedSubmission(request(), audit, execution)).toEqual({ status: 'denied' });
    expect(execution.execute).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });
  it('does not read data when durable receipt fails', async () => {
    const { audit, execution } = ports();
    audit.receive.mockRejectedValue(new Error('storage unavailable'));
    await expect(runAuditedQuery(request(), audit, execution)).rejects.toThrow('storage unavailable');
    expect(execution.execute).not.toHaveBeenCalled();
    expect(execution.freshAuthority).not.toHaveBeenCalled();
  });
  it('audits forbidden questions before rejecting; field/filter rights cannot be implied by admin', async () => {
    const { audit, execution } = ports();
    execution.freshAuthority.mockResolvedValue({ ...authority, grants: [], role: 'admin' });
    expect((await runAuditedQuery(request(), audit, execution)).status).toBe('denied');
    expect(audit.receive).toHaveBeenCalledOnce();
    expect(execution.execute).not.toHaveBeenCalled();
    const filtered = parseQueryPlan({ ...plan, filter: { field: 'netEffectiveRent', operator: 'gt', value: '200' } });
    expect(() => authorizePlan(filtered, authority)).toThrow('QUERY_DENIED');
  });
  it('never reruns an already-received idempotent request', async () => {
    const { audit, execution } = ports();
    audit.receive.mockResolvedValue({ replayed: true });
    expect((await runAuditedQuery(request(), audit, execution)).status).toBe('already_received');
    expect(execution.execute).not.toHaveBeenCalled();
  });
  it('checks current authority again after reading and suppresses a revoked result', async () => {
    const { audit, execution } = ports();
    execution.execute.mockImplementation(async () => {
      execution.freshAuthority.mockResolvedValue({ ...authority, sessionActive: false });
      return { answer: 'sensitive result', resultId: 'synthetic' };
    });
    expect(await runAuditedQuery(request(), audit, execution)).toEqual({ status: 'denied' });
    expect(audit.append).not.toHaveBeenCalledWith(expect.anything(), 'response_generated', expect.anything());
  });
  it('does not deliver an answer if result-audit persistence fails', async () => {
    const { audit, execution } = ports();
    audit.append.mockImplementation(async (_id, kind) => { if (kind === 'response_generated') throw new Error('audit unavailable'); });
    expect(await runAuditedQuery(request(), audit, execution)).toEqual({ status: 'failed' });
    expect(execution.execute).toHaveBeenCalledOnce();
  });
  it('preserves cancellation and distinguishes generated from delivered output', async () => {
    const { audit, execution } = ports();
    const controller = new AbortController();
    execution.execute.mockImplementation(async () => { controller.abort(); return { answer: 'late', resultId: 'synthetic' }; });
    expect(await runAuditedQuery({ ...request(), signal: controller.signal }, audit, execution)).toEqual({ status: 'cancelled' });
    const next = ports();
    expect((await runAuditedQuery(request(), next.audit, next.execution)).status).toBe('ready');
    expect(next.audit.append).toHaveBeenCalledWith(expect.anything(), 'succeeded', { delivery: 'not_yet_sent' });
  });
  it('appends a delivery suppression correction if permission changes after execution completion', async () => {
    const { audit, execution } = ports();
    audit.append.mockImplementation(async (_id, kind) => {
      if (kind === 'succeeded') execution.freshAuthority.mockResolvedValue({ ...authority, permissionRevision: 'revoked' });
    });
    expect(await runAuditedQuery(request(), audit, execution)).toEqual({ status: 'denied' });
    expect(audit.append).toHaveBeenLastCalledWith(expect.anything(), 'correction', expect.objectContaining({ delivery: 'not_sent', status: 'denied' }));
  });
  it('records a bounded query scope failure without claiming an answer or recoverable execution', async () => {
    const { audit, execution } = ports();
    execution.execute.mockRejectedValue(new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB'));
    expect(await runAuditedQuery(request(), audit, execution)).toEqual({ status: 'failed', reason: 'scope_limit' });
    expect(audit.append).toHaveBeenLastCalledWith(expect.anything(), 'failed', expect.objectContaining({ reason: 'query_scope_limit', delivery: 'not_sent' }));
    expect(audit.append.mock.calls.some(([, kind]) => ['response_generated', 'succeeded'].includes(kind))).toBe(false);
  });
  it('does not convert arbitrary failures, audit errors or timeouts into a scope explanation', async () => {
    const unknown = ports(); unknown.execution.execute.mockRejectedValue(new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB:private-detail'));
    expect(await runAuditedQuery(request(), unknown.audit, unknown.execution)).toEqual({ status: 'failed' });
    const storage = ports();
    storage.audit.append.mockImplementation(async (_id, kind) => { if (kind === 'response_generated') throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB'); });
    expect(await runAuditedQuery(request(), storage.audit, storage.execution)).toEqual({ status: 'failed' });
    const timeout = ports(), controller = new AbortController();
    timeout.execution.execute.mockImplementation(async () => { controller.abort(new DOMException('deadline', 'TimeoutError')); throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB'); });
    expect(await runAuditedQuery({ ...request(), signal: controller.signal }, timeout.audit, timeout.execution)).toEqual({ status: 'failed' });
  });
  it('still refuses delivery if persisting the scope-limit terminal audit fails', async () => {
    const { audit, execution } = ports(); execution.execute.mockRejectedValue(new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB'));
    audit.append.mockImplementation(async (_id, kind) => { if (kind === 'failed') throw new Error('audit unavailable'); });
    await expect(runAuditedQuery(request(), audit, execution)).rejects.toThrow('audit unavailable');
  });
});
