import { type FactSnapshot, type Quarter, type SourceRef } from '../contracts';
import { resolveNumericFact } from '../facts';
import { numericFields, type NumericField } from '../registry';

export const currentPeriod: Quarter = { year: 2026, quarter: 3 };
export const basePeriod: Quarter = { year: 2026, quarter: 2 };

export function nameSource(id: string, name: string): SourceRef {
  return { id: `name/${id}`, table: 'buildings', recordId: id, entityId: id, field: 'name', recordVersion: 'fixture-v1', rawValue: name, unit: 'text', period: null, recordedAt: null, businessAsOf: null, verification: 'database_only', original: null };
}

export function source(entityId: string, field: NumericField, rawValue: unknown, period: Quarter | null = currentPeriod, suffix = ''): SourceRef {
  const rule = numericFields[field];
  return {
    id: `${entityId}/${field}/${period?.quarter ?? 'source'}/${suffix}`, table: rule.table,
    recordId: `${entityId}/${period?.quarter ?? 'source'}/${suffix}`, field: rule.column,
    entityId, recordVersion: 'fixture-v1', rawValue, unit: rule.unit,
    period: rule.temporal === 'quarter' ? period : null, recordedAt: '2026-10-01T00:00:00Z',
    businessAsOf: null, verification: 'database_only', original: null,
  };
}

/** Synthetic A–D acceptance contract, never imported by production code. */
export function fixture(period: Quarter = currentPeriod): FactSnapshot {
  const isBase = period.quarter === 2;
  const area = [10000, 30000, 20000, 10000];
  const rent = isBase ? [90, 180, 160, 140] : [100, 200, null, 150];
  const vacancy = isBase ? [2000, 3000, 4000, 1000] : [1000, 6000, null, 15000];
  const height = [[210], [198], [null], [200, 230]];
  return {
    snapshotId: `fixture-${period.year}-${period.quarter}`, dataVersion: 'synthetic-v1', scopeFingerprint: 'synthetic-CBD-authorized-inventory',
    period, complete: true, expectedCount: 4,
    rows: ['A', 'B', 'C', 'D'].map((id, index) => ({
      id, name: `${id}座`, nameSource: nameSource(id, `${id}座`), facts: {
        totalArea: resolveNumericFact('totalArea', id, [source(id, 'totalArea', area[index], period)], period),
        netEffectiveRent: resolveNumericFact('netEffectiveRent', id, [source(id, 'netEffectiveRent', rent[index], period)], period),
        vacantArea: resolveNumericFact('vacantArea', id, [source(id, 'vacantArea', vacancy[index], period)], period),
        height: resolveNumericFact('height', id, height[index].map((value, n) => source(id, 'height', value, null, String(n))), null),
      },
    })),
  };
}
