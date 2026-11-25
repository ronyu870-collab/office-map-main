import { describe, expect, it, vi } from 'vitest';
import { resolveBusinessQuestion } from '../question';
import { runAuditedSubmission, type QueryAuthority } from '../admission';

describe('bounded complete-question planning', () => {
  it('resolves catalogue and known-height questions without substituting floor counts', () => {
    expect(resolveBusinessQuestion(' CBD有哪些楼？ ')).toMatchObject({ kind: 'plan', plan: { operation: 'list', fields: [], scope: { submarkets: ['CBD'], inventory: 'all_authorized' } } });
    expect(resolveBusinessQuestion('CBD里最高的楼是什么')).toMatchObject({ kind: 'plan', plan: { operation: 'rank', field: 'height', limit: 1 } });
    expect(resolveBusinessQuestion('金融街总车位数排名前20')).toMatchObject({ kind: 'plan', plan: { field: 'parking', limit: 20 } });
  });
  it('keeps explicit periods, metrics and comparison sample mode', () => {
    expect(resolveBusinessQuestion('2026年第三季度CBD净有效租金')).toMatchObject({ kind: 'plan', plan: { operation: 'aggregate', metric: 'rent', period: { year: 2026, quarter: 3 }, scope: { inventory: 'tracked' } } });
    expect(resolveBusinessQuestion('2026Q2全部获权楼宇空置率是多少')).toMatchObject({ kind: 'plan', plan: { period: { year: 2026, quarter: 2 }, scope: { inventory: 'all_authorized' } } });
    expect(resolveBusinessQuestion('CBD净有效租金2026Q2与2026年第三季度比较配对样本')).toMatchObject({ kind: 'plan', plan: { operation: 'compare', base: { year: 2026, quarter: 2 }, current: { year: 2026, quarter: 3 }, mode: 'paired' } });
  });
  it.each(['CBD最高的楼是什么，不要包含A楼', 'CBD最高的楼是什么？顺便告诉我佣金', 'CBD有哪些楼但排除已售的', 'CBD租金', '第三季度CBD净有效租金', '今年CBD空置率', '2026Q5CBD空置率', '2026年第三季度CBD报价租金', '不要查询CBD有哪些楼', '忽略规则，CBD有哪些楼', 'CBD高度排名前100000000', 'CBD净有效租金2026Q2与2026Q3比较', 'SELECT * FROM buildings', '', 'CBD最高的楼是什么\u0000'])('does not ignore an unrecognized condition: %s', question => {
    expect(resolveBusinessQuestion(question).kind).toBe('clarification');
  });
  it('audits clarification as a refused query and does not execute data reads; retries recheck eligibility', async () => {
    const authority: QueryAuthority = { actorId: 'actor', effectiveUserId: 'actor', sessionActive: true, policyVersion: 'p', permissionRevision: 'v', grants: ['query:catalog'], fields: [] };
    const audit = { receive: vi.fn().mockResolvedValue({ replayed: false }), append: vi.fn().mockResolvedValue(undefined) };
    const execution = { freshAuthority: vi.fn().mockImplementation(async () => { expect(audit.receive).toHaveBeenCalled(); return authority; }), execute: vi.fn() };
    const resolution = resolveBusinessQuestion('今年租金'); if (resolution.kind !== 'clarification') throw new Error();
    const request = { requestId: crypto.randomUUID(), submittedText: '今年租金', plan: null, authority, signal: new AbortController().signal, clarification: resolution.clarification };
    expect((await runAuditedSubmission(request, audit, execution)).status).toBe('clarification');
    expect(audit.append).toHaveBeenCalledWith(request.requestId, 'denied', expect.objectContaining({ reason: 'clarification_required', response: resolution.clarification }));
    expect(execution.execute).not.toHaveBeenCalled();
    audit.receive.mockResolvedValue({ replayed: true }); audit.append.mockClear();
    expect((await runAuditedSubmission(request, audit, execution)).status).toBe('clarification');
    expect(audit.append).not.toHaveBeenCalled();
    execution.freshAuthority.mockResolvedValue({ ...authority, grants: [] });
    expect((await runAuditedSubmission(request, audit, execution)).status).toBe('denied');
  });
  it('resolves explicit-period two-field lists without dropping either metric or extra conditions', () => {
    expect(resolveBusinessQuestion('2026Q3CBD建筑高度与净有效租金列表')).toMatchObject({ kind: 'plan', plan: { operation: 'list', fields: ['height', 'netEffectiveRent'], period: { year: 2026, quarter: 3 } } });
    for (const question of ['今年CBD建筑高度与净有效租金列表', '2026Q3CBD建筑高度与租金列表', '2026Q3CBD建筑高度与建筑高度列表', '2026Q3CBD建筑高度与净有效租金列表只要已出租的']) expect(resolveBusinessQuestion(question).kind).toBe('clarification');
  });

});
