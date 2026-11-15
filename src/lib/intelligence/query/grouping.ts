import { quarterSeries } from './analytics';
import { assertComplete, type FactSnapshot, type SourceRef } from './contracts';
import { catalogDimensions, type CatalogDimension } from './registry';

/** Group membership is a current-catalog fact, independently sourced from metric
 * validity. Establish groups before filters so empty/unknown groups do not vanish. */
export function catalogGroupMemberships(selected: readonly FactSnapshot[], universe: readonly FactSnapshot[], dimension: CatalogDimension) {
  if (!Object.hasOwn(catalogDimensions, dimension) || !universe.length || selected.length !== universe.length) throw new Error('GROUP_CONTEXT_REQUIRED');
  const memberships = new Map<string, { value: string | null; source: SourceRef }>();
  const groups = new Map<string, { key: string; value: string | null; label: string; entityIds: string[]; sourceIds: string[] }>();
  const ensure = (value: string | null) => {
    const key = `group/${encodeURIComponent(JSON.stringify(value))}`;
    if (!groups.has(key)) groups.set(key, { key, value, label: value ?? `未知（${catalogDimensions[dimension].label}未填写）`, entityIds: [], sourceIds: [] });
    return groups.get(key)!;
  };
  // Explicitly requested markets with no authorized matching rows remain empty,
  // without claiming there are no such buildings outside the authorized scope.
  if (dimension === 'submarket') {
    const requested = universe[0].queryScope?.submarkets;
    if (Array.isArray(requested) && requested.every(value => typeof value === 'string')) requested.forEach(ensure);
  }
  for (let i = 0; i < universe.length; i++) {
    const snapshot = universe[i], subset = selected[i]; assertComplete(snapshot); assertComplete(subset);
    if (snapshot.dataVersion !== universe[0].dataVersion || snapshot.scopeFingerprint !== universe[0].scopeFingerprint
      || subset.dataVersion !== snapshot.dataVersion || subset.scopeFingerprint !== snapshot.scopeFingerprint
      || JSON.stringify(snapshot.period) !== JSON.stringify(subset.period)) throw new Error('GROUP_SNAPSHOT_MISMATCH');
    const rowIds = new Set(snapshot.rows.map(row => row.id));
    const retainedRows = new Map(subset.rows.map(row => [row.id, row]));
    if (subset.rows.some(row => !rowIds.has(row.id)) || i > 0 && (rowIds.size !== memberships.size || [...rowIds].some(id => !memberships.has(id)))) throw new Error('GROUP_UNIVERSE_MISMATCH');
    for (const row of snapshot.rows) {
      const fact = row.dimensions?.[dimension], source = fact?.source;
      if (!fact || !source || source.table !== 'buildings' || source.field !== dimension || source.entityId !== row.id
        || source.recordId !== row.id || !source.id || !source.recordVersion || source.rawValue !== fact.value
        || source.period !== null || source.unit !== 'text' || source.verification !== 'database_only'
        || (fact.value !== null && (typeof fact.value !== 'string' || fact.value.length > 1000))) throw new Error('GROUP_SOURCE_REQUIRED');
      const value = fact.value === null || fact.value.trim() === '' ? null : fact.value;
      if (i === 0) {
        memberships.set(row.id, { value, source });
        const group = ensure(value); group.entityIds.push(row.id); group.sourceIds.push(source.id);
      } else if (JSON.stringify(memberships.get(row.id)) !== JSON.stringify({ value, source })) throw new Error('GROUP_MEMBERSHIP_CHANGED');
      const retained = retainedRows.get(row.id);
      if (retained && JSON.stringify(retained.dimensions?.[dimension]) !== JSON.stringify(fact)) throw new Error('GROUP_MEMBERSHIP_CHANGED');
    }
  }
  if (groups.size > 50) throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  return { dimension, membershipTime: 'current_catalog' as const,
    membershipSources: [...memberships.values()].map(item => item.source),
    groups: [...groups.values()].sort((a, b) => a.value === null ? 1 : b.value === null ? -1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  };
}

/** Reuse validated current-catalog membership without calculating unrelated
 * aggregate series when a caller needs both dimensions. */
export function groupedQuarterAnalysis(selected: readonly FactSnapshot[], universe: readonly FactSnapshot[],
  dimension: CatalogDimension, metric: Parameters<typeof quarterSeries>[1], mode: 'per_period' | 'paired') {
  const membership = catalogGroupMemberships(selected, universe, dimension);
  return { dimension, metric, mode, membershipTime: membership.membershipTime,
    membershipSources: membership.membershipSources,
    groups: membership.groups.map(group => {
      const ids = new Set(group.entityIds);
      const snapshots = selected.map(snapshot => { const rows = snapshot.rows.filter(row => ids.has(row.id)); return { ...snapshot, rows, expectedCount: rows.length }; });
      return { ...group, analysis: quarterSeries(snapshots, metric, mode) };
    }),
  };
}
