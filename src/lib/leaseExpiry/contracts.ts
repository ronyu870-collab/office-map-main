import { z } from 'zod';

export const reviewStatusLabels = { pending: '未标记问题', missing_info: '资料不足', source_conflict: '来源差异' } as const;
export type SourceKind = 'history' | 'live';
export type ReviewStatus = keyof typeof reviewStatusLabels;
export const saveReviewSchema = z.object({
  source_kind: z.enum(['history', 'live']),
  source_id: z.uuid(), expected_revision: z.number().int().min(0).max(2147483646),
  source_fingerprint: z.string().regex(/^[a-f0-9]{32}$/), request_id: z.uuid(),
  status: z.enum(['pending', 'missing_info', 'source_conflict']),
  notes: z.string().max(4000), evidence_reference: z.string().max(1000),
}).strict().refine(value => value.status === 'pending' || value.notes.trim().length > 0, { message: '请填写资料不足或来源差异的原因' });
export type SaveReview = z.infer<typeof saveReviewSchema>;
export type Source = {
  id: string; company: string | null; building: string | null;
  period_start: string | null; period_end: string | null; period_source: string | null; precision: string;
  lease_term_months: number | null; source_lease_term_raw: string | null;
  source_file: string | null; source_sheet: string | null; source_row: number | null;
  source_info_date: string | null; quality_status: string | null; building_match_scope: string;
};
export type Review = {
  source_kind: SourceKind; source_id: string; revision: number; status: ReviewStatus; notes: string; evidence_reference: string;
  source_snapshot: Source; source_fingerprint: string; updated_by: string; updated_at: string;
};
export type Candidate = { source_kind: SourceKind; source_available: boolean; source: Source; source_fingerprint: string; proxy_start: string | null; proxy_end: string | null; has_later_name_match: boolean; review: Review | null };
export type CandidatePage = { items: Candidate[]; total: number; page: number; page_size: number; as_of: string; window_end: string };
export function chinaToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Separate from the immutable review snapshot and its fingerprint. */
export type ExpiryDetails = { area_sqm: number | null; industry: string | null; sub_industry: string | null; sub_market: string | null };
export type ExpiryCandidate = Candidate & { details?: ExpiryDetails };
export type ExpiryPage = Omit<CandidatePage, 'items'> & { items: ExpiryCandidate[] };
