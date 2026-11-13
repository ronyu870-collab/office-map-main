import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import {
  LEASE_COMPANY_NAME_MAX_LENGTH,
  LEASE_COMPANY_RECENT_LIMIT,
  type LeaseCompanySuggestion,
} from '@/src/app/lease-submission/leaseCompanyLookup';
import type { LeaseReadSource } from './access';
import {
  escapeLeaseCompanyRegex,
  getCompanyAssessmentConfig,
  getLeaseCompanyHints,
  shouldAssessCompany,
} from './companyAi';

const MAX_CANDIDATE_ROWS = 80;
const MAX_SUGGESTIONS = 8;
const headers = { 'Cache-Control': 'private, no-store' };

export async function readLeaseCompany(
  db: SupabaseClient,
  source: LeaseReadSource | null,
  params: URLSearchParams,
  allowAssessment = false,
) {
  const company = params.get('company')?.trim() ?? '';
  const mode = params.get('company_lookup');
  if (!company || company.length > LEASE_COMPANY_NAME_MAX_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(company) || (mode !== 'suggestions' && mode !== 'recent')) {
    return NextResponse.json({ error: '无效的企业查询' }, { status: 400, headers });
  }

  function select<Fields extends string>(fields: Fields) {
    const query = db.from('lease_transactions_read_v1').select(fields);
    return source ? query.eq('record_source', source) : query;
  }

  const fragment = escapeLeaseCompanyRegex(company);
  const exact = `^[[:space:]]*${fragment}[[:space:]]*$`;

  if (mode === 'recent') {
    const { data, error } = await select('read_id,record_source,new_building,demand_type,area_sqm,effective_rent,transaction_date,transaction_year,transaction_quarter,industry,sub_market,building_match_scope,quality_status')
      .regexIMatch('company', exact)
      .not('transaction_period_start', 'is', null)
      .order('transaction_period_start', { ascending: false, nullsFirst: false })
      .order('read_id')
      .limit(LEASE_COMPANY_RECENT_LIMIT);
    if (error) throw error;
    return NextResponse.json({ records: data ?? [] }, { headers });
  }

  const stem = company.replace(/(?:股份有限公司|有限责任公司|股份公司|有限公司|公司)$/, '').trim();
  const stemPattern = stem.length >= 3 && stem !== company ? escapeLeaseCompanyRegex(stem) : fragment;
  const [match, names, fullNames] = await Promise.all([
    select('company').regexIMatch('company', exact).not('transaction_period_start', 'is', null).limit(1),
    select('company,suspected_company_fullname').regexIMatch('company', stemPattern).order('company').limit(MAX_CANDIDATE_ROWS),
    select('company,suspected_company_fullname')
      .regexIMatch('suspected_company_fullname', fragment)
      .order('company').limit(MAX_CANDIDATE_ROWS),
  ]);
  if (match.error || names.error || fullNames.error) throw match.error ?? names.error ?? fullNames.error;

  const matches = new Map<string, LeaseCompanySuggestion>();
  const add = (value: unknown, fullName?: unknown) => {
    if (typeof value !== 'string') return;
    const name = value.trim();
    const key = name.toLowerCase();
    if (!name || name.length > LEASE_COMPANY_NAME_MAX_LENGTH) return;
    const previous = matches.get(key);
    const alias = typeof fullName === 'string' ? fullName.trim() : '';
    const option = previous ?? { company: name };
    if (name === company) option.company = name;
    if (alias && alias.toLowerCase() !== key && !option.matchedFullName) option.matchedFullName = alias;
    matches.set(key, option);
  };
  for (const row of match.data ?? []) add(row.company);
  for (const row of names.data ?? []) add(row.company, row.suspected_company_fullname);
  for (const row of fullNames.data ?? []) {
    add(row.company, row.suspected_company_fullname);
  }
  const needle = company.toLowerCase();
  function rank(suggestion: LeaseCompanySuggestion) {
    const name = suggestion.company.toLowerCase();
    return name === needle ? 0 : name.startsWith(needle) ? 1 : suggestion.matchedFullName ? 3 : 2;
  }
  const stemKey = (value: string) => value.toLowerCase().replace(/(?:股份有限公司|有限责任公司|股份公司|有限公司|公司)$/, '').trim();
  const ordinary = [...matches.values()].map(option =>
    option.company.toLowerCase() !== needle && stem.length >= 3 && stemKey(option.company) === stemKey(company)
      ? { ...option, nameSimilarity: true }
      : option)
    .sort((a, b) => rank(a) - rank(b) || a.company.localeCompare(b.company, 'zh-CN'));
  const configured = allowAssessment ? getCompanyAssessmentConfig() : null;
  const config = configured && shouldAssessCompany(company, ordinary) ? configured : null;
  const hints = config ? await getLeaseCompanyHints(db, source, company, config) : [];
  const annotations = new Map(hints.map(hint => [hint.company.toLowerCase(), hint.relation]));
  const combined = [
    ...ordinary.map(option => {
      const relation = annotations.get(option.company.toLowerCase());
      return relation ? { ...option, relation } : option;
    }),
    ...hints.filter(hint => !matches.has(hint.company.toLowerCase())),
  ];
  // Exact first, then the two calibrated relationship groups. Leave the
  // ordinary ordering untouched when no calibrated hints exist.
  const relationRank = (option: LeaseCompanySuggestion) => option.company.toLowerCase() === needle ? 0
    : option.relation === 'same_company' ? 1 : option.relation === 'related_company' ? 2 : 3;
  const suggestions = (hints.length ? combined.sort((a, b) => relationRank(a) - relationRank(b)) : combined)
    .slice(0, MAX_SUGGESTIONS);
  return NextResponse.json({
    suggestions, hasRecentDeals: Boolean(match.data?.length), ...(config ? { canAssessSimilar: true } : {}),
  }, { headers });
}
