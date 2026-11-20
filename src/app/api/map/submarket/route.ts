import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { denyImpersonatedMutation, resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import { MAP_SUBMARKETS, MAP_SUBMARKETS_SECONDARY, normalizeMapSubmarket } from '@/src/app/map/model/mapDomain';
import { computeSubmarketTrends, type TrendMetricRow } from '@/src/app/map/model/submarketMarketTrend';
import { officeGrade } from '@/src/app/map/model/submarketOverview';
import { readSubmarketProfileRow, submarketProfileSchema } from '@/src/app/map/model/submarketProfile';
import { publicBriefReviewErrors, visibleSubmarketProfile } from '@/src/app/map/model/submarketPublication';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const allowedSubmarkets = new Set([...MAP_SUBMARKETS, ...MAP_SUBMARKETS_SECONDARY].filter(name => name !== '其他'));
const PAGE_SIZE = 1000;
const MAX_TREND_ROWS = 12000;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
}

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
}

function validateName(request: NextRequest): string | null {
  const name = normalizeMapSubmarket(request.nextUrl.searchParams.get('submarket'));
  return allowedSubmarkets.has(name) ? name : null;
}

function databaseNames(name: string) {
  if (name === '望京-酒仙桥') return [name, '望京酒仙桥', '望京—酒仙桥'];
  if (name === '亦庄') return [name, '亦庄经济开发区', '北京经济技术开发区'];
  return [name];
}

function missingProfileTable(error: { code?: string; message?: string } | null) {
  return error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST116'
    && /schema cache|relation|table/i.test(error?.message ?? '');
}

async function readProfile(client: SupabaseClient, name: string) {
  const { data, error } = await client.from('map_submarket_profiles')
    .select('submarket,headline,overview,industries,transport,demographics,policies,insights,updated_at,updated_by,is_published,published_at,published_by')
    .eq('submarket', name).maybeSingle();
  if (error) {
    if (missingProfileTable(error)) return { available: false, published: false, profile: readSubmarketProfileRow(null, name) };
    throw new Error('PROFILE_READ_FAILED');
  }
  return { available: true, published: data?.is_published === true, profile: readSubmarketProfileRow(data, name) };
}

async function readTrend(client: SupabaseClient, name: string, signal: AbortSignal) {
  const { data: stock, error } = await client.from('buildings')
    .select('id,grade')
    .eq('is_active', true)
    .eq('tracking_scope', 'tracked')
    .or('project_type.neq.future,project_type.is.null')
    .in('submarket', databaseNames(name))
    .abortSignal(signal);
  if (error) throw new Error('SUBMARKET_BUILDINGS_UNAVAILABLE');

  const offices = (stock ?? []).filter(building => ['a', 'b'].includes(officeGrade(building.grade)));
  const ids = [...new Set(offices.map(building => String(building.id)))];
  const rows: TrendMetricRow[] = [];
  const currentYear = new Date().getUTCFullYear();

  for (let start = 0; start < ids.length; start += 80) {
    const group = ids.slice(start, start + 80);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const result = await client.from('building_metrics')
        .select('building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,vacancy_rate,is_draft,is_locked,updated_at')
        .in('building_id', group)
        .gte('record_year', currentYear - 4)
        .order('record_year', { ascending: false })
        .order('record_quarter', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1)
        .abortSignal(signal);
      if (result.error) throw new Error('SUBMARKET_METRICS_UNAVAILABLE');
      rows.push(...(result.data ?? []));
      // Never publish a deceptively complete curve if the fetch was truncated.
      if (rows.length > MAX_TREND_ROWS) throw new Error('SUBMARKET_TREND_TOO_LARGE');
      if ((result.data?.length ?? 0) < PAGE_SIZE) break;
    }
  }

  return {
    trends: computeSubmarketTrends(offices, rows, 8),
    quarterMethod: 'same_quarter_area_weighted',
    source: 'building_metrics',
    stockCount: ids.length,
  };
}

export async function GET(request: NextRequest) {
  const name = validateName(request);
  if (!name) return json({ error: '不支持的子市场' }, 400);
  const client = adminClient();
  if (!client) return json({ error: '服务器数据连接未配置' }, 500);

  try {
    const result = await resolveEffectiveRequestIdentity(request, client);
    if ('response' in result) return result.response;
    if (!['viewer', 'editor', 'admin'].includes(result.identity.effectiveRole)) return json({ error: '无权读取子市场' }, 403);

    // Text and time-series are independent: a failure in one must not
    // suppress the usable, already-authorized part of the client brief.
    const [profileRead, trendRead] = await Promise.allSettled([
      readProfile(client, name),
      readTrend(client, name, request.signal),
    ]);
    if (profileRead.status === 'rejected' && trendRead.status === 'rejected') {
      throw new Error('SUBMARKET_READ_UNAVAILABLE');
    }
    const profile = profileRead.status === 'fulfilled'
      ? profileRead.value
      : { available: false, published: false, profile: readSubmarketProfileRow(null, name) };
    const visibleToClients = profile.published && publicBriefReviewErrors(profile.profile).length === 0;
    const canEdit = result.identity.callerRole === 'admin' && result.identity.effectiveRole === 'admin'
      && !result.identity.isImpersonating;
    const trend = trendRead.status === 'fulfilled' ? trendRead.value
      : { trends: { all: [], a: [], b: [] }, stockCount: 0,
          quarterMethod: 'same_quarter_area_weighted', source: 'building_metrics' };
    return json({
      submarket: name, ...trend, trendError: trendRead.status === 'rejected',
      profile: visibleSubmarketProfile(profile.profile, visibleToClients),
      profileAvailable: profile.available,
      profilePublished: visibleToClients,
      ...(canEdit ? { draftProfile: profile.profile } : {}),
    });
  } catch (error) {
    console.error('[api/map/submarket] read failed', error);
    const tooLarge = error instanceof Error && error.message === 'SUBMARKET_TREND_TOO_LARGE';
    return json({ error: tooLarge ? '历史季度数据超出安全读取上限，请联系管理员' : '子市场资料或季度数据读取失败，请重试' }, tooLarge ? 422 : 500);
  }
}

export async function PUT(request: NextRequest) {
  const name = validateName(request);
  if (!name) return json({ error: '不支持的子市场' }, 400);
  const client = adminClient();
  if (!client) return json({ error: '服务器数据连接未配置' }, 500);

  try {
    const resolved = await resolveEffectiveRequestIdentity(request, client);
    if ('response' in resolved) return resolved.response;
    const identity = resolved.identity;
    if (identity.callerRole !== 'admin' || identity.effectiveRole !== 'admin') {
      return json({ error: '仅管理员可以维护子市场资料' }, 403);
    }
    const denied = denyImpersonatedMutation(identity);
    if (denied) return denied;
    const size = Number(request.headers.get('content-length') ?? 0);
    if (size > 80_000) return json({ error: '提交内容过大' }, 413);
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ error: '资料格式不正确' }, 400);
    }
    const { publicationIntent, ...profileInput } = body as Record<string, unknown>;
    if (publicationIntent !== undefined && publicationIntent !== 'draft' && publicationIntent !== 'publish') {
      return json({ error: '发布操作不受支持' }, 400);
    }
    const parsed = submarketProfileSchema.safeParse(profileInput);
    if (!parsed.success) return json({ error: '资料字段格式不正确，请检查来源链接与字段长度' }, 400);
    const publish = publicationIntent === 'publish';
    if (publish) {
      const problems = publicBriefReviewErrors(parsed.data);
      if (problems.length) return json({ error: '内容无法直接展示，请修改不完整字段和内部标记：' + problems.join('；') }, 422);
    }

    const before = await readProfile(client, name);
    if (!before.available) return json({ error: '子市场资料表尚未部署，请先应用对应数据库迁移' }, 503);
    const updatedAt = new Date().toISOString();
    const { data, error } = await client.from('map_submarket_profiles').upsert({
      submarket: name, ...parsed.data, updated_by: identity.caller.id, updated_at: updatedAt,
      is_published: publish, published_at: publish ? updatedAt : null,
      published_by: publish ? identity.caller.id : null,
    }, { onConflict: 'submarket' }).select('*').single();
    if (error) throw new Error('PROFILE_SAVE_FAILED');

    const audit = await client.from('audit_logs').insert({
      user_id: identity.caller.email || identity.caller.id,
      action_type: 'ADMIN_DATA_OPERATION',
      target_table: 'map_submarket_profiles',
      target_id: name,
      target_name: name,
      module: 'map',
      details: { operation: publish ? 'publish_submarket_profile' : 'save_submarket_draft', submarket: name, updated_at: updatedAt },
      old_values: { ...before.profile, is_published: before.published },
      new_values: { ...readSubmarketProfileRow(data, name), is_published: publish },
    });
    if (audit.error) {
      console.error('[api/map/submarket] audit write failed', audit.error);
      return json({ error: '资料已保存，但审计记录失败，请联系管理员核查', saved: true,
        profile: readSubmarketProfileRow(data, name) }, 500);
    }
    return json({ saved: true, profile: readSubmarketProfileRow(data, name), profilePublished: publish });
  } catch (error) {
    console.error('[api/map/submarket] update failed', error);
    return json({ error: '子市场资料保存失败，请稍后重试' }, 500);
  }
}
