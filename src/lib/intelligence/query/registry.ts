import { FORMAL_QUARTER_SAMPLE_POLICY } from '../../marketSamplePolicy';

export const FIELD_REGISTRY_VERSION = 'trusted-query-fields/1';
export const DIMENSION_REGISTRY_VERSION = 'current-catalog-dimensions/1';
export const catalogDimensions = {
  submarket: { label: '子市场', table: 'buildings', column: 'submarket', temporal: 'current_catalog' },
  grade: { label: '等级', table: 'buildings', column: 'grade', temporal: 'current_catalog' },
} as const;
export type CatalogDimension = keyof typeof catalogDimensions;

/** Only reviewed numeric semantics enter this registry. Existence of a SQL column is insufficient. */
export const numericFields = {
  height: { label: '建筑高度', table: 'building_brochure_data', column: 'building_height', unit: 'm', temporal: 'source', positive: true, integer: false },
  floors: { label: '楼层数（来源口径）', table: 'building_brochure_data', column: 'building_floors', unit: 'floor', temporal: 'source', positive: true, integer: true },
  parking: { label: '总车位数', table: 'building_brochure_data', column: 'parking_total', unit: 'space', temporal: 'source', positive: false, integer: true },
  totalArea: { label: '季度总面积', table: 'building_metrics', column: 'total_area', unit: 'm2', temporal: 'quarter', positive: FORMAL_QUARTER_SAMPLE_POLICY.positiveArea, integer: false },
  vacantArea: { label: '季度空置面积', table: 'building_metrics', column: 'vacant_area', unit: 'm2', temporal: 'quarter', positive: false, integer: false },
  netEffectiveRent: { label: '净有效租金', table: 'building_metrics', column: 'net_effective_rent', unit: 'CNY/m2/month', temporal: 'quarter', positive: FORMAL_QUARTER_SAMPLE_POLICY.positiveRent, integer: false },
} as const;

export type NumericField = keyof typeof numericFields;
export const FORMULAS = {
  rent: 'area-weighted-positive-net-effective-rent/1',
  vacancy: 'sum-valid-vacant-area-over-same-record-total-area/1',
  totalArea: 'sum-positive-quarter-total-area/1',
} as const;

// Mirrors calculateWeightedAverageRent's rent > 0 rule. A recorded zero remains
// visible as a raw value, but is not automatically a validated market rent.
// Same-quarter map research shares this formal policy; current-state map estimates retain their own explicit projection. No additional data access is granted.
