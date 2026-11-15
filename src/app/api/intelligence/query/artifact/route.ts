import { queryHttpDependencies } from '@/src/lib/intelligence/query/http';
import { handleResultRecovery } from '@/src/lib/intelligence/query/recoveryHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { return await handleResultRecovery(request, queryHttpDependencies(), 'artifact'); }
  catch { return Response.json({ status: 'unavailable', error: '查询服务尚未配置。' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } }); }
}
