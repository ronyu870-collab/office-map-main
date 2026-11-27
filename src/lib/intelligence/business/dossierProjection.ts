import type { SourceRef } from '../query/contracts';
import type { QueryResult, ResultCell } from '../query/result';
import { businessBindingSchema, isBusinessResult } from './protocol';

const isGfaSource = (source: SourceRef) => source.table === 'building_brochure_data' && source.field === 'gfa_total'
  && /^business:[a-f0-9]{64}$/.test(source.id);

/** Carry the physical building-book field into the already ordered formal rows.
 * Names, ranks, observation periods and quarterly sources remain authoritative. */
export function addDossierGfa(result: QueryResult, dossier: QueryResult): { result: QueryResult; missing: number } | undefined {
  if (!isBusinessResult(dossier) || dossier.parameters.businessTool !== 'query_building_dossier'
    || !dossier.table.columns.some(column => column.key === 'gfaTotal')) return undefined;
  const bindings = businessBindingSchema.array().length(1).parse(dossier.parameters.businessBindings);
  const binding = bindings[0];
  if (binding.plan.tool !== 'query_building_dossier' || !binding.plan.fields.includes('gfaTotal')) return undefined;
  const allowed = new Set(binding.plan.buildingIds);
  if (result.table.rows.some(row => !allowed.has(row.entityId))) return undefined;
  const byBuilding = new Map(dossier.table.rows.map(row => [row.entityId, row.cells.gfaTotal]));
  const references = new Map(dossier.sources.filter(isGfaSource).map(source => [source.id, source]));
  const used = new Map<string, SourceRef>();
  let missing = 0;
  const rows = result.table.rows.map(row => {
    const sourceCell = byBuilding.get(row.entityId);
    if (sourceCell?.sourceIds.some(id => references.get(id)?.entityId !== row.entityId)) throw new Error('SOURCE_BINDING_MISMATCH');
    const cell: ResultCell = sourceCell && (sourceCell.kind === 'unknown' || sourceCell.kind === 'number' && sourceCell.sourceIds.length)
      ? sourceCell : { kind: 'unknown', state: 'missing', reason: 'business_field_missing', sourceIds: [] };
    if (cell.kind !== 'number') missing++;
    for (const id of cell.sourceIds) used.set(id, references.get(id)!);
    return { ...row, cells: { ...row.cells, gfaTotal: cell } };
  });
  return { missing, result: { ...result, parameters: { ...result.parameters, businessBindings: bindings },
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
