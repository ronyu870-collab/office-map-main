import { z } from 'zod';
import { quarterSchema, type Quarter, type SourceRef } from '@/src/lib/intelligence/query/contracts';
import type { SubmarketProfileDraft } from '@/src/app/map/model/submarketProfile';
import type { QueryResult } from '@/src/lib/intelligence/query/result';
import type { BusinessDataBinding, ProposalBrief } from '../integration-contracts';

const name = z.string().trim().min(1).max(80);
const range = (maximum: number) => z.strictObject({
  min: z.number().finite().min(0).max(maximum).optional(),
  max: z.number().finite().min(0).max(maximum).optional(),
}).refine(value => (value.min ?? 0) <= (value.max ?? maximum));
const day = z.iso.date();

export const unifiedPitchRequestSchema = z.strictObject({
  scenario: z.enum(['leasing-agency', 'office-comparison', 'market-report', 'building-promotion', 'site-selection', 'analysis-briefing']),
  city: name.default('北京'),
  buildingIds: z.array(z.uuid()).max(20).default([]),
  buildingQuery: name.optional(),
  submarkets: z.array(name).max(8).default([]),
  period: quarterSchema.nullable().default(null),
  start: quarterSchema.optional(),
  filters: z.strictObject({
    grade: z.enum(['a', 'b', 'park', 'other']).optional(),
    quarterArea: range(Number.MAX_SAFE_INTEGER).optional(),
    rent: range(Number.MAX_SAFE_INTEGER).optional(),
    vacancy: range(1).optional(),
  }).optional(),
  lease: z.strictObject({
    source: z.enum(['live', 'history', 'combined']).optional(),
    from: day,
    to: day,
  }).optional(),
}).superRefine((input, context) => {
  if (input.buildingQuery && input.buildingIds.length) {
    context.addIssue({ code: 'custom', path: ['buildingQuery'], message: 'Specify a name or building IDs' });
  }
  if (input.lease && input.lease.from > input.lease.to) {
    context.addIssue({ code: 'custom', path: ['lease'], message: 'Lease range must be chronological' });
  }
});

export type UnifiedPitchRequest = z.output<typeof unifiedPitchRequestSchema>;
export type PitchDemo = 'xiaoyun-agency' | 'cbd-grade-a' | 'beijing-quarterly' | 'building-promotion';

export function requestFromProposalBrief(brief: ProposalBrief): UnifiedPitchRequest {
  const parseQuarter = (text: string) => {
    const match = /^(\d{4})-?Q([1-4])$/.exec(text);
    return quarterSchema.parse(match ? { year: Number(match[1]), quarter: Number(match[2]) } : text);
  };
  return unifiedPitchRequestSchema.parse({
    scenario: brief.scenario, city: brief.city, buildingIds: brief.buildingIds, submarkets: brief.submarkets,
    period: brief.period ? parseQuarter(brief.period) : null,
    ...(brief.start ? { start: parseQuarter(brief.start) } : {}),
  });
}

export type PitchGap = Readonly<{
  section: 'building' | 'period' | 'history' | 'lease' | 'research' | 'candidates';
  reason: string;
  entityId?: string;
}>;

export type PitchValue = Readonly<{
  entityId: string;
  fieldId: string;
  value: string | number | readonly string[] | null;
  exact?: { numerator: string; denominator: string };
  unit: string | null;
  period: Quarter | null;
  businessAsOf: string | null;
  sources: readonly SourceRef[];
  dataVersion: string | null;
  permission: 'authorized' | 'denied';
  disclosure: 'internal' | 'withheld';
  state: 'valid' | 'not_reported' | 'unknown' | 'invalid' | 'conflict' | 'unverified' | 'unauthorized';
  reason: string | null;
}>;

export type PitchBuildingContext = Readonly<{
  buildingId: string;
  name: string;
  static: Readonly<Record<string, PitchValue>>;
  quarter: Readonly<Record<string, PitchValue>>;
  history: readonly Readonly<Record<string, PitchValue>>[];
  towers: readonly PitchTowerIdentity[];
  towerStatus: 'authorized' | 'unauthorized' | 'not_recorded' | 'not_requested';
}>;

export type PitchTowerIdentity = Readonly<{
  towerId: string;
  buildingId: string;
  name: PitchValue;
  code: PitchValue;
}>;

type EditorialSection = 'demographics' | 'policies' | 'insights';
export type PitchResearchEntry = {
  [Section in EditorialSection]: Readonly<{
    section: Section;
    entityId: string;
    value: SubmarketProfileDraft[Section][number];
    source: SourceRef;
    permission: 'authorized';
    disclosure: 'internal';
  }>
}[EditorialSection];

export type PitchContextReceipt = Readonly<{
  domain: 'quarter' | 'lease' | 'business';
  permissionRevision: string;
  policyVersion: string;
  dataVersion: string;
  dataAsOf: string | null;
  disclosure: 'internal';
}>;

export type PitchContextResult = Readonly<{
  id: string;
  entityId: string;
  binding: PitchContextReceipt;
  result: QueryResult;
}>;

export type PitchCandidate = Readonly<{
  buildingId: string;
  name: string;
  reasons: readonly string[];
  missing: readonly string[];
  distanceKm: number | null;
}>;

export type UnifiedPitchContext = Readonly<{
  protocol: 'unified-pitch-context/1';
  request: UnifiedPitchRequest;
  capturedAt: string;
  fingerprint: string;
  dataVersion: string;
  period: Quarter | null;
  periodBasis: 'explicit' | 'latest_formal' | 'unavailable';
  dataAsOf: string | null;
  disclosure: 'internal';
  isTestData: false;
  buildings: readonly PitchBuildingContext[];
  candidates: readonly PitchCandidate[];
  candidateMethod: 'rule_based';
  results: readonly PitchContextResult[];
  research: readonly PitchResearchEntry[];
  receipts: readonly PitchContextReceipt[];
  bindings: readonly BusinessDataBinding[];
  gaps: readonly PitchGap[];
}>;
