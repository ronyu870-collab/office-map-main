import { handleManagement } from '@/src/lib/intelligence/control/managementHttp';
import { queryHttpDependencies } from '@/src/lib/intelligence/query/http';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
  try {
    const {client,keys}=queryHttpDependencies();
    return await handleManagement(request,{client,digestKey:keys.digestKey,keys});
  } catch {
    return Response.json({status:'unavailable'},{status:503,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
}
