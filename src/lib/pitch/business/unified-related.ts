import { loadBusinessSnapshot } from '@/src/lib/intelligence/business/research';
import type { BusinessSnapshot } from '@/src/lib/intelligence/business/protocol';
import { readSubmarketProfileRow } from '@/src/app/map/model/submarketProfile';
import type { SourceRef } from '@/src/lib/intelligence/query/contracts';
import type { QueryResult } from '@/src/lib/intelligence/query/result';
import type { PitchContext } from '../data/store';
import { evidenceHash, projectValue } from './unified-evidence';
import type { PitchResearchEntry, PitchTowerIdentity } from './unified-context-protocol';

export function publishedResearch(snapshot: BusinessSnapshot, published: QueryResult): PitchResearchEntry[] {
  const eligible = new Set(published.table.rows.map(row => row.entityId));
  return snapshot.records.filter(record => eligible.has(record.id)).flatMap(record => {
    const evidence = record.data.find(source => source.table === 'map_submarket_profiles');
    if (!evidence) throw new Error('SOURCE_BINDING_MISMATCH');
    const editorial = readSubmarketProfileRow(record.editorial, record.name);
    return (['demographics', 'policies', 'insights'] as const).flatMap(section =>
      editorial[section].map((value, index) => {
        const field = section + '[' + index + ']';
        const source: SourceRef = { id: 'business-editorial:' + evidenceHash([evidence.id, evidence.version, field]),
          entityId: record.id, recordId: evidence.id, recordVersion: evidence.version, table: evidence.table, field,
          rawValue: value, unit: 'text', period: null, recordedAt: evidence.recordedAt, businessAsOf: value.asOf,
          verification: 'database_only', original: null };
        return { section, entityId: record.id, value, source, permission: 'authorized', disclosure: 'internal' } as PitchResearchEntry;
      }));
  });
}

export async function readPitchTowerIdentities(ctx: PitchContext, ids: string[]) {
  let snapshot: BusinessSnapshot;
  try {
    snapshot = await loadBusinessSnapshot(ctx.client, ctx.identity, ctx.signal, { tool: 'query_building_towers', buildingIds: ids });
  } catch (error) {
    if (error instanceof Error && error.message === 'QUERY_DENIED') return null;
    throw error;
  }
  if (!snapshot.export) return null;
  const towers = new Map<string, PitchTowerIdentity>();
  for (const entity of snapshot.records) {
    if (!entity.buildingId || !ids.includes(entity.buildingId)) throw new Error('SOURCE_BINDING_MISMATCH');
    const source = entity.data.find(record => record.table === 'stacking_plan_towers');
    if (!source) continue;
    const buildingId = entity.buildingId;
    const value = (key: 'tower' | 'towerCode', column: 'display_name' | 'code') => {
      const rawValue = source.values[key] ?? null;
      const id = 'tower:' + evidenceHash([source.id, source.version, column]);
      const record: SourceRef = { id, table: source.table, field: column, entityId: source.id, recordId: source.id,
        recordVersion: source.version, rawValue, unit: 'text', period: null, recordedAt: source.recordedAt,
        businessAsOf: source.asOf, verification: 'database_only', original: null };
      const cell = rawValue === null ? { kind: 'unknown' as const, state: 'missing' as const, reason: 'not_recorded', sourceIds: [id] }
        : { kind: 'text' as const, value: rawValue, sourceIds: [id] };
      return projectValue(source.id, key, cell, null, null, new Map([[id, record]]));
    };
    const existing = towers.get(source.id);
    if (existing && existing.buildingId !== buildingId) throw new Error('SOURCE_BINDING_MISMATCH');
    towers.set(source.id, { towerId: source.id, buildingId, name: value('tower', 'display_name'), code: value('towerCode', 'code') });
  }
  return { towers: [...towers.values()].sort((a, b) => String(a.code.value).localeCompare(String(b.code.value))),
    permissionRevision: snapshot.permission_revision };
}
