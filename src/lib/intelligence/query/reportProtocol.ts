import { z } from 'zod';
import { shanghaiQuarter, shiftQuarter } from './relativeQuarter';
import { chartRequestSchema } from './chartSpec';

/** No narrative, numbers, HTML, URLs, source records or file paths from models. */
export const reportRequestSchema = z.strictObject({
  resultIds: z.array(z.uuid()).min(1).max(8),
  purpose: z.enum(['internal', 'client']).default('internal'),
  charts: z.array(z.strictObject({ resultId: z.uuid(), chart: chartRequestSchema })).max(8).default([]),
});
export const reportDescriptorSchema = z.object({ version: z.enum(['research-pdf/1', 'research-output/1']),
  format: z.enum(['pdf', 'xlsx', 'docx', 'pptx']), purpose: z.literal('internal'), generatedAt: z.iso.datetime(),
  sectionCount: z.number().int().min(1).max(8), rowCount: z.number().int().nonnegative(),
});
export const REPORT_LIMITS = { rows: 4000, pages: 200, archiveBytes: 15 * 1024 * 1024, textCharacters: 800000 } as const;

/** Report default: completed Shanghai calendar quarters, never latest-data fallback. */
export function reportPeriodRange(count: number, receivedAt = new Date()) {
  z.number().int().min(1).max(12).parse(count);
  const end = shiftQuarter(shanghaiQuarter(receivedAt), -1);
  return { start: shiftQuarter(end, 1 - count), end };
}
