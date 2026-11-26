import { NextRequest, NextResponse } from 'next/server';
import { withCriticalAudit } from '@/src/lib/serverAudit';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { denyImpersonatedMutation, resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import { MAP_SUBMARKETS, MAP_SUBMARKETS_SECONDARY, normalizeMapSubmarket } from '@/src/app/map/model/mapDomain';
import { computeSubmarketTrends, type TrendMetricRow } from '@/src/app/map/model/submarketMarketTrend';
import { submarketDatabaseNames } from '@/src/app/map/model/marketIdentity';
import { officeGrade } from '@/src/app/map/model/submarketOverview';
import { readSubmarketProfileRow, submarketProfileSchema } from '@/src/app/map/model/submarketProfile';
import { readSubmarketIntelligence, type SubmarketIntelligence } from '@/src/app/map/model/submarketIntelligence';
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

function missingProfileTable(error: { code?: string; message?: string } | null) {
  return error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST116'
    && /schema cache|relation|table/i.test(error?.message ?? '');
}

async function readProfile(client: SupabaseClient, name: string) {
  const { data, error } = await client.from('map_submarket_profiles')
    .select('*')
    .eq('submarket', name).maybeSingle();
  if (error) {
    if (missingProfileTable(error)) return { available: false, published: false, profile: readSubmarketProfileRow(null, name) };
    throw new Error('PROFILE_READ_FAILED');
  }
  return { available: true, published: data?.is_published === true, profile: readSubmarketProfileRow(data, name) };
}

async function readResearchHistory(client: SupabaseClient, name: string, offset: number) {
  const { data, error } = await client.from('map_submarket_research_versions')
    .select('id,research,saved_at,was_published')
    .eq('submarket', name).order('replaced_at', { ascending: false }).order('id', { ascending: false })
    .range(offset, offset + 10);
  if (error) {
    if (missingProfileTable(error)) return json({ versions: [], nextOffset: null });
    throw new Error('RESEARCH_HISTORY_UNAVAILABLE');
  }
  const rows = data ?? [];
  return json({
    versions: rows.slice(0, 10).flatMap(row => {
      const research = readSubmarketIntelligence(row.research, name);
      return row.research !== null && !research ? [] : [{
        id: row.id, savedAt: row.saved_at, wasPublished: row.was_published, research,
      }];
    }),
    nextOffset: rows.length > 10 ? offset + 10 : null,
  });
}

async function validateResearchProjects(client: SupabaseClient, research: SubmarketIntelligence) {
  if (!research.projects.length) return true;
  const ids = research.projects.map(project => project.buildingId);
  const { data, error } = await client.from('buildings').select('id')
    .in('id', ids).in('submarket', submarketDatabaseNames(research.market))
    .eq('is_active', true).eq('tracking_scope', 'tracked')
    .or('project_type.neq.future,project_type.is.null');
  if (error) throw new Error('RESEARCH_PROJECT_LOOKUP_FAILED');
  return data?.length === ids.length;
}

async function readTrend(client: SupabaseClient, name: string, signal: AbortSignal) {
  const { data: stock, error } = await client.from('buildings')
    .select('id,grade')
    .eq('is_active', true)
    .eq('tracking_scope', 'tracked')
    .or('project_type.neq.future,project_type.is.null')
    .in('submarket', submarketDatabaseNames(name))
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
        .select('id,building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,vacancy_rate,is_draft,is_locked,updated_at,created_at,data_source')
        .eq('is_locked', true)
        .or('is_draft.is.null,is_draft.eq.false')
        .in('building_id', group)
        .gte('record_year', currentYear - 4)
        .order('record_year', { ascending: false })
        .order('record_quarter', { ascending: false })
        .order('id', { ascending: false })
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
    scope: 'authorized_market', membershipTime: 'current_catalog', publication: 'locked_non_draft',
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

    const canEdit = result.identity.callerRole === 'admin' && result.identity.effectiveRole === 'admin'
      && !result.identity.isImpersonating;
    const history = request.nextUrl.searchParams.get('researchHistory');
    if (history !== null) {
      if (!canEdit) return json({ error: '仅管理员可以查看资料版本' }, 403);
      if (!/^\d{1,5}$/.test(history)) return json({ error: '版本页码不正确' }, 400);
      return await readResearchHistory(client, name, Number(history));
    }

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
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ error: '资料格式不正确' }, 400);
    }
    const { publicationIntent, expectedUpdatedAt, ...profileInput } = body as Record<string, unknown>;
    if (publicationIntent !== undefined && publicationIntent !== 'draft' && publicationIntent !== 'publish') {
      return json({ error: '发布操作不受支持' }, 400);
    }
    const parsed = submarketProfileSchema.safeParse(profileInput);
    if (!parsed.success) return json({ error: '资料字段格式不正确，请检查来源链接与字段长度' }, 400);
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== null
      && (typeof expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(expectedUpdatedAt)))) {
      return json({ error: '资料版本格式不正确' }, 400);
    }

    const before = await readProfile(client, name);
    if (!before.available) return json({ error: '子市场资料表尚未部署，请先应用对应数据库迁移' }, 503);
    const stale = () => json({ error: '资料已被更新，请保留当前修改并重新加载最新版本。' }, 409);
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== before.profile.updatedAt) return stale();
    const research = parsed.data.research === undefined ? before.profile.research : parsed.data.research;
    if (research && research.market !== name) return json({ error: '研究资料与目标子市场不一致' }, 422);
    const publish = publicationIntent === 'publish';
    if (publish) {
      const problems = publicBriefReviewErrors({ ...parsed.data, research });
      if (problems.length) return json({ error: '内容无法直接展示：' + problems.join('；') }, 422);
    }
    if (parsed.data.research && !(await validateResearchProjects(client, parsed.data.research))) {
      return json({ error: '代表项目必须是当前子市场的有效存量楼宇' }, 422);
    }

    return await withCriticalAudit(client,{
      user_id: identity.caller.id, action_type: 'ADMIN_DATA_OPERATION', module: 'map',
      target_table: 'map_submarket_profiles', target_id: name,
      details: { operation: publish ? 'publish_submarket_profile' : 'save_submarket_draft', submarket: name },
    }, 'map/submarket', async recordResult => {
      const previousTime = before.profile.updatedAt ? Date.parse(before.profile.updatedAt) : 0;
      const updatedAt = new Date(Math.max(Date.now(), previousTime + 1)).toISOString();
      const values = {
        submarket: name, ...parsed.data, updated_by: identity.caller.id, updated_at: updatedAt,
        is_published: publish, published_at: publish ? updatedAt : null,
        published_by: publish ? identity.caller.id : null,
      };
      const table = client.from('map_submarket_profiles');
      const { data, error } = typeof expectedUpdatedAt === 'string'
        ? await table.update(values).eq('submarket', name).eq('updated_at', expectedUpdatedAt).select('*').maybeSingle()
        : expectedUpdatedAt === null
          ? await table.insert(values).select('*').single()
          : await table.upsert(values, { onConflict: 'submarket' }).select('*').single();
      if (!data && (!error || (expectedUpdatedAt === null && error.code === '23505'))) return stale();
      if (error?.code === 'PGRST204' || error?.code === '42703') {
        return json({ error: '结构化研究资料尚未启用，请先应用数据库迁移。' }, 503);
      }
      if (error) throw new Error('PROFILE_SAVE_FAILED');

      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      const oldProfile = { ...before.profile, is_published: before.published };
      const newProfile = { ...readSubmarketProfileRow(data, name), is_published: publish };
      for (const [key, value] of Object.entries(newProfile)) {
        const previous = (oldProfile as Record<string, unknown>)[key];
        if (JSON.stringify(previous) !== JSON.stringify(value)) {
          oldValues[key] = previous ?? null;
          newValues[key] = value;
        }
      }
      recordResult({ target_name: name, old_values: oldValues, new_values: newValues, updated_at: updatedAt });
      return json({ saved: true, profile: readSubmarketProfileRow(data, name), profilePublished: publish });
    });
  } catch (error) {
    console.error('[api/map/submarket] update failed', error);
    return json({ error: '子市场资料保存失败，请稍后重试' }, 500);
  }
}
