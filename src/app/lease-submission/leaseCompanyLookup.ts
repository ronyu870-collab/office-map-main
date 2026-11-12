export const LEASE_COMPANY_NAME_MAX_LENGTH = 200;
export const LEASE_COMPANY_RECENT_LIMIT = 5;

export type LeaseCompanyRelation = 'same_company' | 'related_company';

export type LeaseCompanySuggestion = { company: string; matchedFullName?: string; relation?: LeaseCompanyRelation };

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
};
