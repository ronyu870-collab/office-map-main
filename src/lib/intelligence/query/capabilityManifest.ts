import type { DataAuthority } from './serverAuthority';
import { catalogDimensions, numericFields, type NumericField } from './registry';

const operationRequirements = {
  list: 'query:catalog', rank: 'query:catalog', filter: 'query:catalog',
  aggregate: 'query:quarter', trend: 'query:quarter', compare: 'query:quarter',
} as const;

/** Disclosure of CURRENT verified grants, not a promise that every authorized field has data. */
export function queryCapabilityManifest(authority: DataAuthority) {
  const grants = new Set(authority.grants);
  const fields = (Object.keys(numericFields) as NumericField[]).filter(field =>
    authority.fields.includes(field) && grants.has('query:catalog')
      && grants.has(numericFields[field].temporal === 'quarter' ? 'query:quarter' : 'query:brochure'));
  const canCatalog = grants.has('query:catalog');
  return {
    permissionRevision: authority.permissionRevision,
    policyVersion: authority.policyVersion,
    grants: [...grants],
    fields: fields.map(field => ({ id: field, label: numericFields[field].label, unit: numericFields[field].unit,
      sourceTable: numericFields[field].table, temporal: numericFields[field].temporal })),
    dimensions: canCatalog ? Object.entries(catalogDimensions).map(([id, descriptor]) => ({ id, label: descriptor.label })) : [],
    scopes: {
      allSubmarkets: canCatalog && authority.allSubmarkets,
      submarkets: canCatalog ? [...authority.submarkets] : [],
      allBuildings: canCatalog && authority.allBuildings,
      buildingIds: canCatalog ? [...authority.buildingIds] : [],
    },
    operations: Object.entries(operationRequirements).filter(([operation, grant]) =>
      grants.has(grant) && (operation !== 'rank' && operation !== 'filter' || fields.length > 0))
      .map(([operation]) => operation),
    internalExport: grants.has('export:internal'),
    coverage: 'not_verified_for_this_request' as const,
    coverageExplanation: '权限表示允许访问，不保证每栋楼、每个字段或每一季度存在正式有效数据；具体覆盖须执行获权查询后确定。',
  };
}
