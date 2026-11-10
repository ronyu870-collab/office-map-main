import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveLeaseReadAccess } from './access';
import { resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import { createIsolatedRequestTiming } from '@/src/lib/server/isolatedRequestTiming';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

function clampLimit(raw: string | null) {
  const value = Number(raw ?? DEFAULT_LIMIT);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

function parseOptionalNumber(raw: string | null) {
  if (raw == null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function GET(req: NextRequest) {
  const timing = createIsolatedRequestTiming(req);
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const identityResult = await timing.measure('auth', () => resolveEffectiveRequestIdentity(req, supabaseAdmin));
    if ('response' in identityResult) return identityResult.response;
    const { identity } = identityResult;

    const params = req.nextUrl.searchParams;
    const access = resolveLeaseReadAccess(identity.effectiveRole, params.get('record_source'));
    if (!access.authorized) {
      const error = access.denialReason === 'history'
        ? '当前角色无权读取历史租赁成交'
        : '当前角色无权读取租赁成交数据库';
      return NextResponse.json({ error }, { status: 403 });
    }

    const limit = clampLimit(params.get('limit'));
    const offsetRaw = Number(params.get('offset') ?? 0);
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

    // The first page still returns an exact count. A follow-up page may opt out
    // when its caller already holds that count for the same filter/role scope.
    const includeCount = params.get('include_count') !== '0';
    let query = supabaseAdmin
      .from('lease_transactions_read_v1')
      .select(
        'read_id,record_source,building_id,building_match_scope,related_building_ids,company,industry,sub_industry,demand_type,new_building,sub_market,district,area_sqm,face_rent,effective_rent,lease_term_months,transaction_year,transaction_quarter,transaction_period,transaction_time_precision,remarks,agency_company,agency_person,quality_status',
        includeCount ? { count: 'exact' } : undefined,
      );

    const buildingId = params.get('building_id')?.trim();
    const company = params.get('company')?.trim();
    const building = params.get('building')?.trim();
    const subMarket = params.get('sub_market')?.trim();
    const industry = params.get('industry')?.trim();
    const yearFrom = parseOptionalNumber(params.get('year_from'));
    const yearTo = parseOptionalNumber(params.get('year_to'));
    const areaMin = parseOptionalNumber(params.get('area_min'));
    const areaMax = parseOptionalNumber(params.get('area_max'));

    // related_building_ids contains the exact building for exact matches and every
    // current project member for project-level matches. Filtering on the array lets
    // Map surface governed project-level history without pretending it belongs to a
    // specific tower.
    if (buildingId) query = query.contains('related_building_ids', [buildingId]);
    if (company) query = query.ilike('company', `%${company}%`);
    if (building) query = query.ilike('new_building', `%${building}%`);
    if (subMarket) query = query.eq('sub_market', subMarket);
    if (industry) query = query.eq('industry', industry);
    if (access.enforcedSource) query = query.eq('record_source', access.enforcedSource);
    if (yearFrom !== null) query = query.gte('transaction_year', yearFrom);
    if (yearTo !== null) query = query.lte('transaction_year', yearTo);
    if (areaMin !== null) query = query.gte('area_sqm', areaMin);
    if (areaMax !== null) query = query.lte('area_sqm', areaMax);

    const { data, error, count } = await timing.measure('database', () => query
      .order('transaction_year', { ascending: false })
      .order('transaction_quarter', { ascending: false })
      .order('read_id', { ascending: true })
      .range(offset, offset + limit - 1));

    if (error) {
      console.error('[lease-read] query failed', error);
      return NextResponse.json({ error: '查询租赁成交失败' }, { status: 500 });
    }

    return timing.response(() => NextResponse.json(
      {
        records: data ?? [],
        count: includeCount ? count ?? 0 : null,
        limit,
        offset,
        access: {
          canReadHistory: access.canReadHistory,
          effectiveSource: access.enforcedSource ?? 'all',
          effectiveRole: identity.effectiveRole,
          impersonating: identity.isImpersonating,
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    ));
  } catch (error) {
    console.error('[lease-read] unexpected error', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
