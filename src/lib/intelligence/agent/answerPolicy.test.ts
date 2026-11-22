import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildLeaseResult } from '../lease/research';
import { leaseModelObservation } from '../lease/tool';
import type { LeaseSnapshot } from '../lease/protocol';
import type { AnswerSelection } from '../query/answerSelection';
import { applyAnswerPolicy } from './answerPolicy';

function lease(details: boolean, count = 3) {
  const snapshot: LeaseSnapshot = { allowed: true, version: 'lease-research/1',
    permission_revision: 'a'.repeat(64), sources: ['live'], details, financials: false, export: true,
    minGroupSize: 3, links: [], rows: Array.from({ length: count }, () => ({ id: 'live:' + randomUUID(),
      source: 'live', fingerprint: 'b'.repeat(64), buildingId: randomUUID(), building: '合成楼宇', alias: null,
      match: 'exact', submarket: 'CBD', industry: null, start: '2026-09-30', end: '2026-09-30',
      precision: 'date', area: '100', quality: 'SYNTHETIC', financials: {} })) };
  return buildLeaseResult(snapshot, { source: 'live', from: '2026-01-01', to: '2026-12-31',
    mode: details ? 'details' : 'aggregate', groupBy: 'total', sort: 'period', topN: 1 });
}
function select(result: ReturnType<typeof lease>): AnswerSelection {
  return { version: 'answer-selection/1', task: 'record', status: 'answered',
    primaryResultId: result.resultId, results: [{ role: 'primary', result: result as never }] };
}
describe('server answer completion policy', () => {
  it('does not treat a successful aggregate tool or supplier answered claim as a single-record answer', () => {
    const aggregate = lease(false);
    const decision = applyAnswerPolicy('2026年最新一笔租赁成交', select(aggregate), 'completed');
    expect(decision).toMatchObject({ task: 'record', status: 'partial' });
    expect(decision.results[0].role).toBe('alternative');
    expect(decision.notice).toContain('无法确认最新一笔');
    expect(decision.notice).not.toMatch(/没有成交|没有权限|样本太少/);
    expect(decision.results[0].result.table).toEqual(aggregate.table);
  });
  it('retains the full user-authorized detail projection while the provider receives no details', () => {
    const details = lease(true, 1);
    const provider = leaseModelObservation(details);
    expect(provider).not.toHaveProperty('aggregates');
    expect(JSON.stringify(provider)).not.toContain('合成楼宇');
    const decision = applyAnswerPolicy('2026年最新一笔租赁成交', select(details), 'completed');
    expect(decision.results[0].role).toBe('primary');
    expect(decision.status).toBe('answered');
    expect(decision.results[0].result.table.rows[0].cells.building).toMatchObject({ kind: 'text', value: '合成楼宇' });
    expect(decision.notice).toContain('查询区间');
    expect(decision.notice).not.toMatch(/无权限|没有权限|样本不足/);
  });
  it('retains date ties and explicitly limits latest claims to the query window', () => {
    const details = lease(true, 2);
    expect(details.table.rows).toHaveLength(2);
    const decision = applyAnswerPolicy('2026年最新成交是哪一笔？', select(details), 'completed');
    expect(decision.status).toBe('partial');
    expect(decision.results[0].result.table.rows).toHaveLength(2);
    expect(decision.notice).toContain('并列');
  });
  it('asks one necessary range question rather than silently treating one queried year as all history', () => {
    const details = lease(true, 1);
    const decision = applyAnswerPolicy('最新一笔租赁成交', select(details), 'completed');
    expect(decision.status).toBe('needs_conditions');
    expect(decision.notice).toContain('请明确要查询的日期范围');
  });
  it('does not confirm one latest record from low-precision or excluded-date coverage', () => {
    const detail = lease(true, 1);
    const lowPrecision = { ...detail, table: { ...detail.table, rows: detail.table.rows.map(row => ({ ...row,
      cells: { ...row.cells, precision: { ...row.cells.precision, kind: 'text' as const, value: 'quarter' } } })) } };
    const excluded = { ...detail, parameters: { ...detail.parameters,
      leaseCoverage: { ...(detail.parameters.leaseCoverage as object), uncertainDates: 1 } } };
    for (const result of [lowPrecision, excluded]) {
      const decision = applyAnswerPolicy('2026年最新一笔租赁成交', select(result), 'completed');
      expect(decision.status).toBe('partial');
    }
  });
});
