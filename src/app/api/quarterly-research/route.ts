import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import { canReadQuarterlyResearch, isResearchEdition } from '@/src/config/quarterlyResearch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Vary': 'Authorization, X-Colliers-Impersonate-User',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

async function serve(request: NextRequest, head = false) {
  const reject = (error: string, status: number) => NextResponse.json({ error }, { status, headers: privateHeaders });
  if (!/^Bearer\s+\S+$/i.test(request.headers.get('authorization') || '')) return reject('请先登录管理员账号', 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return reject('报告服务暂不可用', 503);
  try {
    const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await resolveEffectiveRequestIdentity(request, client);
    if ('response' in result) {
      for (const [key, value] of Object.entries(privateHeaders)) result.response.headers.set(key, value);
      return result.response;
    }
    const { identity } = result;
    if (!canReadQuarterlyResearch(identity.callerRole, identity.isImpersonating)
      || !canReadQuarterlyResearch(identity.effectiveRole)
      || identity.caller.app_metadata?.must_change_password) return reject('此报告仅限管理员访问', 403);
    const edition = request.nextUrl.searchParams.get('edition') || '2026Q3';
    if (!isResearchEdition(edition)) return reject('该季度报告不可用', 404);
    if (head) return new NextResponse(null, { status: 204, headers: privateHeaders });
    const document = await readFile(join(process.cwd(), 'private', 'quarterly-research', `${edition}.html`), 'utf8');
    // Returned as inert text; only the authenticated host mounts a private in-memory frame.
    return new NextResponse(document, { headers: { ...privateHeaders, 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch {
    return reject('暂时无法读取报告，请稍后重试', 503);
  }
}
export async function GET(request: NextRequest) { return serve(request); }
export async function HEAD(request: NextRequest) { return serve(request, true); }
