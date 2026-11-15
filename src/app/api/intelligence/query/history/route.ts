import { queryHttpDependencies } from '@/src/lib/intelligence/query/http';
import { handleOwnHistory } from '@/src/lib/intelligence/query/historyHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { return await handleOwnHistory(request, queryHttpDependencies()); }
  catch { return Response.json({ status: 'unavailable', error: '历史工作记录暂不可用。' },
    { status: 503, headers: { 'Cache-Control': 'private, no-store' } }); }
}
