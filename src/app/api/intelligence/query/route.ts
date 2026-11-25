import { scheduleOperationalAlerts } from '@/src/lib/intelligence/control/alertTick';
import { handleQuerySubmission, queryHttpDependencies } from '@/src/lib/intelligence/query/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try { const dependencies = queryHttpDependencies(); scheduleOperationalAlerts(dependencies.client); return await handleQuerySubmission(request, dependencies); }
  catch { return Response.json({ status: 'unavailable', error: '查询服务尚未配置。' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } }); }
}
