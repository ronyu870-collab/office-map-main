import { handleAuditConsole } from '@/src/lib/intelligence/query/auditConsole';
import { queryHttpDependencies } from '@/src/lib/intelligence/query/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try { return await handleAuditConsole(request,{...queryHttpDependencies(),auditEnabled:process.env.AI_AUDIT_HTTP_ENABLED==='true'}); }
  catch { return Response.json({status:'unavailable'},{status:503,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}); }
}
