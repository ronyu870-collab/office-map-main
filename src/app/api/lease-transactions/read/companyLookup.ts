import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import {
  LEASE_COMPANY_NAME_MAX_LENGTH,
  LEASE_COMPANY_RECENT_LIMIT,
  type LeaseCompanySuggestion,
} from '@/src/app/lease-submission/leaseCompanyLookup';
import type { LeaseReadSource } from './access';

const MAX_CANDIDATE_ROWS = 80;
const MAX_SUGGESTIONS = 8;
const headers = { 'Cache-Control': 'private, no-store' };

function literalRegex(value: string) {
  // PostgREST imatch sends the pattern to PostgreSQL. Escape every regex
  // metacharacter; user input is always literal, including % and _.
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function readLeaseCompany(
  db: SupabaseClient,
  source: LeaseReadSource | null,
  params: URLSearchParams,
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

  const fragment = literalRegex(company);
  const exact = `^[[:space:]]*${fragment}[[:space:]]*$`;

  if (mode === 'recent') {
    const { data, error } = await select('read_id,record_source,new_building,demand_type,area_sqm,effective_rent,transaction_date,transaction_year,transaction_quarter')
      .regexIMatch('company', exact)
      .not('transaction_period_start', 'is', null)
      .order('transaction_period_start', { ascending: false, nullsFirst: false })
      .order('read_id')
      .limit(LEASE_COMPANY_RECENT_LIMIT);
    if (error) throw error;
    return NextResponse.json({ records: data ?? [] }, { headers });
  }

  const [match, names, fullNames] = await Promise.all([
    select('company').regexIMatch('company', exact).not('transaction_period_start', 'is', null).limit(1),
    select('company').regexIMatch('company', fragment).order('company').limit(MAX_CANDIDATE_ROWS),
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
    if (previous && !(name === company && previous.company !== company)) return;
    const alias = typeof fullName === 'string' ? fullName.trim() : '';
    matches.set(key, alias && alias.toLowerCase() !== key
      ? { company: name, matchedFullName: alias }
      : { company: name });
  };
  for (const row of match.data ?? []) add(row.company);
  for (const row of names.data ?? []) add(row.company);
  for (const row of fullNames.data ?? []) {
    add(row.company, row.suspected_company_fullname);
  }
  const needle = company.toLowerCase();
  function rank(suggestion: LeaseCompanySuggestion) {
    const name = suggestion.company.toLowerCase();
    return name === needle ? 0 : name.startsWith(needle) ? 1 : suggestion.matchedFullName ? 3 : 2;
  }
  const suggestions = [...matches.values()]
    .sort((a, b) => rank(a) - rank(b) || a.company.localeCompare(b.company, 'zh-CN'))
    .slice(0, MAX_SUGGESTIONS);
  return NextResponse.json({ suggestions, hasRecentDeals: Boolean(match.data?.length) }, { headers });
}
