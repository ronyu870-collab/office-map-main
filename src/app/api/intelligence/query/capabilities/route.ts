import { handleQueryCapabilities } from '@/src/lib/intelligence/query/capabilities';
import { queryHttpDependencies } from '@/src/lib/intelligence/query/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (process.env.AI_QUERY_HTTP_ENABLED !== 'true') return Response.json({ enabled: false, examples: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
  try { return await handleQueryCapabilities(request, queryHttpDependencies()); }
  catch { return Response.json({ enabled: false, examples: [] }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } }); }
}
