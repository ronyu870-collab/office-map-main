import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from '../query/__tests__/fixtures';
import { buildListResult } from '../query/result';
import { Decimal } from '../query/decimal';
import { AuthorizedResultWorkset, WORKSET_LIMITS, type WorksetOwner } from './resultWorkset';

const owner = (): WorksetOwner => ({ requestId: randomUUID(), actorId: randomUUID(),
  effectiveUserId: randomUUID(), sessionId: randomUUID(),
  permissionRevision: 'a'.repeat(64), policyVersion: 'test' });

function manyBuildings(count = 25) {
  const result = buildListResult(fixture(), ['height']);
  const rows = Array.from({ length: count }, (_, index) => {
    const source = result.table.rows[index % result.table.rows.length];
    return { ...source, entityId: 'building-' + index,
      cells: { ...source.cells, name: { kind: 'text' as const, value: '测试楼宇 ' + index,
        sourceIds: source.cells.name.sourceIds } } };
  });
  return { ...result, table: { ...result.table, rows } };
}

describe('AI 5.0 ephemeral authorized result workset', () => {
  it('inherits archived filters and ordering for model pages without inheriting the UI page or changing the full manifest', () => {
    const identity = owner(), workset = new AuthorizedResultWorkset(identity);
    const raw = buildListResult(fixture(), ['height']);
    const result = { ...raw, parameters: { ...raw.parameters, agentTableView: { version: 'result-table-view/1',
      filters: [{ key: 'height', operator: 'gte', value: '190' }], sort: { key: 'height', direction: 'asc' }, page: 1 } } };
    workset.register(result, identity);
    const page = workset.page({ resultId: result.resultId, offset: 0, limit: 1 }, identity);
    expect(page.rowCount).toBe(4); expect(page.totalMatched).toBe(2);
    expect(page.rows.map(row => row.entityId)).toEqual(['B']);
    const next = workset.page({ resultId: result.resultId, offset: page.nextOffset!, limit: 1 }, identity);
    expect(next.rows.map(row => row.entityId)).toEqual(['A']);
    expect(workset.read(result.resultId, identity)).toBe(result);
  });
  it('filters model pages using exact decimals, consistently with table and export boundaries', () => {
    const identity = owner(), workset = new AuthorizedResultWorkset(identity);
    const result = buildListResult(fixture(), ['height']);
    const rows = result.table.rows.map((row, index) => {
      const value = ['199.99999999999999999', '200', '200.00000000000000001'][index];
      const exact = value && Decimal.parse(value);
      return exact ? { ...row, cells: { ...row.cells, height: { kind: 'number' as const,
        value: { numeric: exact.toNumber(), exact: exact.exact() }, sourceIds: row.cells.height.sourceIds } } } : row;
    });
    workset.register({ ...result, table: { ...result.table, rows } }, identity);
    const page = (operator: 'eq' | 'gte' | 'lte') => workset.page({ resultId: result.resultId, offset: 0, limit: 100,
      filter: { field: 'height', operator, value: '200.0' } }, identity).rows.map(row => row.entityId);
    expect(page('gte')).toEqual(['B', 'C']);
    expect(page('lte')).toEqual(['A', 'B']);
    expect(page('eq')).toEqual(['B']);
  });
  it('applies a validated current view to subsequent tools without modifying the sealed source or its manifest', () => {
    const identity = owner(), workset = new AuthorizedResultWorkset(identity);
    const result = buildListResult(fixture(), ['height']), before = JSON.stringify(result);
    workset.register(result, identity);
    const view = { version: 'result-table-view/1', filters: [{ key: 'height', operator: 'gte', value: '200' }], page: 1 };
    const current = workset.applyView(result.resultId, view, identity);
    expect(current.parameters.agentTableView).toMatchObject(view);
    expect(workset.page({ resultId: result.resultId, offset: 0, limit: 100 }, identity).rows.map(row => row.entityId)).toEqual(['A']);
    expect(workset.manifest(identity)[0].rowCount).toBe(4);
    expect(JSON.stringify(result)).toBe(before);
    (current.parameters.agentTableView as { filters: { value: string }[] }).filters[0].value = '0';
    expect(workset.page({ resultId: result.resultId, offset: 0, limit: 100 }, identity).totalMatched).toBe(1);
    expect(() => workset.applyView(result.resultId, view, { ...identity, actorId: randomUUID() })).toThrow('QUERY_DENIED');
    expect(() => workset.applyView(result.resultId, { ...view, filters: [{ key: 'foreign', value: '0' }] }, identity)).toThrow('AGENT_FIELD_NOT_AVAILABLE');
  });
  it('selects exact full snapshots and rejects invented, foreign-owner and changed references', () => {
    const identity = owner(), workset = new AuthorizedResultWorkset(identity);
    const a = manyBuildings(32), b = manyBuildings(2);
    workset.register(a, identity); workset.register(b, identity);
    const request = { primaryResultId: a.resultId, task: 'comparison', status: 'answered',
      auxiliary: [{ resultId: b.resultId, role: 'comparison' }] };
    const selection = workset.select(request, identity);
    expect(selection.results[0].result.table.rows).toHaveLength(32);
    expect(selection.results[1].result).toBe(b);
    expect(selection.results[0].result.snapshotId).toBe(a.snapshotId);
    expect(selection.results[0].result.scopeFingerprint).toBe(a.scopeFingerprint);
    expect(() => workset.select({ ...request, primaryResultId: randomUUID() }, identity)).toThrow('AGENT_RESULT_NOT_FOUND');
    expect(() => workset.select(request, { ...identity, sessionId: randomUUID() })).toThrow('QUERY_DENIED');
    expect(() => workset.select({ ...request, sources: [] }, identity)).toThrow();
    a.table.rows[0].cells.name = { kind: 'text', value: '改变后的原始结果', sourceIds: [] };
    expect(() => workset.select(request, identity)).toThrow('AGENT_RESULT_CHANGED');
  });
  it('fits Chinese pages to the UTF-8 budget with bounded serialization and lossless continuation', () => {
    const identity = owner(), workset = new AuthorizedResultWorkset(identity);
    const result = manyBuildings(50000);
    result.table.rows.forEach(row => { row.cells.name = { kind: 'text', value: '中文资料'.repeat(100), sourceIds: [] }; });
    workset.register(result, identity);
    const stringify = vi.spyOn(JSON, 'stringify');
    let page;
    try {
      page = workset.page({ resultId: result.resultId, offset: 1234, limit: 100 }, identity);
      expect(stringify.mock.calls.length).toBeLessThanOrEqual(9);
    } finally { stringify.mockRestore(); }
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(WORKSET_LIMITS.modelBytes);
    expect(page!.totalMatched).toBe(50000);
    expect(page!.rows[0].entityId).toBe('building-1234');
    const next = workset.page({ resultId: result.resultId, offset: page!.nextOffset!, limit: 100 }, identity);
    expect(next.rows[0].entityId).toBe('building-' + (1234 + page!.returnedRows));
    expect(workset.read(result.resultId, identity).table.rows).toHaveLength(50000);
  });
  it('preserves entire authorized table behind the model preview, including later pages and counts', () => {
    const identity = owner(), workset = new AuthorizedResultWorkset(identity);
    const data = manyBuildings(25);
    const ref = workset.register(data, identity);
    expect(ref).toMatchObject({ requestId: identity.requestId, resultId: data.resultId, rowCount: 25 });
    const summary = workset.summary(data.resultId, identity);
    expect(summary.rowCount).toBe(25);
    expect(summary.columns.find(column => column.field === 'name')?.text).toBe(25);
    const page = workset.page({ resultId: data.resultId, offset: 8, limit: 5 }, identity);
    expect(page.rowCount).toBe(25);
    expect(page.totalMatched).toBe(25);
    expect(page.returnedRows).toBe(5);
    expect(page.rows[0].values.name.value).toBe('测试楼宇 8');
    expect(page.hasMore).toBe(true);
    expect(page.nextOffset).toBe(13);
    const tail = workset.page({ resultId: data.resultId, offset: 23, limit: 20 }, identity);
    expect(tail.rows).toHaveLength(2);
    expect(tail.hasMore).toBe(false);
  });

  it('filters full results deterministically and rejects unapproved columns rather than guessing', () => {
    const identity = owner(), workset = new AuthorizedResultWorkset(identity);
    const ref = workset.register(manyBuildings(), identity);
    const filtered = workset.page({ resultId: ref.resultId, offset: 0, limit: 100,
      filter: { field: 'name', operator: 'contains', value: '楼宇 12' } }, identity);
    expect(filtered.totalMatched).toBe(1);
    expect(filtered.rows[0].values.name.value).toBe('测试楼宇 12');
    expect(() => workset.page({ resultId: ref.resultId, offset: 0, limit: 2,
      sort: { field: 'private_contract', direction: 'desc' } }, identity)).toThrow('AGENT_FIELD_NOT_AVAILABLE');
    const sorted = workset.page({ resultId: ref.resultId, offset: 0, limit: 4,
      sort: { field: 'name', direction: 'asc' } }, identity);
    expect(sorted.rows).toHaveLength(4);
    expect(sorted.totalMatched).toBe(25);
  });

  it('retains multiple result IDs, separate sources and full coverage for each', () => {
    const identity = owner(), workset = new AuthorizedResultWorkset(identity);
    const a = manyBuildings(25), b = manyBuildings(14);
    workset.register(a, identity);
    workset.register(b, identity);
    expect(workset.manifest(identity).map(row => row.resultId)).toEqual([a.resultId, b.resultId]);
    const compare = workset.compare([a.resultId, b.resultId], identity);
    expect(compare.comparedCount).toBe(2);
    expect(compare.results.map(row => row.totalRows)).toEqual([25, 14]);
    expect(compare.results.map(row => row.resultId)).toEqual([a.resultId, b.resultId]);
    const coverage = workset.coverage(b.resultId, identity);
    expect(coverage.rowCount).toBe(14);
    expect(coverage.columns.find(column => column.field === 'height')?.valid).toBeGreaterThan(0);
    expect(() => workset.compare([a.resultId, a.resultId], identity)).toThrow('AGENT_DUPLICATE_RESULT_ID');
  });

  it('denies revoked and cross-user references, including a valid UUID from another task', () => {
    const identity = owner(), workset = new AuthorizedResultWorkset(identity);
    const ref = workset.register(manyBuildings(), identity);
    for (const changed of [
      { ...identity, actorId: randomUUID() },
      { ...identity, effectiveUserId: randomUUID() },
      { ...identity, requestId: randomUUID() },
      { ...identity, sessionId: randomUUID() },
      { ...identity, permissionRevision: 'b'.repeat(64) },
      { ...identity, policyVersion: 'changed' },
    ]) {
      expect(() => workset.read(ref.resultId, changed)).toThrow('QUERY_DENIED');
      expect(() => workset.page({ resultId: ref.resultId, offset: 0, limit: 1 }, changed)).toThrow('QUERY_DENIED');
      expect(() => workset.manifest(changed)).toThrow('QUERY_DENIED');
    }
    expect(() => workset.read(randomUUID(), identity)).toThrow('AGENT_RESULT_NOT_FOUND');
  });

  it('bounds total results and never evicts earlier authorized entries silently', () => {
    const identity = owner(), workset = new AuthorizedResultWorkset(identity);
    for (let i = 0; i < WORKSET_LIMITS.results; i++) workset.register(manyBuildings(4), identity);
    expect(workset.manifest(identity)).toHaveLength(WORKSET_LIMITS.results);
    expect(() => workset.register(manyBuildings(4), identity)).toThrow('AGENT_WORKSET_LIMIT');
    expect(workset.manifest(identity)).toHaveLength(WORKSET_LIMITS.results);
  });
});
