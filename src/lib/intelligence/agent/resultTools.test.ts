import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildListResult, buildTrendResult } from '../query/result';
import { fixture } from '../query/__tests__/fixtures';
import { buildResultChart } from '../query/charts';
import { resultViewSchema } from '../query/presentation';
import { preferredChartRequest, runResultPresentationTool } from './resultTools';

const requestId = randomUUID();
const quarter = (value: number) => ({ year: 2026, quarter: value });
const trend = () => buildTrendResult([fixture(quarter(1)), fixture(quarter(2))], 'rent', 'per_period');

describe('read-only Agent presentation tools bound to formal result snapshots', () => {
  it('refuses every artifact request before a verified database result exists', () => {
    for (const name of ['get_source_evidence', 'prepare_chart', 'prepare_map_selection', 'prepare_research_output'] as const) {
      const out = runResultPresentationTool(name, requestId, undefined);
      expect(JSON.parse(out.content)).toMatchObject({ status: 'requires_verified_result' });
      expect(out.result).toBeUndefined();
    }
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
    expect(map.mapHref).toBe('/map?aiRequest=' + requestId);
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
