/**
 * Opt-in read plans for audited base tables only. Do not infer a projection for
 * dynamic admin schemas or a view: their hidden fields are not guaranteed.
 * Every column used by the corresponding TableConfig, optimistic update and
 * XLSX export has been checked against the production PostgreSQL 17 schema.
 */
export const GRID_READ_PLANS = {
  building_metrics: {
    columns: 'id,building_id,record_year,record_quarter,total_area,is_locked,updated_at,asking_rent,management_fee,face_rent,rent_free_period,net_effective_rent,rent_qoq_change,rent_yoy_change,vacant_area,vacant_area_qoq_change,vacancy_rate',
    tieBreaker: 'id',
  },
  building_current_data: {
    columns: 'building_id,updated_at,leasable_area,asking_rent,management_fee,face_rent,rent_free_period,net_effective_rent,vacant_area,vacancy_rate,data_source,source_detail,updated_by',
    tieBreaker: 'building_id',
  },
  lease_transactions: {
    columns: 'id,company,suspected_company_fullname,enterprise_type,industry,sub_industry,demand_type,new_building,sub_market,district,building_grade,floor_info,floor,old_address,old_sub_market,old_building_grade,area_sqm,face_rent,is_face_rent_estimated,effective_rent,is_effective_rent_estimated,lease_term_months,fit_out_months,rent_free_months,relocation_area_change,transaction_date,transaction_year,transaction_quarter,remarks,data_source,submitter_id,submitter_name,created_at,updated_at',
    tieBreaker: 'id',
  },
} as const;

export function getGridReadPlan(tableName: string) {
  return Object.prototype.hasOwnProperty.call(GRID_READ_PLANS, tableName)
    ? GRID_READ_PLANS[tableName as keyof typeof GRID_READ_PLANS]
    : null;
}
