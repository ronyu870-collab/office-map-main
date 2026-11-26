import { handleBusinessRequest } from '@/src/lib/pitch/business/http';
import { pitchDependencies } from '@/src/lib/pitch/data/store';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
/** pitch_studio_access revalidates current data/asset grants and atomically audits mutations. */
export async function GET(request:Request) {
  try{return await handleBusinessRequest(request,pitchDependencies());}
  catch{return Response.json({error:'Pitch Studio 尚未配置。'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
}
export async function POST(request:Request){return GET(request);}
