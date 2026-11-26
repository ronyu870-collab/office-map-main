import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildDistributionResult, buildListResult, buildTrendResult } from '../query/result';
import { fixture } from '../query/__tests__/fixtures';
import { buildResultChart } from '../query/charts';
import { resultViewSchema } from '../query/presentation';
import { preferredChartRequest, runResultPresentationTool } from './resultTools';
import { readBuildingContext } from '../query/buildingContext';
import type { SupabaseClient } from '@supabase/supabase-js';

const requestId = randomUUID();
const quarter = (value: number) => ({ year: 2026, quarter: value });
const trend = () => buildTrendResult([fixture(quarter(1)), fixture(quarter(2))], 'rent', 'per_period');

describe('read-only Agent presentation tools bound to formal result snapshots', () => {
  function filteredBuildings(value = '200') {
    const raw = buildListResult(fixture(), ['height']);
    const ids = new Map(raw.table.rows.map(row => [row.entityId, randomUUID()]));
    return { ...raw, table: { ...raw.table, rows: raw.table.rows.map(row => ({ ...row, entityId: ids.get(row.entityId)! })) },
      sources: raw.sources.map(source => ({ ...source, entityId: ids.get(source.entityId) ?? source.entityId,
        recordId: source.table === 'buildings' ? ids.get(source.recordId) ?? source.recordId : source.recordId })),
      parameters: { ...raw.parameters, agentTableView: { version: 'result-table-view/1', sort: null,
        filters: [{ key: 'height', operator: 'gte', value }], page: 1 } } };
  }
  it('uses every matching row for charts and source-bound maps while retaining the full original snapshot', () => {
    const result = filteredBuildings(), before = JSON.stringify(result);
    const chart = runResultPresentationTool('create_chart', requestId, result, { chart: { kind: 'bar', field: 'height' } });
    expect(JSON.parse(chart.content).points.map((point: { label: string }) => point.label)).toEqual(['A座']);
    expect(buildResultChart(resultViewSchema.parse(chart.result), { kind: 'bar', field: 'height' }).points.map(point => point.label)).toEqual(['A座']);
    const map = runResultPresentationTool('prepare_map_selection', requestId, result);
    expect(map.result?.parameters.agentMap).toMatchObject({ buildingIds: [result.table.rows[0].entityId] });
    expect(chart.result?.table.rows).toHaveLength(4);
    expect(buildResultChart(resultViewSchema.parse(chart.result), { kind: 'bar', field: 'height' }).summary.join('')).toContain('1 条记录');
    expect(() => runResultPresentationTool('prepare_map_selection', requestId, result,
      { buildingIds: [result.table.rows[1].entityId] })).toThrow('QUERY_DENIED');
    expect(JSON.stringify(result)).toBe(before);
  });
  it('intersects an earlier map selection with the current view and never restores excluded rows for an empty view', async () => {
    const result = filteredBuildings();
    const archived = { ...result, parameters: { ...result.parameters, agentMap: { version: 'map-selection/1',
      buildingIds: result.table.rows.map(row => row.entityId), intent: 'select' } } };
    const builder = { select: () => builder, in: () => builder, eq: () => builder, is: () => builder,
      or: () => builder, abortSignal: async () => ({ data: [], error: null }) };
    const client = { from: () => builder } as unknown as SupabaseClient;
    const input = { requestId, action: 'buildings' as const, mapSelection: true, offset: 0, limit: 500 };
    const context = await readBuildingContext(client, archived, input, new AbortController().signal);
    expect(context.buildings.map(row => row.name)).toEqual(['A座']);
    const empty = filteredBuildings('300');
    const limited = runResultPresentationTool('prepare_map_selection', requestId, empty);
    expect(JSON.parse(limited.content)).toMatchObject({ status: 'unavailable', mapHref: null });
    expect((await readBuildingContext(client, empty, input, new AbortController().signal)).buildings).toEqual([]);
    await expect(readBuildingContext(client, { ...archived, parameters: { ...archived.parameters,
      agentMap: { ...archived.parameters.agentMap, buildingIds: [randomUUID()] } } }, input, new AbortController().signal)).rejects.toThrow('QUERY_DENIED');
  });
  it('refuses every artifact request before a verified database result exists', () => {
    for (const name of ['get_source_evidence', 'prepare_chart', 'prepare_map_selection', 'prepare_research_output'] as const) {
      const out = runResultPresentationTool(name, requestId, undefined);
      expect(JSON.parse(out.content)).toMatchObject({ status: 'requires_verified_result' });
      expect(out.result).toBeUndefined();
    }
  });
  it('does not reuse full distribution statistics after filtering observation rows', () => {
    const raw = buildDistributionResult(fixture(), 'height');
    const filtered = { ...raw, parameters: { ...raw.parameters, agentTableView: { version: 'result-table-view/1',
      filters: [{ key: 'value', operator: 'gte', value: '200' }], page: 0 } } };
    const out = runResultPresentationTool('create_chart', requestId, filtered, { chart: { kind: 'histogram' } });
    expect(JSON.parse(out.content)).toMatchObject({ status: 'unsupported', code: 'CHART_VIEW_UNSUPPORTED' });
    expect(out.result).toBeUndefined();
  });
  it('reveals only already-known provenance handles, never the raw source payload', () => {
    const result = trend();
    const out = runResultPresentationTool('get_source_evidence', requestId, result);
    const response = JSON.parse(out.content);
    expect(response.status).toBe('ready');
    expect(response.totalSources).toBe(result.sources.length);
    expect(response.sources).toHaveLength(Math.min(16, result.sources.length));
    expect(out.content).not.toContain('rawValue');
    expect(out.content).not.toContain('service_role');
    expect(response.sources.every((item: { sourceId: string; verification: string }) =>
      item.sourceId && item.verification)).toBe(true);
  });
  it('uses the existing deterministic chart builder and actual source-bound values', () => {
    const result = trend(), view = resultViewSchema.parse(result);
    const request = preferredChartRequest(view);
    expect(request).toEqual({ kind: 'time_series' });
    const official = buildResultChart(view, request!);
    const out = runResultPresentationTool('prepare_chart', requestId, result);
    const resultData = JSON.parse(out.content);
    expect(resultData.status).toBe('ready');
    expect(resultData.chartKind).toBe(official.kind);
    expect(resultData.yUnit).toBe(official.yUnit);
    expect(resultData.points.map((item: { y: number | null }) => item.y))
      .toEqual(official.points.map(point => point.y).slice(0, 14));
    expect(out.result?.resultId).toBe(result.resultId);
  });
  it('does not invent chart data for single-value aggregates or unbound map IDs', () => {
    const result = buildListResult(fixture(), ['height', 'totalArea']);
    const missingMap = runResultPresentationTool('prepare_map_selection', requestId, result);
    const map = JSON.parse(missingMap.content);
    expect(missingMap.result).toBeUndefined();
    expect(map.mapHref).toBeNull();
    expect(map.status).toBe('unavailable');
    const unsupportedChart = runResultPresentationTool('prepare_chart', requestId,
      { ...result, operation: 'aggregate', table: { ...result.table, columns: [], rows: [] } });
    const unavailable = JSON.parse(unsupportedChart.content);
    expect(unavailable.status).toBe('unsupported');
    expect(unsupportedChart.result).toBeUndefined();
  });
  it('binds map selections to server-known UUID buildings and only an opaque result reference', () => {
    const raw = buildListResult(fixture(), ['height']);
    const changed = new Map(raw.table.rows.map(row => [row.entityId, randomUUID()]));
    const result = { ...raw, table: { ...raw.table, rows: raw.table.rows.map(row => ({
      ...row, entityId: changed.get(row.entityId)!,
    })) }, sources: raw.sources.map(source => ({ ...source,
      entityId: changed.get(source.entityId) ?? source.entityId, recordId: source.table === 'buildings' ? changed.get(source.entityId) ?? source.recordId : source.recordId })) };
    const map = JSON.parse(runResultPresentationTool('prepare_map_selection', requestId, result).content);
    expect(map.status).toBe('ready');
    expect(map.buildingCount).toBe(4);
    expect(map.mapHref).toBe(`/map?aiRequest=${requestId}&aiResult=${result.resultId}`);
    expect(map.mapHref).not.toContain([...changed.values()][0]);
  });
  it('prepares a reusable researcher-facing summary solely from stored facts', () => {
    const result = trend();
    const response = JSON.parse(runResultPresentationTool('prepare_research_output', requestId, result).content);
    expect(response.status).toBe('ready');
    expect(response.resultId).toBe(result.resultId);
    expect(response.descriptor.period).toContain('2026Q');
    expect(response.excerpt).toContain('数据范围');
    expect(response.excerpt).toContain('来源');
  });
});
