import { z } from 'zod';
import { quarterSchema } from './contracts';

const number = z.object({
  exact: z.object({ numerator: z.string().regex(/^-?\d{1,5000}$/), denominator: z.string().regex(/^[1-9]\d{0,4999}$/) }),
  numeric: z.number().finite(),
});
const ids = z.array(z.string().max(1000)).max(200000);
// References are local to this series and point only to canonical evidence
// arrays, never to external content. They avoid serializing identical long
// database source IDs in every derived change and presentation alias.
const sourceRefs = z.array(z.strictObject({ collection: z.enum(['perPeriod', 'commonSample', 'comparability']),
  index: z.number().int().min(0).max(39) })).max(2).optional();
const coverage = z.object({ total: z.number().int().nonnegative(), valid: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(), invalid: z.number().int().nonnegative(), conflict: z.number().int().nonnegative(), unverified: z.number().int().nonnegative() });
const period = z.object({ period: quarterSchema, value: number.nullable(), simpleMean: number.nullable(),
  usedCount: z.number().int().nonnegative(), coverage, numerator: number, denominator: number,
  denominatorUnit: z.enum(['m2', 'building_count']), usedEntityIds: ids, sourceIds: ids, sourceRefs });
const change = z.object({ base: quarterSchema, current: quarterSchema, baseValue: number.nullable(), currentValue: number.nullable(),
  difference: number.nullable(), differenceUnit: z.enum(['CNY/m2/month', 'percentage_point', 'm2']),
  change: number.nullable(), changeUnit: z.enum(['percent', 'percentage_point']),
  unavailableReason: z.enum(['no_valid_sample', 'zero_base']).nullable(), sourceIds: ids, sourceRefs });
const comparability = z.object({ base: quarterSchema, current: quarterSchema,
  baseCount: z.number().int().nonnegative(), currentCount: z.number().int().nonnegative(), commonCount: z.number().int().nonnegative(),
  enteredEntityIds: ids, exitedEntityIds: ids, baseDenominator: number, currentDenominator: number,
  denominatorDifference: number, denominatorUnit: z.enum(['m2', 'building_count']),
  perPeriod: change, commonSample: change, sourceIds: ids });
const anomaly = z.object({ rule: z.enum(['entity_qoq_rent_30_percent', 'entity_qoq_vacancy_10_pp', 'iqr_1_5']),
  entityId: z.string(), name: z.string(), period: quarterSchema, basePeriod: quarterSchema.nullable(),
  value: number, baseValue: number.nullable(), change: number.nullable(), changeUnit: z.enum(['percent', 'percentage_point']).nullable(),
  threshold: number.nullable(), lowerFence: number.nullable(), upperFence: number.nullable(),
  sampleCount: z.number().int().nonnegative(), sourceIds: ids });

/** A deterministic, versioned supplement to the original immutable table and
 * analysis. This client-safe schema does not accept a model's numeric claims. */
export const researchAnalysisSchema = z.object({
  version: z.literal('research-analysis/1'),
  findings: z.array(z.object({ id: z.string(), kind: z.enum(['trend', 'comparability', 'quality', 'method']),
    title: z.string().max(1000), text: z.string().max(10000), sourceIds: ids,
    evidence: z.record(z.string(), z.unknown()) })).max(1000),
  series: z.array(z.object({ key: z.string(), label: z.string(), metric: z.enum(['rent', 'vacancy', 'totalArea']),
    unit: z.enum(['CNY/m2/month', 'ratio', 'm2']), mode: z.enum(['per_period', 'paired']), formulaVersion: z.string(),
    periods: z.array(period).max(40), perPeriod: z.array(period).max(40), commonSample: z.array(period).max(40), commonEntityIds: ids,
    direction: z.enum(['increasing', 'decreasing', 'stable', 'fluctuating', 'incomplete', 'single_period']),
    overall: change.nullable(), quarterOnQuarter: z.array(change).max(39), yearOnYear: z.array(change).max(36),
    comparability: z.array(comparability).max(40), anomalies: z.array(anomaly).max(200000),
    anomalyCoverage: z.object({ complete: z.boolean(), detected: z.number().int().nonnegative(),
      returned: z.number().int().nonnegative(), omitted: z.number().int().nonnegative(),
      iqrDetected: z.number().int().nonnegative(), quarterOnQuarterDetected: z.number().int().nonnegative() }).optional(),
    classificationTime: z.literal('current_catalog'), classificationSourceIds: ids.optional(),
  })).max(400),
  rules: z.array(z.object({ id: z.string(), description: z.string() })),
  resourceUsage: z.object({ status: z.enum(['complete', 'limited', 'skipped']), observationCount: z.number().int().nonnegative(),
    reason: z.enum(['observation_limit', 'evidence_limit', 'exact_calculation_limit', 'output_limit']).nullable(),
    limits: z.object({ observations: z.number().int().positive(), inputSourceReferences: z.number().int().positive(),
      inputSourceCharacters: z.number().int().positive(), anomalies: z.number().int().positive(),
      anomalySourceReferences: z.number().int().positive(), outputBytes: z.number().int().positive(),
      combinedResultBytes: z.number().int().positive().optional() }) }).optional(),
});
export type ResearchAnalysis = z.infer<typeof researchAnalysisSchema>;
export type ResearchSeries = ResearchAnalysis['series'][number];
export type ResearchPeriod = ResearchSeries['periods'][number];
export type ResearchChange = NonNullable<ResearchSeries['overall']>;
export type ResearchAnomaly = ResearchSeries['anomalies'][number];

/** Resolve saved provenance without recalculating a business value. The targets
 * retain complete canonical source IDs in this immutable result snapshot. */
export function resolveResearchSources(series: ResearchSeries, entry: Pick<ResearchPeriod, 'sourceIds' | 'sourceRefs'>): string[] {
  const ids = [...entry.sourceIds];
  for (const ref of entry.sourceRefs ?? []) {
    const target = series[ref.collection][ref.index];
    if (!target) throw new Error('RESEARCH_SOURCE_REFERENCE_INVALID');
    ids.push(...target.sourceIds);
  }
  return [...new Set([...ids, ...(series.classificationSourceIds ?? [])])].sort();
}
