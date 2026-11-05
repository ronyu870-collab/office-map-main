import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import { parseUserRole, type UserRole } from '@/src/types/auth';
import { resolveBuildingId } from '@/src/services/buildingIdentity';
import { isPendingFutureSupply } from '@/src/lib/future-supply-status';
import { readBuildingPhotoCatalog } from '@/src/lib/building-photos/catalog';

export const dynamic = 'force-dynamic';

const MAP_BUILDING_SELECT = `
  id,
  name,
  former_names,
  submarket,
  grade,
  city,
  district,
  location_lng,
  location_lat,
  completion_year,
  leed_certification,
  owner,
  property_management,
  contact_phone,
  building_metrics (
    id,
    building_id,
    total_area,
    asking_rent,
    management_fee,
    face_rent,
    rent_free_period,
    net_effective_rent,
    vacancy_rate,
    vacant_area,
    record_year,
    record_quarter
  )
`;

const COMPARE_BUILDING_SELECT = `
  id,
  name,
  grade,
  submarket,
  district,
  building_metrics (
    building_id,
    record_year,
    record_quarter,
    created_at,
    total_area,
    asking_rent,
    management_fee,
    face_rent,
    rent_free_period,
    net_effective_rent,
    vacancy_rate,
    vacant_area
  )
`;

type Row = Record<string, any>;

function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function rowVisibleForRole(_row: Row, role: UserRole): boolean {
  // All canonical application roles share the same read scope. The caller has
  // already been normalized through parseUserRole, so unknown roles fail closed.
  return role === 'viewer' || role === 'editor' || role === 'admin';
}

function filterRowsForRole(rows: Row[] | null | undefined, role: UserRole): Row[] {
  return (rows ?? []).filter(row => rowVisibleForRole(row, role));
}

async function loadTrackedBuildings(
  admin: SupabaseClient,
  selectClause: string,
  latestMetricsOnly: boolean,
) {
  let query = admin
    .from('buildings')
    .select(selectClause)
    .eq('is_active', true)
    .eq('tracking_scope', 'tracked')
    .or('project_type.neq.future,project_type.is.null');

  if (latestMetricsOnly) {
    query = query
      .order('record_year', { referencedTable: 'building_metrics', ascending: false })
      .order('record_quarter', { referencedTable: 'building_metrics', ascending: false })
      .limit(1, { referencedTable: 'building_metrics' });
  }

  return query;
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const admin = createAdminClient();
    if (!admin) return noStoreJson({ error: 'Server misconfiguration' }, { status: 500 });

    const identityResult = await resolveEffectiveRequestIdentity(request, admin);
    if ('response' in identityResult) return identityResult.response;

    const role = parseUserRole(identityResult.identity.effectiveRole);
    if (!role) return noStoreJson({ error: '当前账号角色无效' }, { status: 403 });

    const params = request.nextUrl.searchParams;
    const mode = params.get('mode') || 'map';

    if (mode === 'map') {
      const latestMetricsOnly = params.get('metrics') !== 'all';
      const [buildingsResult, overridesResult, photos] = await Promise.all([
        loadTrackedBuildings(admin, MAP_BUILDING_SELECT, latestMetricsOnly),
        admin
          .from('building_display_overrides')
          .select('building_id, field_name, display_label, display_value'),
        readBuildingPhotoCatalog(admin),
      ]);

      if (buildingsResult.error) {
        console.error('[api/map/data] buildings query failed:', buildingsResult.error);
        return noStoreJson({ error: '楼宇数据读取失败' }, { status: 500 });
      }
      if (overridesResult.error) {
        console.error('[api/map/data] display overrides query failed:', overridesResult.error);
        return noStoreJson({ error: '楼宇显示规则读取失败' }, { status: 500 });
      }

      const buildings = filterRowsForRole(buildingsResult.data as Row[] | null, role)
        .map<Row>(row => ({ ...row, photos: photos.get(String(row.id)) ?? [] }));
      const allowedIds = new Set(buildings.map(row => String(row.id)));
      const displayOverrides = (overridesResult.data ?? [])
        .filter(row => allowedIds.has(String(row.building_id)));

      return noStoreJson({ buildings, display_overrides: displayOverrides });
    }

    if (mode === 'future') {
      const [{ data, error }, photos] = await Promise.all([
        admin.from('future_supplies').select('*').limit(1000),
        readBuildingPhotoCatalog(admin),
      ]);
      if (error) {
        console.error('[api/map/data] future supplies query failed:', error);
        return noStoreJson({ error: '未来供应读取失败' }, { status: 500 });
      }
      const authorized = filterRowsForRole(data as Row[] | null, role);
      // Older open maps classify every unknown grade as office in the calendar.
      const visibleSupplies = params.get('include_pending') === '1'
        ? authorized
        : authorized.filter(supply => !isPendingFutureSupply(supply));
      return noStoreJson({ future_supplies: visibleSupplies
        .map(row => ({ ...row, photos: photos.get(String(row.building_id)) ?? [] })) });
    }

    if (mode === 'compare') {
      const [buildingsResult, brochureResult] = await Promise.all([
        loadTrackedBuildings(admin, COMPARE_BUILDING_SELECT, true),
        admin
          .from('building_brochure_data')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(3000),
      ]);

      if (buildingsResult.error) {
        console.error('[api/map/data] compare buildings query failed:', buildingsResult.error);
        return noStoreJson({ error: '楼宇对比数据读取失败' }, { status: 500 });
      }
      if (brochureResult.error) {
        console.error('[api/map/data] compare brochure query failed:', brochureResult.error);
        return noStoreJson({ error: '楼书参数读取失败' }, { status: 500 });
      }

      const buildings = filterRowsForRole(buildingsResult.data as Row[] | null, role);
      const allowedIds = new Set(buildings.map(row => String(row.id)));
      const brochures = (brochureResult.data ?? [])
        .filter(row => allowedIds.has(String(row.building_id)));

      return noStoreJson({ buildings, brochures });
    }

    if (mode === 'trend') {
      const requestedId = params.get('building_id')?.trim() || '';
      if (!requestedId) return noStoreJson({ error: '缺少 building_id' }, { status: 400 });
      const buildingId = await resolveBuildingId(admin, requestedId);

      const { data: building, error: buildingError } = await admin
        .from('buildings')
        .select('id, grade, is_active, tracking_scope, project_type')
        .eq('id', buildingId)
        .eq('is_active', true)
        .eq('tracking_scope', 'tracked')
        .or('project_type.neq.future,project_type.is.null')
        .maybeSingle();

      if (buildingError) {
        console.error('[api/map/data] trend building scope query failed:', buildingError);
        return noStoreJson({ error: '楼宇权限校验失败' }, { status: 500 });
      }
      if (!building || !rowVisibleForRole(building as Row, role)) {
        return noStoreJson({ error: '楼宇不存在或无权查看' }, { status: 404 });
      }

      const { data: metrics, error: metricError } = await admin
        .from('building_metrics')
        .select('record_year, record_quarter, net_effective_rent, vacancy_rate')
        .eq('building_id', buildingId)
        .order('record_year', { ascending: false })
        .order('record_quarter', { ascending: false });

      if (metricError) {
        console.error('[api/map/data] trend metrics query failed:', metricError);
        return noStoreJson({ error: '历史趋势读取失败' }, { status: 500 });
      }

      return noStoreJson({ building_id: buildingId, metrics: metrics ?? [] });
    }

    return noStoreJson({ error: 'Unsupported map data mode' }, { status: 400 });
  } catch (error) {
    console.error('[api/map/data] unexpected error:', error);
    return noStoreJson({ error: '服务器内部错误' }, { status: 500 });
  }
}
