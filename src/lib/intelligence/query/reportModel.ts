import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { reportDescriptorSchema, REPORT_LIMITS } from './reportProtocol';
import { resultViewSchema, resultSummary, cellText, units } from './presentation';
import { resultOutputDescriptor } from './resultOutput';
import { researchAnalysisSchema } from './researchAnalysisView';
import { chartRequestSchema } from './chartSpec';
import { resultDigest, type QueryResult } from './result';

/** Shared evidence object for PDF, Word, PPT and Excel. Renderers cannot invent facts. */
export function readReportModel(raw: QueryResult) {
  const root = resultViewSchema.parse(raw), descriptor = reportDescriptorSchema.parse(root.parameters.agentReport);
  const sections = z.array(z.object({ result: resultViewSchema, chart: chartRequestSchema.nullable() })).min(1).max(8)
    .parse((root.parameters.agentReport as { sections: unknown }).sections);
  if (root.parameters.dataDomain === 'deep-research/1' && !isDeepStrictEqual(
    root.parameters.researchSections, (root.parameters.agentReport as { sections: unknown }).sections)) throw new Error('RESEARCH_REPORT_BINDING_MISMATCH');
  if (descriptor.sectionCount !== sections.length || descriptor.rowCount !== sections.reduce((n, s) => n + s.result.table.rows.length, 0)
    || descriptor.rowCount > REPORT_LIMITS.rows) throw new Error('REPORT_ROW_LIMIT');
  const manifest = { version: 'research-output/1', purpose: 'internal', generatedAt: descriptor.generatedAt,
    resultId: root.resultId, digest: resultDigest(raw), dataVersion: root.dataVersion,
    task: root.parameters.researchTask ?? null, review: root.parameters.researchReview ?? null,
    sections: sections.map((s, i) => ({ resultId: s.result.resultId, snapshotId: s.result.snapshotId, dataVersion: s.result.dataVersion,
      createdAt: s.result.createdAt, digest: resultDigest((root.parameters.agentReport as { sections: Array<{ result: QueryResult }> }).sections[i].result),
      parameters: s.result.parameters, table: s.result.table, analysis: s.result.analysis, sources: s.result.sources, limitations: s.result.limitations, chart: s.chart })) };
  return { root, descriptor, sections, manifest };
}

export function reportSectionNarrative(r: z.infer<typeof resultViewSchema>) {
  const output = [...resultSummary(r)];
  const research = researchAnalysisSchema.safeParse(r.parameters.researchAnalysis).data;
  if (!research) return output;
  const known = new Set(r.sources.map(s => s.id));
  if (research.findings.some(f => f.sourceIds.some(id => !known.has(id)))) throw new Error('REPORT_FINDING_SOURCE_INVALID');
  for (const f of research.findings) output.push(`${f.title}：${f.text}`);
  for (const series of research.series) for (const [label, changes] of [['环比', series.quarterOnQuarter], ['同比', series.yearOnYear]] as const)
    for (const change of changes) output.push(`${series.label || resultOutputDescriptor(r).metric} ${change.current.year}Q${change.current.quarter} ${label}：${change.change
      ? cellText({ kind: 'number', value: change.change, sourceIds: [] }, change.changeUnit) + ' ' + (units[change.changeUnit] ?? change.changeUnit)
      : '未知：缺少可比有效数据或基期为零'}。`);
  return output;
}
