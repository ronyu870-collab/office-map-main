import { describe, expect, it } from 'vitest';
import type { Quarter } from '../contracts';
import { resolveSemanticQuestion, inferSemanticPeriodFields } from '../semanticPlanner';
import { authorizePlan, type QueryAuthority } from '../admission';
import { describePlanRead } from '../snapshotReader';
import { queryCapabilityManifest } from '../capabilityManifest';
import type { DataAuthority } from '../serverAuthority';
import { rankBuildings } from '../analytics';
import { buildAggregateResult, buildListResult } from '../result';
import { fixture, nameSource, source } from './fixtures';
import { resolveNumericFact } from '../facts';

const periods: Quarter[] = [{ year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }];
const ask = (question: string) => resolveSemanticQuestion({ question, now: new Date('2026-11-20T04:00:00Z'), availablePeriods: periods });
const base: QueryAuthority = {
  actorId: 'actor', effectiveUserId: 'actor', sessionActive: true, policyVersion: 'test',
  permissionRevision: 'test', grants: ['query:catalog', 'query:quarter', 'query:brochure'],
  fields: ['height', 'netEffectiveRent'],
};
describe('AI5 deterministic building queries', () => {
  it('CBD full catalog requires no quarter or numeric field', () => {
    const r = ask('把CBD所有楼列出来');
    expect(r.kind).toBe('plan');
    if (r.kind !== 'plan') return;
    expect(r.plan).toMatchObject({ operation: 'list', fields: [], period: null, scope: { submarkets: ['CBD'], inventory: 'all_authorized' } });
    expect(describePlanRead(r.plan)).toEqual({fields: [], periods: []});
    expect(() => authorizePlan(r.plan, { ...base, grants: ['query:catalog'], fields: [] })).not.toThrow();
  });
  it('CBD five tallest buildings use measured height, not floors', () => {
    const r = ask('CBD最高的五栋楼');
    expect(r.kind).toBe('plan');
    if (r.kind !== 'plan') return;
    expect(r.plan).toMatchObject({operation: 'rank', field: 'height', direction: 'desc', limit: 5, period: null});
    expect(inferSemanticPeriodFields('CBD最高的五栋楼')).toEqual([]);
    expect(() => authorizePlan(r.plan, base)).not.toThrow();
    expect(() => authorizePlan(r.plan, {...base, fields: ['netEffectiveRent']})).toThrow('QUERY_DENIED');
  });
  it('explicit net effective rent ranking defaults to latest authorized valid period', () => {
    const r = ask('CBD净有效租金最高的十栋楼');
    expect(r.kind).toBe('plan');
    if (r.kind !== 'plan') return;
    expect(r.plan).toMatchObject({operation:'rank', field:'netEffectiveRent', limit:10, direction:'desc', period:{year:2026, quarter:3}});
  });
  it('ambiguous rent basis asks, rather than assuming net effective', () => {
    const r = ask('CBD租金最高的十栋楼');
    expect(r.kind).toBe('clarification');
    if (r.kind !== 'clarification') return;
    expect(r.clarification.reason).toBe('metric_required');
  });
  it('revoked quarterly grant denies rank while catalog list remains available', () => {
    const r = ask('CBD净有效租金最高的十栋楼');
    if (r.kind !== 'plan') throw Error('expected ranking plan');
    expect(() => authorizePlan(r.plan, {...base, grants:['query:catalog','query:brochure']})).toThrow('QUERY_DENIED');
  });
});

const authorized: DataAuthority = {
  ...base, sessionId: 'session', allSubmarkets: false, submarkets: ['CBD'], allBuildings: false,
  buildingIds: ['00000000-0000-4000-8000-000000000001'],
};
describe('AI5 authority manifest and deterministic result integrity', () => {
  it('manifest binds granted fields and scope per identity rather than registered capabilities', () => {
    const a = queryCapabilityManifest(authorized);
    const b = queryCapabilityManifest({...authorized, fields: ['height'], grants:['query:catalog','query:brochure'],
      submarkets:['金融街'], buildingIds:[], allBuildings:true });
    expect(a.fields.map(x=>x.id)).toEqual(['height','netEffectiveRent']);
    expect(b.fields.map(x=>x.id)).toEqual(['height']);
    expect(a.scopes.submarkets).toEqual(['CBD']);
    expect(b.scopes.submarkets).toEqual(['金融街']);
    expect(b.operations).not.toContain('trend');
    expect(a.coverage).toBe('not_verified_for_this_request');
  });
  it('absence of export grant fails closed', () => {
    expect(queryCapabilityManifest(authorized).internalExport).toBe(false);
    expect(queryCapabilityManifest({...authorized, grants:[...authorized.grants,'export:internal']}).internalExport).toBe(true);
  });
  it('catalog list preserves all rows without requiring numerical data', () => {
    const view = buildListResult({...fixture(),period:null},[]);
    expect(view.table.rows).toHaveLength(4);
    expect(view.table.rows.every(row=>row.entityId)).toBe(true);
    expect(view.table.columns.map(x=>x.key)).toEqual(['name']);
  });
  it('catalog dimensions get traced only for list outputs, not aggregate history recovery', () => {
    const original = fixture();
    const first = original.rows[0];
    const subSource = { ...nameSource('A', 'CBD'), id: 'A/submarket', field: 'submarket', rawValue: 'CBD' };
    const snapshot = { ...original, rows: [
      { ...first, dimensions: { submarket: { value: 'CBD', source: subSource } } },
      ...original.rows.slice(1),
    ] };
    const listing = buildListResult(snapshot, []);
    const aggregate = buildAggregateResult(snapshot, 'rent');
    expect(listing.sources.some(ref => ref.field === 'submarket')).toBe(true);
    expect(aggregate.sources.some(ref => ref.field === 'submarket')).toBe(false);
  });
  it('rank excludes unknown/conflicting heights and does not substitute floors', () => {
    const ranked = rankBuildings(fixture(), 'height', 5, 'desc');
    expect(ranked.rows.map(x=>x.entityId)).toEqual(['A','B']);
    expect(ranked.coverage.missing).toBe(1);
    expect(ranked.coverage.conflict).toBe(1);
  });
  it('last-place ties remain included under a stable rank number', () => {
    const ids = ['A','B','C'];
    const snapshot = {...fixture(), expectedCount:3, rows: ids.map((id,index)=>({
      id, name:id, nameSource:nameSource(id,id),
      facts:{height:resolveNumericFact('height',id,[source(id,'height',index===0?210:200,null)],null)}
    }))};
    const ranked=rankBuildings(snapshot,'height',2,'desc');
    expect(ranked.rows.map(x=>x.entityId)).toEqual(ids);
    expect(ranked.rows.map(x=>x.rank)).toEqual([1,2,2]);
  });
});
