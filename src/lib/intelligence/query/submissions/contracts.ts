import { z } from 'zod';
import { quarterSchema } from '../contracts';

export const SUBMISSION_POLICY = 'quarterly-submission-observation/1';
export const submissionFields = {
  total_area: { label: '总面积', unit: 'm2' },
  vacant_area: { label: '空置面积', unit: 'm2' },
  vacancy_rate: { label: '填报空置率', unit: 'percent' },
  asking_rent: { label: '报价租金', unit: 'CNY/m2/day' },
  management_fee: { label: '物业费', unit: 'CNY/m2/month' },
  face_rent: { label: '表面租金', unit: 'CNY/m2/month' },
  rent_free_period: { label: '免租期', unit: 'month' },
  net_effective_rent: { label: '净有效租金', unit: 'CNY/m2/month' },
} as const;
export type SubmissionField = keyof typeof submissionFields;
export const submissionFieldKeys = Object.keys(submissionFields) as SubmissionField[];
export const submissionReadSchema = z.strictObject({
  period: quarterSchema.nullable(), // null means configured submission period, never calendar/latest data.
  quality: z.boolean(),
  submarkets: z.array(z.string().trim().min(1).max(80)).min(1).max(30).optional(),
  buildingIds: z.array(z.uuid()).min(1).max(500).optional(),
});
export type SubmissionRead = z.infer<typeof submissionReadSchema>;
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const time = z.iso.datetime({ offset: true });
const record = { id: z.uuid(), version: hash };
// SQL response size is bounded; Decimal decides numeric validity/precision per cell.
const values = z.record(z.string(), z.string().nullable());
export const submissionSnapshotSchema = z.strictObject({
  policy: z.literal(SUBMISSION_POLICY), snapshotId: z.uuid(), databaseSnapshot: z.string().min(1), readAt: time,
  requestId: z.uuid(), period: quarterSchema, configuredPeriod: quarterSchema.nullable(),
  periodBasis: z.enum(['explicit', 'configured']), quality: z.boolean(),
  inventory: z.literal('current_active_tracked_stock'), assignmentsTime: z.literal('current'),
  complete: z.literal(true),
  expected: z.strictObject({ buildings: z.number().int().min(0).max(20000), assignments: z.number().int().min(0).max(100000), submissions: z.number().int().min(0).max(100000) }),
  settings: z.array(z.strictObject({ key: z.enum(['current_submission_year', 'current_submission_quarter']), value: z.string(), updatedAt: time.nullable(), version: hash })).max(2),
  buildings: z.array(z.strictObject({ ...record, name: z.string().min(1), submarket: z.string().nullable(), grade: z.string().nullable() })).max(20000),
  assignments: z.array(z.strictObject({ ...record, buildingId: z.uuid(), userId: z.string(), userName: z.string(), createdAt: time.nullable() })).max(100000),
  submissions: z.array(z.strictObject({ ...record, buildingId: z.uuid(), userId: z.uuid(), userName: z.string(),
    year: z.number().int(), quarter: z.number().int(), createdAt: time.nullable(), updatedAt: time.nullable(), values })).max(100000),
});
export type SubmissionSnapshot = z.infer<typeof submissionSnapshotSchema>;

/** Validate the entire adapter output before computing any counts or displaying any names. */
export function validateSubmissionSnapshot(input: unknown): SubmissionSnapshot {
  const s = submissionSnapshotSchema.parse(input);
  for (const key of ['buildings', 'assignments', 'submissions'] as const) {
    if (s[key].length !== s.expected[key] || new Set(s[key].map(r => r.id)).size !== s[key].length) throw new Error('INCOMPLETE_SUBMISSION_SNAPSHOT');
  }
  if (new Set(s.settings.map(r => r.key)).size !== s.settings.length) throw new Error('DUPLICATE_SUBMISSION_SETTING');
  const y = s.settings.find(r => r.key === 'current_submission_year')?.value;
  const q = s.settings.find(r => r.key === 'current_submission_quarter')?.value;
  const configured = /^\d{4}$/.test(y ?? '') && /^[1-4]$/.test(q ?? '')
    ? quarterSchema.safeParse({ year: Number(y), quarter: Number(q) }) : null;
  const expected = configured?.success ? configured.data : null;
  if (JSON.stringify(s.configuredPeriod) !== JSON.stringify(expected)
    || s.periodBasis === 'configured' && JSON.stringify(s.period) !== JSON.stringify(expected)) throw new Error('SUBMISSION_PERIOD_MISMATCH');
  const ids = new Set(s.buildings.map(r => r.id));
  if (s.assignments.some(r => !ids.has(r.buildingId)) || s.submissions.some(r => !ids.has(r.buildingId)
    || r.year !== s.period.year || r.quarter !== s.period.quarter)) throw new Error('SUBMISSION_SCOPE_MISMATCH');
  const fields = s.quality ? [...submissionFieldKeys].sort() : [];
  if (s.submissions.some(r => JSON.stringify(Object.keys(r.values).sort()) !== JSON.stringify(fields))) throw new Error('SUBMISSION_FIELDS_MISMATCH');
  return s;
}
