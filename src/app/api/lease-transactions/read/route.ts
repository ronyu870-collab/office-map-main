import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

function clampLimit(raw: string | null) {
  const value = Number(raw ?? DEFAULT_LIMIT);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

export async function GET(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = (req.headers.get('authorization') ?? '')
      .replace(/^Bearer\s+/i, '')
      .trim();
    if (!token) {
      return NextResponse.json({ error: '未提供认证 Token' }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: '登录状态无效，请重新登录' }, { status: 401 });
    }

    const { data: roleRow, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    if (roleError) {
      return NextResponse.json({ error: '权限校验失败' }, { status: 500 });
    }

    const role = String(roleRow?.role ?? '').trim().toLowerCase();
    if (role !== 'editor' && role !== 'admin') {
      return NextResponse.json({ error: '当前角色无权读取租赁成交数据库' }, { status: 403 });
    }

    const params = req.nextUrl.searchParams;
    const limit = clampLimit(params.get('limit'));
    const offsetRaw = Number(params.get('offset') ?? 0);
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

    let query = supabaseAdmin
      .from('lease_transactions_read_v1')
      .select(
        'read_id,record_source,building_id,company,industry,sub_industry,demand_type,new_building,sub_market,district,area_sqm,face_rent,effective_rent,lease_term_months,transaction_year,transaction_quarter,transaction_period,transaction_time_precision,remarks,agency_company,agency_person,quality_status',
        { count: 'exact' },
      );

    const buildingId = params.get('building_id')?.trim();
    const company = params.get('company')?.trim();
    const building = params.get('building')?.trim();
    const subMarket = params.get('sub_market')?.trim();
    const industry = params.get('industry')?.trim();
    const source = params.get('record_source')?.trim();
    const yearFrom = Number(params.get('year_from'));
    const yearTo = Number(params.get('year_to'));
    const areaMin = Number(params.get('area_min'));
    const areaMax = Number(params.get('area_max'));

    if (buildingId) query = query.eq('building_id', buildingId);
    if (company) query = query.ilike('company', `%${company}%`);
    if (building) query = query.ilike('new_building', `%${building}%`);
    if (subMarket) query = query.eq('sub_market', subMarket);
    if (industry) query = query.eq('industry', industry);
    if (source === 'live' || source === 'history') query = query.eq('record_source', source);
    if (Number.isFinite(yearFrom)) query = query.gte('transaction_year', yearFrom);
    if (Number.isFinite(yearTo)) query = query.lte('transaction_year', yearTo);
    if (Number.isFinite(areaMin)) query = query.gte('area_sqm', areaMin);
    if (Number.isFinite(areaMax)) query = query.lte('area_sqm', areaMax);

    const { data, error, count } = await query
      .order('transaction_year', { ascending: false })
      .order('transaction_quarter', { ascending: false })
      .order('read_id', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[lease-read] query failed', error);
      return NextResponse.json({ error: '查询租赁成交失败' }, { status: 500 });
    }

    return NextResponse.json(
      { records: data ?? [], count: count ?? 0, limit, offset },
      { headers: { 'Cache-Control': 'private, max-age=30' } },
    );
  } catch (error) {
    console.error('[lease-read] unexpected error', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
