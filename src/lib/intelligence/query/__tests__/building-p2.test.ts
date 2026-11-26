import { describe, expect, it } from 'vitest';
import { resolveBuildingCandidates } from '../buildingIntent';
import { resultBuildingRows } from '../buildingCards';
import { buildingAnalysisHref, readMapQueryContext, parseQueryMapContext, queryMapHref } from '../buildingNavigation';
import { buildListResult } from '../result';
import { resultViewSchema } from '../presentation';
import { composeResponse } from '../responsePresentation';
import { routeTask } from '../../agent/taskRouting';
import { fixture, nameSource } from './fixtures';
import { mapPresentationQuestion } from '../mapPresentationQuestion';
import { resolveSemanticQuestion } from '../semanticPlanner';

const a = '10000000-0000-4000-8000-000000000001', b = '10000000-0000-4000-8000-000000000002';
const rows = [{ id: a, name: '合成中心一座', submarket: 'CBD', aliases: ['已核验旧称'] }, { id: b, name: '合成中心二座', submarket: 'CBD', aliases: ['同名别称'] }];
describe('P2 building identity and result contract', () => {
  it('T01 resolves exact canonical and governed former names without fuzzy auto-selection', () => {
    expect(resolveBuildingCandidates('合成中心一座', rows).unique?.id).toBe(a);
    expect(resolveBuildingCandidates('已核验旧称', rows).unique?.id).toBe(a);
    expect(resolveBuildingCandidates('合成中心', rows).unique).toBeNull();
    expect(resolveBuildingCandidates('合成中心一', rows).unique).toBeNull();
  });
  it('T02 project associations stay candidates even if only one visible tower remains', () => {
    expect(resolveBuildingCandidates('项目别称', rows, [], [{ building_id: a }])).toMatchObject({ unique: null, reason: 'project', candidates: [rows[0]] });
    const duplicate = [{ ...rows[0], aliases: ['同名别称'] }, rows[1]];
    expect(resolveBuildingCandidates('同名别称', duplicate).candidates).toHaveLength(2);
    expect(resolveBuildingCandidates('无权别称', rows, [{ building_id: 'outside' }]).unique).toBeNull();
  });
  it.each(['合成中心在哪个子市场？', '测试大厦属于哪个子市场'])('routes location facts through authorized building resolution: %s', question => {
    expect(routeTask(question)).toMatchObject({ route: 'deterministic_query', taskType: 'query', catalogLocation: true });
  });

  it('uses a concise source-linked fact for exact candidate rows sharing one submarket', () => {
    const original = fixture();
    const candidates = original.rows.slice(0, 2).map(row => ({
      ...row, dimensions: { ...row.dimensions,
        submarket: { value: 'CBD', source: { ...nameSource(row.id, 'CBD'), id: `market/${row.id}`, field: 'submarket' } },
      },
    }));
    const result = buildListResult({ ...original, rows: candidates, expectedCount: candidates.length }, []);
    const view = resultViewSchema.parse({ ...result, parameters: { ...result.parameters,
      interpretation: { buildingLocation: { subject: '合成中心', submarket: 'CBD' } },
    } });
    expect(composeResponse(undefined, view).blocks).toEqual([
      { type: 'location', resultId: view.resultId },
    ]);
    const changed = structuredClone(view);
    changed.table.rows[1].cells.submarket = { kind: 'text', value: '金融街', sourceIds: [] };
    expect(composeResponse(undefined, changed).blocks.some(block => block.type === 'location')).toBe(false);
  });

  it('T01/T17 binds UUID actions to same-row name source, not a fabricated entity label', () => {
    const result = resultViewSchema.parse(buildListResult(fixture(), ['height']));
    const first = result.table.rows[0], original = result.sources.find(source => source.id === first.cells.name.sourceIds[0])!;
    first.entityId = a; original.entityId = a; original.recordId = a;
    expect(resultBuildingRows(result).map(row => row.id)).toEqual([a]);
    first.entityId = b;
    expect(resultBuildingRows(result)).toEqual([]);
    first.entityId = a; original.rawValue = '另一栋';
    expect(resultBuildingRows(result)).toEqual([]);
  });
  it('T03/T14 derived vacancy reuses existing per-record formula and keeps invalid/missing values unknown', () => {
    const result = buildListResult(fixture(), ['totalArea', 'vacantArea'], true);
    expect(result.table.rows.map(row => row.cells.vacancy.kind === 'number' ? row.cells.vacancy.value.numeric : row.cells.vacancy.kind)).toEqual([0.1, 0.2, 'unknown', 'unknown']);
    const cell = result.table.rows[0].cells.vacancy;
    expect(cell.sourceIds).toHaveLength(2);
    expect(cell.sourceIds.every(id => result.sources.find(source => source.id === id)?.period?.quarter === 3)).toBe(true);
    expect(buildListResult(fixture(), ['totalArea'], true).table.columns.some(column => column.key === 'vacancy')).toBe(false);
  });
  it('T07 navigation only carries explicit bounded identities and intent, never data or names', () => {
    const link = buildingAnalysisHref([a, b], 'compare'), params = new URL(link, 'https://example.invalid').searchParams;
    expect(readMapQueryContext(params)).toEqual({ selection: { ids: [a, b], intent: 'compare' }, question: '比较选中楼宇最新有数据季度的净有效租金和空置面积' });
    expect(readMapQueryContext(new URLSearchParams('aiBuilding=同名楼宇'))).toBeNull();
    expect(() => buildingAnalysisHref(Array.from({ length: 21 }, (_, i) => `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`))).toThrow();
  });
  it('T04 map links recover the source query and preserve an exact optional detail identity', () => {
    const params = new URL(queryMapHref(a, b, true), 'https://example.invalid').searchParams;
    expect(parseQueryMapContext(params)).toEqual({ requestId: a, buildingId: b, details: true });
    expect(parseQueryMapContext(new URLSearchParams('aiRequest=other&aiBuilding=wrong'))).toBeNull();
    const selected = new URL(queryMapHref(a, b, true, b), 'https://example.invalid').searchParams;
    expect(parseQueryMapContext(selected)).toEqual({ requestId: a, resultId: b, buildingId: b, details: true });
    expect(parseQueryMapContext(new URLSearchParams(`aiRequest=${a}&aiResult=invalid`))).toBeNull();
    expect(() => queryMapHref(a, undefined, false, 'invalid')).toThrow();
  });
  it('T04 presentation wording uses the existing P1 planner and preserves metric/period ambiguity and every unsupported condition', () => {
    const normalize = (question: string) => mapPresentationQuestion(question).question;
    expect(normalize('把2026Q3 CBD净有效租金最高的十栋写字楼标在地图上。')).toBe('2026Q3 CBD净有效租金最高的前十栋写字楼');
    const result = resolveSemanticQuestion({ question: normalize('把2026Q3 CBD净有效租金最高的十栋写字楼标在地图上。'), now: new Date('2026-11-16'), availablePeriods: [{ year: 2026, quarter: 3 }] });
    expect(result.kind === 'plan' && result.plan).toMatchObject({ operation: 'rank', field: 'netEffectiveRent', limit: 10, period: { year: 2026, quarter: 3 } });
    const ambiguity = resolveSemanticQuestion({ question: normalize('把CBD租金最高的十栋写字楼标在地图上'), now: new Date('2026-11-16'), availablePeriods: [] });
    expect(ambiguity.kind === 'clarification' && ambiguity.clarification.reason).toBe('metric_required');
    const unsupported = resolveSemanticQuestion({ question: normalize('把2026Q3 CBD地铁附近净有效租金最高的十栋写字楼标在地图上'), now: new Date('2026-11-16'), availablePeriods: [{ year: 2026, quarter: 3 }] });
    expect(unsupported.kind === 'clarification' && unsupported.clarification.reason).toBe('unsupported');
  });
});
