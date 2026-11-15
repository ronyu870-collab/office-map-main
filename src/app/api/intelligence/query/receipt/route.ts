import { handleDeliveryReport } from '@/src/lib/intelligence/query/deliveryHttp';
import { queryHttpDependencies } from '@/src/lib/intelligence/query/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { return await handleDeliveryReport(request, queryHttpDependencies()); }
  catch { return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } }); }
}
