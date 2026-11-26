import { z } from 'zod';
import { scopeSchema } from '../contracts/content';
export const PARSER_VERSION = 'pitch-structure/1';
export const MAX_FILE = 12 * 1024 * 1024, CHUNK_SIZE = 768 * 1024, MAX_PAGES = 120;
export const formats = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain',
} as const;
export const boxSchema = z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().finite(), h: z.number().finite() });
export const parsedPageSchema = z.object({
  protocol: z.literal('pitch-source/1'), ordinal: z.number().int().min(1).max(MAX_PAGES), locator: z.string().min(1).max(300),
  kind: z.enum(['slide', 'pdf-page', 'word-section', 'worksheet', 'image', 'text']), title: z.string().max(4000),
  size: z.object({ width: z.number().positive(), height: z.number().positive(), unit: z.enum(['emu', 'pt', 'px']) }).nullable(),
  texts: z.array(z.object({ text: z.string().max(50000), role: z.enum(['title', 'subtitle', 'body']), box: boxSchema.nullable(), groups: z.array(z.string()) })).max(400),
  images: z.array(z.object({ key: z.string(), mediaId: z.uuid().optional(), box: boxSchema.nullable(), crop: z.record(z.string(), z.string()), groups: z.array(z.string()) })).max(80),
  shapes: z.array(z.object({ type: z.string(), box: boxSchema.nullable(), groups: z.array(z.string()) })).max(300),
  tables: z.array(z.object({ columns: z.array(z.string()).max(100), rows: z.array(z.array(z.union([z.string(), z.number().finite(), z.boolean(), z.null()]))).max(200), range: z.string().optional(), cells: z.array(z.object({ address: z.string(), type: z.string(), value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]), formula: z.string().optional(), cached: z.boolean() })).max(20000).optional() })).max(30),
  charts: z.array(z.object({ type: z.string(), categories: z.array(z.string()).max(200), series: z.array(z.object({ name: z.string(), unit: z.string(), values: z.array(z.number().finite().nullable()).max(200) })).max(10), cached: z.boolean() })).max(15),
  notesPresent: z.boolean(), hidden: z.boolean(), hiddenObjects: z.number().int().min(0), references: z.array(z.string()).max(100), warnings: z.array(z.string()).max(100),
  status: z.enum(['completed', 'partial', 'manual']),
});
export type ParsedPage = z.infer<typeof parsedPageSchema>;
export type ExtractedMedia = { key: string; mime: string; bytes: Uint8Array; width: number; height: number; sha256: string };
export type ParserSession = { count: number; page: (index: number) => Promise<{ page: ParsedPage; media: ExtractedMedia[] }>; close: () => Promise<void> };
export const uploadMetadataSchema = z.strictObject({ scope: scopeSchema, language: z.string().regex(/^[a-z]{2}(?:-[A-Za-z0-9]+)*$/), dataAsOf: z.iso.date().nullable(),
  validFrom: z.iso.date().nullable(), validUntil: z.iso.date().nullable(), visibility: z.enum(['private', 'organization']), source: z.string().min(1).max(1000), tags: z.array(z.string().min(1).max(60)).max(30), categoryId: z.uuid(), isTestData: z.boolean(), allowClientExport: z.boolean(),
}).refine(v => !v.validFrom || !v.validUntil || v.validFrom <= v.validUntil).refine(v => !v.isTestData || !v.allowClientExport);
export const importStates = ['queued', 'processing', 'completed', 'partially_completed', 'failed', 'cancelled'] as const;
export const blankPage = (ordinal: number, kind: ParsedPage['kind'], locator: string): ParsedPage => ({ protocol: 'pitch-source/1', ordinal, locator, kind, title: '', size: null, texts: [], images: [], shapes: [], tables: [], charts: [], notesPresent: false, hidden: false, hiddenObjects: 0, references: [], warnings: [], status: 'completed' });
export function finishPage(page: ParsedPage) {
  if (page.warnings.length || page.hiddenObjects || page.notesPresent || page.hidden) page.status = page.status === 'manual' ? 'manual' : 'partial';
  if (!page.texts.length && !page.images.length && !page.tables.length && !page.charts.length) { page.status = 'manual'; page.warnings.push('未获得可重用业务内容；需要人工处理原件。'); }
  return parsedPageSchema.parse(page);
}
