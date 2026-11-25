import { handlePitchRequest } from '@/src/lib/pitch/http';
import { pitchDependencies } from '@/src/lib/pitch/data/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** pitch_studio_access validates identity/scope and atomically audits every
 * domain mutation; export download is also recorded before bytes are returned. */
export async function GET(request: Request) {
  try { return await handlePitchRequest(request, pitchDependencies()); }
  catch { return Response.json({ error: 'Pitch Studio 尚未配置。' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } }); }
}
export async function POST(request: Request) {
  return GET(request);
}
