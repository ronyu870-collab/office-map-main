import { z } from 'zod';

const limitedText = (limit: number) => z.string().trim().max(limit);
const httpsSource = z.string().trim().max(600).refine(
  value => !value || /^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(value),
  { message: '来源链接必须使用 https://' },
);

const demographicSchema = z.strictObject({
  label: limitedText(80),
  value: limitedText(80),
  unit: limitedText(40),
  scope: limitedText(120),
  asOf: limitedText(40),
  sourceUrl: httpsSource,
}).refine(value => Boolean(value.label && value.value && value.unit && value.scope && value.asOf && value.sourceUrl),
  { message: '人口事实必须有数值、统计范围、时期和来源' });
const policySchema = z.strictObject({
  title: limitedText(160),
  issuer: limitedText(100),
  summary: limitedText(1000),
  applicability: limitedText(500),
  asOf: limitedText(60),
  sourceUrl: httpsSource,
}).refine(value => Boolean(value.title && value.issuer && value.summary && value.applicability && value.asOf && value.sourceUrl),
  { message: '政策必须注明发布机构、适用条件、日期和原文' });
const insightSchema = z.strictObject({
  title: limitedText(100),
  body: limitedText(1000),
  author: limitedText(80),
  asOf: limitedText(40),
}).refine(value => Boolean(value.title && value.body && value.author && value.asOf),
  { message: '团队观点必须注明作者和更新日期' });

export const submarketProfileSchema = z.strictObject({
  headline: limitedText(160),
  overview: limitedText(2500),
  industries: limitedText(1600),
  transport: limitedText(1600),
  demographics: z.array(demographicSchema).max(12),
  policies: z.array(policySchema).max(20),
  insights: z.array(insightSchema).max(12),
});

export type SubmarketProfileDraft = z.infer<typeof submarketProfileSchema>;
export type DemographicFact = SubmarketProfileDraft['demographics'][number];
export type SubmarketPolicy = SubmarketProfileDraft['policies'][number];
export type SubmarketInsight = SubmarketProfileDraft['insights'][number];
export type SubmarketProfile = SubmarketProfileDraft & {
  submarket: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

export function emptySubmarketProfile(): SubmarketProfileDraft {
  return {
    headline: '', overview: '', industries: '', transport: '',
    demographics: [], policies: [], insights: [],
  };
}

export function readSubmarketProfileRow(row: Record<string, unknown> | null | undefined, name: string): SubmarketProfile {
  const parsed = submarketProfileSchema.safeParse({
    headline: row?.headline ?? '',
    overview: row?.overview ?? '',
    industries: row?.industries ?? '',
    transport: row?.transport ?? '',
    demographics: row?.demographics ?? [],
    policies: row?.policies ?? [],
    insights: row?.insights ?? [],
  });
  const content = parsed.success ? parsed.data : emptySubmarketProfile();
  return {
    ...content,
    submarket: name,
    updatedAt: typeof row?.updated_at === 'string' ? row.updated_at : null,
    updatedBy: typeof row?.updated_by === 'string' ? row.updated_by : null,
  };
}
