import { describe, expect, it, vi } from 'vitest';
import { authorizePlan, runAuditedQuery, type AuditPort, type QueryAuthority } from '../admission';
import { parseQueryPlan } from '../plan';

const authority: QueryAuthority = { actorId: 'actor', effectiveUserId: 'effective', sessionActive: true, policyVersion: 'v1', permissionRevision: 'r1', grants: ['query:catalog', 'query:brochure'], fields: ['height'] };
const plan = { operation: 'rank', scope: { inventory: 'tracked', submarkets: ['CBD'] }, field: 'height', period: null, direction: 'desc', limit: 1 };
const request = () => ({ requestId: crypto.randomUUID(), submittedText: 'CBD最高的楼？', plan, authority, signal: new AbortController().signal });
const ports = () => ({ audit: { receive: vi.fn().mockResolvedValue({ replayed: false }), append: vi.fn().mockResolvedValue(undefined) } satisfies AuditPort, execution: { freshAuthority: vi.fn().mockResolvedValue(authority), execute: vi.fn().mockResolvedValue({ answer: '仅已知高度记录中的最高楼', resultId: 'synthetic' }) } });

describe('fail-closed audited query admission', () => {
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
});
