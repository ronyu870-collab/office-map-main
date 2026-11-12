import { after, NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveLeaseReadAccess, type LeaseReadAccess } from './access';
import { readLeaseCompany } from './companyLookup';
import { asCompanyForAssessment, assessLeaseCompany, getCompanyAssessmentConfig } from './companyAi';
import { resolveEffectiveRequestIdentity, type EffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

type ReadContext = { response: NextResponse } | {
  supabaseAdmin: SupabaseClient;
  params: URLSearchParams;
  access: LeaseReadAccess;
  identity: EffectiveRequestIdentity;
  allowAssessment: boolean;
};

async function getReadContext(req: NextRequest): Promise<ReadContext> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return { response: NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 }) };
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const identityResult = await resolveEffectiveRequestIdentity(req, supabaseAdmin);
  if ('response' in identityResult) return identityResult;
  const { identity } = identityResult;
  const params = req.nextUrl.searchParams;
  const access = resolveLeaseReadAccess(identity.effectiveRole, params.get('record_source'));
  if (!access.authorized) {
    const error = access.denialReason === 'history'
      ? '当前角色无权读取历史租赁成交'
      : '当前角色无权读取租赁成交数据库';
    return { response: NextResponse.json({ error }, { status: 403 }) };
  }
  const allowAssessment = !identity.isImpersonating && (identity.effectiveRole === 'admin' || identity.effectiveRole === 'editor');
  return { supabaseAdmin, params, access, identity, allowAssessment };
}

/** Explicit opt-in from the settled company-name field. Only the derived
 * assessment cache is mutated, never any deal or other business record. */
export async function POST(req: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (req.nextUrl.searchParams.get('company_lookup') !== 'assess') {
    return NextResponse.json({ error: '无效的企业查询' }, { status: 400, headers });
  }
  const config = getCompanyAssessmentConfig();
  if (!config) return new NextResponse(null, { status: 204, headers });
  try {
    const context = await getReadContext(req);
    if ('response' in context) return context.response;
    if (!context.allowAssessment) return NextResponse.json({ error: '当前角色无权发起企业匹配' }, { status: 403, headers });
    const payload: unknown = await req.json().catch(() => null);
    const company = payload && typeof payload === 'object' && 'company' in payload && typeof payload.company === 'string'
      && payload.company.length <= 200 ? asCompanyForAssessment(payload.company) : null;
    if (!company) return NextResponse.json({ error: '无效的企业查询' }, { status: 400, headers });

    after(async () => {
      try { await assessLeaseCompany(context.supabaseAdmin, context.access.enforcedSource, company, config); }
      catch { console.warn('[lease-company-ai] deferred assessment did not complete'); }
    });
    return new NextResponse(null, { status: 202, headers });
  } catch {
    return NextResponse.json({ error: '暂时无法安排企业匹配' }, { status: 500, headers });
  }
}

export async function GET(req: NextRequest) {
  try {
    const context = await getReadContext(req);
    if ('response' in context) return context.response;
    const { supabaseAdmin, params, access, identity, allowAssessment } = context;

    if (params.has('company_lookup')) {
      return await readLeaseCompany(supabaseAdmin, access.enforcedSource, params, allowAssessment);
    }

    const buildingId = params.get('building_id')?.trim();
    const buildingScope = params.get('building_scope');
    const liveRecordId = params.get('live_record_id');
    if (buildingScope !== null && (
      (buildingScope !== 'tower' && buildingScope !== 'project') ||
      !buildingId || !UUID.test(buildingId)
    )) {
      return NextResponse.json({ error: '无效的楼宇查询范围' }, { status: 400 });
    }
    if (liveRecordId !== null && (
      !UUID.test(liveRecordId) || buildingId || access.enforcedSource === 'history'
    )) {
      return NextResponse.json({ error: '无效的成交记录查询' }, { status: 400 });
    }

    const limit = liveRecordId ? 1 : clampLimit(params.get('limit'));
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
    if (buildingId) {
      if (buildingScope === 'tower') {
        query = query.eq('building_id', buildingId).in('building_match_scope', ['exact', 'reference']);
      } else {
        query = query.contains('related_building_ids', [buildingId]);
        if (buildingScope === 'project') query = query.eq('building_match_scope', 'project');
      }
    }
    if (liveRecordId) query = query.eq('source_record_id', liveRecordId);
    if (company) query = query.ilike('company', `%${company}%`);
    if (building) query = query.ilike('new_building', `%${building}%`);
    if (subMarket) query = query.eq('sub_market', subMarket);
    if (industry) query = query.eq('industry', industry);
    if (access.enforcedSource) query = query.eq('record_source', access.enforcedSource);
    else if (liveRecordId) query = query.eq('record_source', 'live');
    if (yearFrom !== null) query = query.gte('transaction_year', yearFrom);
    if (yearTo !== null) query = query.lte('transaction_year', yearTo);
    if (areaMin !== null) query = query.gte('area_sqm', areaMin);
    if (areaMax !== null) query = query.lte('area_sqm', areaMax);

    const dateOrder = buildingScope ? { ascending: false, nullsFirst: false } : { ascending: false };
    const { data, error, count } = await query
      .order('transaction_year', dateOrder)
      .order('transaction_quarter', dateOrder)
      .order('read_id', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[lease-read] query failed', error);
      return NextResponse.json({ error: '查询租赁成交失败' }, { status: 500 });
    }

    return NextResponse.json(
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
    );
  } catch (error) {
    console.error('[lease-read] unexpected error', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
