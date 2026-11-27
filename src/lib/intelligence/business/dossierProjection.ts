import type { SupabaseClient } from '@supabase/supabase-js';
import { ZodError } from 'zod';
import type { SourceRef } from '../query/contracts';
import type { QueryResult, ResultCell } from '../query/result';
import type { VerifiedQueryIdentity } from '../query/serverAuthority';
import { businessBindingSchema, isBusinessResult } from './protocol';
import { businessCapabilities, queryBusinessResearch } from './research';

const isGfaSource = (source: SourceRef) => source.table === 'building_brochure_data' && source.field === 'gfa_total'
  && /^business:[a-f0-9]{64}$/.test(source.id);

type DossierGfaRead = { ids: string[]; dossier: QueryResult }
  | { ids: string[]; issue: 'denied' | 'unavailable' };

export async function readDossierGfa(client: SupabaseClient, identity: VerifiedQueryIdentity, signal: AbortSignal, ids: string[]): Promise<DossierGfaRead[]> {
  const read = async (buildingIds: string[]): Promise<DossierGfaRead> => {
    try {
      const { result: dossier } = await queryBusinessResearch(client, identity, signal, 'query_building_dossier', { buildingIds, fields: ['gfaTotal'] });
      return { ids: buildingIds, dossier };
    } catch (error) {
      if (signal.aborted || error instanceof Error && ['QUERY_READ_UNAVAILABLE', 'BUSINESS_SCOPE_TOO_LARGE'].includes(error.message))
        return { ids: buildingIds, issue: 'unavailable' };
      if (error instanceof Error && error.message === 'QUERY_DENIED') return { ids: buildingIds, issue: 'denied' };
      throw error;
    }
  };
  const batch = await read(ids);
  if (!('issue' in batch) || batch.issue !== 'denied' || ids.length === 1) return [batch];
  // The governed dossier RPC refuses an entire mixed-scope batch. Query only
  // the already matched IDs and keep the independent result of each permission check.
  const access = await businessCapabilities(client, identity, signal).catch(error => {
    if (signal.aborted || error instanceof ZodError) return null;
    throw error;
  });
  if (!access || 'reason' in access && access.reason === 'source_unavailable') return [{ ids, issue: 'unavailable' }];
  if (!('profileFields' in access) || !access.modules.includes('profile') || !access.profileFields.includes('gfaTotal')) return [batch];
  const outcomes: DossierGfaRead[] = [];
  for (let start = 0; start < ids.length; start += 4)
    outcomes.push(...await Promise.all(ids.slice(start, start + 4).map(id => read([id]))));
  return outcomes;
}

/** Carry independently verified dossier cells into the already ordered formal rows. */
export function addDossierGfa(result: QueryResult, reads: DossierGfaRead[]) {
  const dossiers = reads.flatMap(read => 'dossier' in read ? [read.dossier] : []);
  const resultIds = new Set(result.table.rows.map(row => row.entityId));
  const bindings = reads.flatMap(read => {
    if (read.ids.some(id => !resultIds.has(id))) throw new Error('SOURCE_BINDING_MISMATCH');
    if ('issue' in read) return [];
    const { dossier } = read;
    if (!isBusinessResult(dossier) || dossier.parameters.businessTool !== 'query_building_dossier'
      || !dossier.table.columns.some(column => column.key === 'gfaTotal')) throw new Error('SOURCE_BINDING_MISMATCH');
    const [binding] = businessBindingSchema.array().length(1).parse(dossier.parameters.businessBindings);
    const { plan } = binding;
    if (plan.tool !== 'query_building_dossier' || !plan.fields.includes('gfaTotal')
      || plan.buildingIds.length !== read.ids.length || plan.buildingIds.some(id => !read.ids.includes(id))
      || dossier.table.rows.some(row => !read.ids.includes(row.entityId))) throw new Error('SOURCE_BINDING_MISMATCH');
    return [binding];
  });
  const byBuilding = new Map(dossiers.flatMap(dossier => dossier.table.rows.map(row => [row.entityId, row.cells.gfaTotal] as const)));
  const references = new Map(dossiers.flatMap(dossier => dossier.sources.filter(isGfaSource).map(source => [source.id, source] as const)));
  const issues = new Map(reads.flatMap(read => 'issue' in read ? read.ids.map(id => [id, read.issue] as const) : []));
  const used = new Map<string, SourceRef>();
  let missing = 0, denied = 0, unavailable = 0;
  const rows = result.table.rows.map(row => {
    const issue = issues.get(row.entityId);
    const sourceCell = byBuilding.get(row.entityId);
    if (sourceCell?.sourceIds.some(id => references.get(id)?.entityId !== row.entityId)) throw new Error('SOURCE_BINDING_MISMATCH');
    const cell: ResultCell = issue ? { kind: 'unknown', state: 'unverified',
      reason: issue === 'denied' ? 'business_field_not_authorized' : 'business_field_unavailable', sourceIds: [] }
      : sourceCell && (sourceCell.kind === 'unknown' || sourceCell.kind === 'number' && sourceCell.sourceIds.length)
        ? sourceCell : { kind: 'unknown', state: 'missing', reason: 'business_field_missing', sourceIds: [] };
    if (issue === 'denied') denied++;
    else if (issue === 'unavailable') unavailable++;
    else if (cell.kind !== 'number') missing++;
    for (const id of cell.sourceIds) used.set(id, references.get(id)!);
    return { ...row, cells: { ...row.cells, gfaTotal: cell } };
  });
  return { missing, denied, unavailable, dossiers, result: { ...result,
    parameters: { ...result.parameters, ...(bindings.length ? { businessBindings: bindings } : {}) },
    table: { ...result.table, columns: [...result.table.columns, { key: 'gfaTotal', label: '建筑面积（楼书）', unit: 'm2' }], rows },
    sources: [...result.sources, ...used.values()] } };
}

/** An appended GFA source is authorized by the independent, digest-bound
 * dossier RPC. Every other source still goes through the original query ACL. */
export function sourcesForFormalAcl(sources: readonly SourceRef[], parameters: Readonly<Record<string, unknown>>) {
  if (!parameters.businessBindings) return sources;
  const bindings = businessBindingSchema.array().min(1).max(64).parse(parameters.businessBindings);
  const buildings = new Set(bindings.flatMap(({ plan }) => plan.tool === 'query_building_dossier' && plan.fields.includes('gfaTotal') ? plan.buildingIds : []));
  return sources.filter(source => !isGfaSource(source) || !buildings.has(source.entityId));
}
