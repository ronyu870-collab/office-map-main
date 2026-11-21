import { createHash } from 'node:crypto';
import { z } from 'zod';
import { chartRequestSchema, buildResultChart, renderChartSvg } from './charts';
import { buildCsvPackage, buildXlsx } from './exports';
import { resultViewSchema } from './presentation';
import { resultDigest, type QueryResult } from './result';
import { buildArtifactFilename } from './artifactFilename';
import { renderResultCopy, resultCopyFormatSchema } from './resultOutput';

const common = { requestId: z.uuid(), resultId: z.uuid() };
export const artifactInputSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...common, action: z.literal('chart'), chart: chartRequestSchema }),
  z.strictObject({ ...common, action: z.literal('export'), format: z.enum(['csv_zip', 'xlsx', 'svg_zip', 'png_zip', 'pdf']), chart: chartRequestSchema.optional() }),
  z.strictObject({ ...common, action: z.literal('copy'), format: resultCopyFormatSchema }),
]);
export type ArtifactInput = z.infer<typeof artifactInputSchema>;

/** Only the recovered, currently authorized archive is accepted here. The HTTP
 * layer persists this action first and rechecks grants/sources before delivery. */
export async function buildResultArtifact(rawResult: unknown, input: ArtifactInput) {
  input = artifactInputSchema.parse(input);
  const view = resultViewSchema.parse(rawResult);
  if (view.resultId !== input.resultId) throw new Error('ARTIFACT_RESULT_MISMATCH');
  // Keep the archived object intact for its digest and export metadata.
  const result = rawResult as QueryResult;
  if (input.action === 'chart') {
    const chart = buildResultChart(view, input.chart);
    return { type: 'chart' as const, chart, resultDigest: resultDigest(result) };
  }
  if (input.action === 'copy') return { type: 'copy' as const, text: renderResultCopy(view, input.format), format: input.format,
    resultId: result.resultId, resultDigest: resultDigest(result) };
  if ((input.format === 'svg_zip' || input.format === 'png_zip') !== Boolean(input.chart)) throw new Error('ARTIFACT_CHART_FORMAT_MISMATCH');
  let bytes: Uint8Array, contentType: string;
  if (input.format === 'pdf') {
    const { renderResearchPdf } = await import('./reportPdf');
    bytes = (await renderResearchPdf(result)).bytes; contentType = 'application/pdf';
  } else if (input.format === 'xlsx') {
    bytes = await buildXlsx(result); contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip(), date = new Date('2000-01-01T00:00:00Z');
    const pack = buildCsvPackage(result);
    const manifest = { ...JSON.parse(pack.manifest), use: 'internal_analysis_only', rendererVersion: 'result-chart/1',
      ...(input.chart ? { chart: buildResultChart(view, input.chart) } : {}) };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2), { date });
    if (input.format === 'csv_zip') zip.file('data.csv', pack.csv, { date });
    else if (input.format === 'png_zip') {
      const { renderChartPng } = await import('./chartPng');
      const png = await renderChartPng(manifest.chart);
      zip.file('chart.png', png.bytes, { date });
      Object.assign(manifest, { image: { width: png.width, height: png.height, format: 'png', scale: 2,
        font: 'Noto Sans SC', sha256: createHash('sha256').update(png.bytes).digest('hex') } });
      zip.file('manifest.json', JSON.stringify(manifest, null, 2), { date });
    } else zip.file('chart.svg', renderChartSvg(manifest.chart), { date });
    bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }); contentType = 'application/zip';
  }
  if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('ARTIFACT_SIZE_LIMIT');
  return { type: 'download' as const, bytes, contentType, filename: buildArtifactFilename(view, input.format),
    sha256: createHash('sha256').update(bytes).digest('hex'), resultDigest: resultDigest(result) };
}
