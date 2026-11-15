import type { FactSnapshot } from '../contracts';
import { parseQueryPlan, planPeriods, type QueryPlan } from '../plan';
import { describePlanRead } from '../snapshotReader';
import { fixture } from './fixtures';

/** Synthetic current-catalog groups only; never imported by production code. */
export function crossTrendPlan(extra: Record<string, unknown> = {}): QueryPlan {
  return parseQueryPlan({ operation: 'cross_trend', metric: 'rent', metrics: ['rent', 'vacancy'],
    start: { year: 2026, quarter: 2 }, end: { year: 2026, quarter: 3 }, mode: 'per_period',
    scope: { inventory: 'tracked' }, ...extra });
}

export function crossTrendSnapshots(plan: QueryPlan,
  submarkets: (string | null)[] = ['CBD', '金融街', 'CBD', '金融街'],
  grades: (string | null)[] = ['A', 'B', 'A', 'B']): FactSnapshot[] {
  return planPeriods(plan).map(period => {
    const snapshot = fixture(period!);
    return { ...snapshot, queryScope: { ...plan.scope, filter: plan.filter ?? null,
      requestedFields: describePlanRead(plan).fields, inventoryTime: 'current_catalog' },
      rows: snapshot.rows.map((row, index) => ({ ...row, dimensions: Object.fromEntries((['submarket', 'grade'] as const).map(field => {
        const value = field === 'submarket' ? submarkets[index] : grades[index];
        return [field, { value, source: { ...row.nameSource, field, rawValue: value, id: `${field}/${row.id}` } }];
      })) })),
    };
  });
}
