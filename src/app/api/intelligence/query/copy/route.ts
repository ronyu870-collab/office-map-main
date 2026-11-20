import { handleAssistantCopy } from '@/src/lib/intelligence/query/assistantCopyHttp';
import { queryHttpDependencies } from '@/src/lib/intelligence/query/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { return await handleAssistantCopy(request, queryHttpDependencies()); }
  catch { return Response.json({ status: 'unavailable', error: '查询服务尚未配置。' }, { status: 503,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }); }
}
