import { z } from 'zod';
import type { Decimal, ExactNumber } from './decimal';
import type { NumericField } from './registry';

export const quarterSchema = z.strictObject({ year: z.number().int().min(1900).max(2200), quarter: z.number().int().min(1).max(4) });
export type Quarter = z.infer<typeof quarterSchema>;
export const quarterKey = (period: Quarter): string => `${period.year}-Q${period.quarter}`;

export type SourceRef = Readonly<{
  id: string;
  table: string;
  recordId: string;
  field: string;
  entityId: string;
  recordVersion: string;
  rawValue: unknown;
  unit: string;
  period: Quarter | null;
  recordedAt: string | null;
  businessAsOf: string | null;
  verification: 'database_only' | 'verified_original' | 'unreviewed' | 'historical';
  original: { documentId: string; version: string; page?: number; sheet?: string; row?: number; location?: string } | null;
}>;
export type FactState = 'valid' | 'missing' | 'invalid' | 'conflict' | 'unverified';
export type NumericFact =
  | Readonly<{ state: 'valid'; value: Decimal; sources: readonly SourceRef[] }>
  | Readonly<{ state: Exclude<FactState, 'valid'>; reason: string; sources: readonly SourceRef[] }>;

export type BuildingFacts = Readonly<{
  id: string;
  name: string;
  nameSource: SourceRef;
  dimensions?: Readonly<Partial<Record<'submarket' | 'grade', Readonly<{ value: string | null; source: SourceRef }>>>>;
  facts: Readonly<Partial<Record<NumericField, NumericFact>>>;
}>;

/** Internal adapter output, never trusted from client/model input. Scope contains authorized rows only. */
export type FactSnapshot = Readonly<{
  snapshotId: string;
  dataVersion: string;
  scopeFingerprint: string;
  period: Quarter | null;
  expectedCount: number;
  complete: boolean;
  rows: readonly BuildingFacts[];
  queryScope?: Readonly<Record<string, unknown>>;
}>;

export type Coverage = Readonly<Record<FactState, number> & { total: number }>;
export type NumericOutput = Readonly<{ exact: ExactNumber; numeric: number }>;
export type Exclusion = Readonly<{ entityId: string; state: Exclude<FactState, 'valid'>; reason: string; sourceIds: readonly string[] }>;

export function assertComplete(snapshot: FactSnapshot): void {
  if (!snapshot.snapshotId || !snapshot.dataVersion || !snapshot.scopeFingerprint) throw new Error('SNAPSHOT_CONTEXT_REQUIRED');
  if (!snapshot.complete || !Number.isSafeInteger(snapshot.expectedCount) || snapshot.expectedCount !== snapshot.rows.length) throw new Error('INCOMPLETE_SNAPSHOT');
  if (new Set(snapshot.rows.map(row => row.id)).size !== snapshot.rows.length) throw new Error('DUPLICATE_ENTITY');
  if (snapshot.rows.some(row => !row.id || !row.name)) throw new Error('INVALID_ENTITY');
  for (const row of snapshot.rows) {
    const source = row.nameSource;
    if (!source || !source.id || !source.recordVersion || source.table !== 'buildings' || source.field !== 'name' || source.recordId !== row.id || source.entityId !== row.id || source.rawValue !== row.name) throw new Error('ENTITY_SOURCE_REQUIRED');
  }
  if (snapshot.period) quarterSchema.parse(snapshot.period);
}
