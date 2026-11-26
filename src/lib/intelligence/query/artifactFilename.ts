import type { QueryResultView } from './presentation';
import { resultOutputDescriptor } from './resultOutput';

function part(value: string, max = 24): string {
  return Array.from(value.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+|[-.]+$/g, '')).slice(0, max).join('') || '未知';
}

export function buildArtifactFilename(result: QueryResultView, format: 'xlsx' | 'csv_zip' | 'svg_zip' | 'png_zip' | 'pdf' | 'docx' | 'pptx'): string {
  let { object, metric, period } = resultOutputDescriptor(result);
  if (['pdf', 'docx', 'pptx', 'xlsx'].includes(format) && result.parameters.agentReport) {
    const labels = (key: string) => [...new Set(result.table.rows.flatMap(row => row.cells[key]?.kind === 'text' ? [row.cells[key].value] : []))].join('与');
    object = labels('name') || object; metric = labels('metric') || metric; period = labels('period') || period;
  }
  const selection = result.parameters.tableSelection as { kind?: string; exportedRows?: number } | undefined;
  if (selection) metric = `${selection.kind === 'selected' ? '已选' : '筛选'}${selection.exportedRows}条-${metric}`;
  const extension = ['xlsx', 'pdf', 'docx', 'pptx'].includes(format) ? format : 'zip';
  return `ColliersAI_${part(object, 20)}_${part(metric, 20)}_${part(period, 40)}_${format}_${result.resultId.slice(0, 8)}.${extension}`;
}

const safeName = (value: string) => value.length <= 180 && !value.startsWith('.') && /^[\p{L}\p{N}._-]+\.(xlsx|zip|pdf|docx|pptx)$/u.test(value)
  && new TextEncoder().encode(value).byteLength <= 240;

/** UTF-8 filenames keep Chinese entity/metric labels outside raw HTTP headers. */
export function artifactContentDisposition(filename: string): string {
  if (!safeName(filename)) throw new Error('ARTIFACT_FILENAME_INVALID');
  const ascii = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Accept only our bounded, non-path filename grammar, plus legacy ASCII names. */
export function parseArtifactFilename(header: string | null): string | null {
  if (!header || header.length > 1600) return null;
  const match = /^attachment; filename="([a-zA-Z0-9._-]+)"(?:; filename\*=UTF-8''([a-zA-Z0-9._%\-]+))?$/.exec(header);
  if (!match || !safeName(match[1])) return null;
  try {
    const filename = match[2] ? decodeURIComponent(match[2]) : match[1];
    return safeName(filename) && filename.split('.').at(-1) === match[1].split('.').at(-1) ? filename : null;
  } catch { return null; }
}
