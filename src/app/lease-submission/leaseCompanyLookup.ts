export const LEASE_COMPANY_NAME_MAX_LENGTH = 200;
export const LEASE_COMPANY_RECENT_LIMIT = 5;

export type LeaseCompanyRelation = 'same_company' | 'related_company';

export type LeaseCompanySuggestion = { company: string; matchedFullName?: string; nameSimilarity?: boolean; relation?: LeaseCompanyRelation };

export type LeaseCompanyLookupResult = {
  suggestions: LeaseCompanySuggestion[];
  hasRecentDeals: boolean;
  canAssessSimilar?: boolean;
};

export type LeaseCompanyDeal = {
  read_id: string;
  record_source: 'live' | 'history';
  new_building: string | null;
  demand_type: string | null;
  area_sqm: number | null;
  effective_rent: number | null;
  transaction_date: string | null;
  transaction_year: number | null;
  transaction_quarter: string | null;
  industry?: string | null;
  sub_market?: string | null;
  building_match_scope?: string;
  quality_status?: string;
};

/** Only confirmed, dated system submissions contribute. Multiple records must
 * agree; a similar-name candidate is never a source for the current name. */
export function recommendLeaseFields(deals: LeaseCompanyDeal[]) {
  const submitted = deals.filter(row => row.record_source === 'live' &&
    row.quality_status === 'OPERATIONAL' && Boolean(row.transaction_year && row.transaction_quarter));
  const consensus = (values: (string | null | undefined)[]) => {
    const known = values.map(value => value?.trim()).filter((value): value is string => Boolean(value && !['未知', '未填', '其他', '不适用', '—'].includes(value)));
    return known.length >= 2 && new Set(known).size === 1 ? { value: known[0], records: known.length } : null;
  };
  return {
    industry: consensus(submitted.map(row => row.industry)),
    sub_market: consensus(submitted.filter(row => row.building_match_scope === 'exact').map(row => row.sub_market)),
  };
}
