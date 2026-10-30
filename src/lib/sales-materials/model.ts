import { z } from 'zod';

export const SALES_MATERIAL_BUCKET = 'building-sales-materials';
export const MAX_MATERIAL_BYTES = 512 * 1024 * 1024;
export const MATERIAL_PAGE_SIZE = 30;
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const PPTM_MIME = 'application/vnd.ms-powerpoint.presentation.macroEnabled.12';
export const MATERIAL_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', XLSX_MIME, PPTX_MIME, PPTM_MIME] as const;
export type MaterialMimeType = typeof MATERIAL_MIME_TYPES[number];

const extensions: Record<MaterialMimeType, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'], 'application/pdf': ['pdf'], [XLSX_MIME]: ['xlsx'], [PPTX_MIME]: ['pptx'], [PPTM_MIME]: ['pptm'],
};

export function materialMimeType(name: string, declaredType: string): MaterialMimeType | null {
  const extension = name.split('.').pop()?.toLowerCase();
  const mime = MATERIAL_MIME_TYPES.find(type => extensions[type].includes(extension || ''));
  return mime && (!declaredType || declaredType === mime) ? mime : null;
}

export function matchesMaterialSignature(bytes: Uint8Array, mime: MaterialMimeType): boolean {
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (mime === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if ([XLSX_MIME, PPTX_MIME, PPTM_MIME].includes(mime)) return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
  return ascii(0, 5) === '%PDF-';
}

export function shanghaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const materialDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '资料日期格式不正确')
  .refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= shanghaiToday();
  }, '请填写有效的资料日期，不能晚于今天').nullable();

// Dates retain the precision supplied by the source; timestamps must include an offset.
export const timeEvidenceSchema = z.object({
  value: z.string().refine(value => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return materialDate.safeParse(value).success;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
    if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return false;
    const day = value.slice(0, 10);
    const calendar = new Date(`${day}T00:00:00Z`);
    const instant = Date.parse(value);
    return Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === day
      && Number.isFinite(instant) && instant <= Date.now();
  }, '时间必须有效、带时区且不晚于当前时间；仅有日期时保留日期精度'),
  evidence: z.string().trim().min(1, '必须注明时间依据').max(1000),
}).strict();
export type TimeEvidence = z.infer<typeof timeEvidenceSchema>;
export const sourceTimingSchema = z.object({
  document_date_evidence: z.string().trim().max(1000),
  received: timeEvidenceSchema.nullable(),
  as_of: timeEvidenceSchema.nullable().optional(),
}).strict();
export type MaterialProvenance = {
  document_date_evidence: string;
  received: TimeEvidence | null;
  as_of?: TimeEvidence | null;
  version_recorded_at: string;
  source_sha256: string;
};
export const historicalContextSchema = z.object({
  period_label: z.string().trim().min(1).max(160),
  evidence: z.string().trim().min(1).max(1000),
  not_current: z.literal(true),
}).strict();
export type HistoricalContext = z.infer<typeof historicalContextSchema>;
export type SalesMaterial = {
  id: string;
  title: string;
  document_date: string | null;
  source: string;
  notes: string;
  original_name: string;
  mime_type: MaterialMimeType;
  file_size: number;
  created_at: string;
  series_key?: string;
  scope_label?: string;
  content_types?: MaterialCategory[];
  data_date?: string | null;
  association_status?: 'confirmed' | 'unconfirmed';
  association_note?: string;
  historical_context?: HistoricalContext | null;
};
export type MaterialList = { records: SalesMaterial[]; count: number };
export const availabilityRowSchema = z.object({
  floor_unit: z.string().trim().min(1, '请填写楼层/单元').max(100),
  area_sqm: z.number().positive('面积须大于 0').max(1_000_000).nullable(),
  area_text: z.string().trim().min(1).max(160).optional(),
  area_basis: z.string().trim().max(40).optional(),
  orientation: z.string().trim().max(40),
  delivery_time: z.string().trim().max(100),
  delivery_condition: z.string().trim().max(100),
  asking_rent: z.number().nonnegative().max(1_000_000).nullable(),
  rent_basis: z.enum(['month', 'day', 'unspecified']),
  rent_unit: z.enum(['sqm', 'workstation', 'unspecified']).optional(),
  quote_text: z.string().trim().max(160).optional(),
  availability_status: z.string().trim().max(60).optional(),
  inventory_relation: z.object({group_key:z.string().max(100),kind:z.enum(['component','combined_option'])}).strict().optional(),
  management_fee: z.number().nonnegative().max(100_000).nullable(),
  price_note: z.string().trim().max(200),
  notes: z.string().trim().max(300),
  source_row_ref: z.string().trim().min(1).max(300).optional(),
  timing: z.object({
    as_of: timeEvidenceSchema.nullable(),
    confirmed: timeEvidenceSchema.nullable(),
  }).strict().optional(),
}).strict().refine(row => row.area_sqm !== null || !!row.area_text, '面积未知或冲突时须保留原文');
export type AvailabilityRow = z.infer<typeof availabilityRowSchema>;
export const materialCategorySchema = z.enum(['availability', 'commission', 'brochure']);
export type MaterialCategory = z.infer<typeof materialCategorySchema>;
const policyDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}).nullable();
export const commissionPolicySchema = z.object({
  key: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(160),
  scope: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(200),
  basis: z.string().trim().min(1).max(200),
  valid_from: policyDate,
  valid_until: policyDate,
  validity_note: z.string().trim().max(500),
  settlement: z.string().trim().max(500),
  rules: z.array(z.object({
    kind: z.enum(['base', 'bonus', 'tier', 'cap']),
    label: z.string().trim().min(1).max(100),
    reward: z.string().trim().min(1).max(200),
    condition: z.string().trim().max(1000),
    applicability: z.enum(['stated', 'unconfirmed']).default('stated'),
    valid_until: policyDate.optional(),
    validity_note: z.string().trim().max(500).optional(),
  }).strict()).min(1).max(40),
  source_ref: z.string().trim().min(1).max(300),
  notes: z.array(z.string().trim().max(500)).max(20),
}).strict().refine(policy => !policy.valid_from || !policy.valid_until || policy.valid_from <= policy.valid_until, '佣金有效期起止倒置');
export type CommissionPolicy = z.infer<typeof commissionPolicySchema>;
export const projectFactSchema = z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(1000), source_ref: z.string().trim().min(1).max(300) }).strict();
export type ProjectFact = z.infer<typeof projectFactSchema>;
export const workbookPreviewSchema = z.object({ sheets: z.array(z.object({ name: z.string().max(100), rows: z.array(z.array(z.string().max(2000)).max(30)).max(300) }).strict()).min(1).max(10) }).strict();
export type WorkbookPreview = z.infer<typeof workbookPreviewSchema>;
export const materialImportSchema = z.object({
  schema_version: z.union([z.literal(1), z.literal(2)]),
  historical_context: historicalContextSchema.nullable().optional(),
  series_key: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/).default('general'),
  scope_label: z.string().trim().min(1).max(100).default('房源资料'),
  content_types: z.array(materialCategorySchema).min(1).max(3).default(['availability']),
  association_status: z.enum(['confirmed','unconfirmed']).default('confirmed'),
  association_note: z.string().trim().max(500).default(''),
  original_name: z.string().trim().min(1).max(255).refine(value => !/[\\/]/.test(value)).optional(),
  building_id: z.uuid(),
  building_name: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(160),
  document_date: materialDate,
  source: z.string().trim().min(1).max(120),
  source_timing: sourceTimingSchema.optional(),
  project_address: z.string().trim().max(300).default(''),
  contacts: z.array(z.object({ name: z.string().max(100), phone: z.string().max(80) }).strict()).max(10).default([]),
  notes: z.string().trim().max(1000).default(''),
  details: z.array(availabilityRowSchema).max(200),
  commission_policies: z.array(commissionPolicySchema).max(40).default([]),
  project_facts: z.array(projectFactSchema).max(100).default([]),
  workbook_preview: workbookPreviewSchema.optional(),
  extraction: z.object({
    method: z.enum(['codex-vision', 'codex-document']),
    user_date_confirmed: z.boolean().optional(),
    historical_import_authorized: z.boolean().optional(),
    source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    reviewed: z.literal(true),
    uncertainties: z.array(z.string().max(300)).max(30),
  }).strict(),
}).strict().refine(value => value.extraction.uncertainties.length === 0, '存在未核实的识别内容，请先核对原件')
  .refine(value => !value.document_date || !!value.source_timing?.document_date_evidence, '资料日期必须注明原件中的具体依据')
  .refine(value => value.details.length + value.commission_policies.length + value.project_facts.length > 0, '资料不能没有房源、政策或项目内容')
  .refine(value => (!value.details.length || value.content_types.includes('availability')) && (!value.commission_policies.length || value.content_types.includes('commission')) && (!value.project_facts.length || value.content_types.includes('brochure')), '资料分类与内容不匹配')
  .refine(value => value.schema_version === 1 || (value.historical_context && value.extraction.historical_import_authorized === true) || value.extraction.user_date_confirmed === true, '请先向 Hang Yu 确认本份资料日期及含义')
  .refine(value => value.schema_version === 1 || !!value.historical_context || !!value.source_timing?.as_of || !!value.source_timing?.received || (!!value.document_date && !!value.source_timing?.document_date_evidence), '新资料必须记录已确认的日期与依据')
  .refine(value => !value.historical_context || (value.details.length === 0 && !value.content_types.includes('availability')), '历史资料不能发布为当前房源');
export type MaterialImport = z.infer<typeof materialImportSchema>;
export type MaterialAccess = {
  preview_url: string; download_url: string; details: AvailabilityRow[]; provenance: MaterialProvenance;
  commission_policies?: CommissionPolicy[]; project_facts?: ProjectFact[]; workbook_preview?: WorkbookPreview;
};

/** Expose only time evidence, never the private extraction bundle or contacts. */
export function materialProvenance(record: { extraction?: unknown; created_at: string; source_sha256: string }): MaterialProvenance {
  const extraction = record.extraction && typeof record.extraction === 'object' ? record.extraction as Record<string, unknown> : {};
  const timing = sourceTimingSchema.safeParse(extraction.source_timing);
  return {
    document_date_evidence: timing.success ? timing.data.document_date_evidence : '',
    received: timing.success ? timing.data.received : null,
    ...(timing.success && timing.data.as_of ? { as_of: timing.data.as_of } : {}),
    version_recorded_at: record.created_at,
    source_sha256: record.source_sha256,
  };
}

