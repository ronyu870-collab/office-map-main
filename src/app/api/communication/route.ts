import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { denyImpersonatedMutation, resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import { normalizeMarketSegments, segmentText } from '@/src/lib/communication/segments';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const response = (body: object, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store' },
});

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Server misconfiguration');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
}

async function validContext(request: NextRequest) {
  const client = adminClient();
  const context = await resolveEffectiveRequestIdentity(request, client);
  if ('response' in context) return context;
  if (!['viewer', 'editor', 'admin'].includes(context.identity.effectiveRole)) {
    return { response: response({ error: '账号没有市场交流权限' }, 403) };
  }
  return { client, identity: context.identity };
}

export async function GET(request: NextRequest) {
  try {
    const context = await validContext(request);
    if ('response' in context) return context.response;
    const [{ data, error }, authResult] = await Promise.all([
      context.client.from('user_roles').select('user_id,chinese_name,full_name,role').in('role', ['viewer','editor','admin']).order('user_id'),
      context.client.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    if (error || authResult.error) {
      console.error('[communication] member directory unavailable', error?.code || authResult.error?.status);
      return response({ error: '成员目录暂时不可用' }, 503);
    }
    const live = new Set(authResult.data.users.filter(user => {
      const until = user.banned_until && new Date(user.banned_until).getTime();
      return !until || until <= Date.now();
    }).map(user => user.id));
    const members = (data ?? [])
      .filter(row => live.has(row.user_id))
      .map(row => ({
        id: row.user_id,
        name: row.chinese_name?.trim() || row.full_name?.trim() || '团队成员',
      }));
    return response({ members, canMentionEveryone: context.identity.effectiveRole === 'admin' });
  } catch (error) {
    console.error('[communication] member lookup failed', error);
    return response({ error: '成员目录暂时不可用' }, 503);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await validContext(request);
    if ('response' in context) return context.response;
    const denied = denyImpersonatedMutation(context.identity);
    if (denied) return denied;
    const contentLength = Number(request.headers.get('content-length') || '0');
    if (contentLength > 16 * 1024) return response({ error: '消息内容过长' }, 413);
    const text = await request.text();
    if (text.length > 16 * 1024) return response({ error: '消息内容过长' }, 413);
    let body: { segments?: unknown; replyToId?: unknown };
    try { body = JSON.parse(text) as typeof body; } catch { return response({ error: '消息格式无效' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return response({ error: '消息格式无效' }, 400);
    const segments = normalizeMarketSegments(body.segments);
    if (!segments?.length || !segmentText(segments).trim()) return response({ error: '请输入有效的消息内容（不超过2000字）' }, 400);
    const replyToId = body.replyToId === null || body.replyToId === undefined ? null : body.replyToId;
    if (replyToId !== null && (typeof replyToId !== 'number' || !Number.isSafeInteger(replyToId) || replyToId < 1)) {
      return response({ error: '回复对象无效' }, 400);
    }
    if (segments.some(part => part.everyone) && context.identity.effectiveRole !== 'admin') {
      return response({ error: '仅管理员可以@所有人' }, 403);
    }
    const { data, error } = await context.client.rpc('post_market_message', {
      p_actor_user_id: context.identity.caller.id,
      p_segments: segments,
      p_reply_to_id: replyToId,
    });
    if (error) {
      const inputError = error.code === '22023';
      const forbidden = error.code === '42501';
      console.warn('[communication] send rejected', error.code);
      return response({ error: forbidden ? '账号无权发送该消息' : inputError ? error.message : '发送失败，请重试' },
        forbidden ? 403 : inputError ? 400 : 503);
    }
    return response({ id: Number(data) }, 201);
  } catch (error) {
    console.error('[communication] send failed', error);
    return response({ error: '发送失败，请重试' }, 503);
  }
}
