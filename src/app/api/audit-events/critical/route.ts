import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { denyImpersonatedMutation, resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import { withCriticalAudit } from '@/src/lib/serverAudit';
import { parseUserRole } from '@/src/types/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.strictObject({
  action: z.enum(['EXPORT_DATA','EXPORT_BACKUP','EXPORT_MAP_DATA','EXPORT_BUILDING_COMPARISON','EXPORT_LEASE_TRANSACTIONS','SALES_MATERIAL_DOWNLOAD']),
  scope: z.string().min(1).max(100).regex(/^[a-zA-Z0-9:_-]+$/),
  count: z.number().int().min(0).max(1000000),
  format: z.enum(['xlsx','csv','zip','json','png','original']),
});
const headers = {'Cache-Control':'private, no-store'};
/** A receipt confirms authorization to hand an already-readable browser artifact to
 * FileSaver. It never claims that the server generated or the user saved that file.
 * Counts and scope are explicitly client-reported, not business mutation evidence. */
export async function POST(request: Request): Promise<Response> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) return Response.json({error:'服务配置不完整'},{status:503,headers});
    const client = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const resolved = await resolveEffectiveRequestIdentity(request,client);
    if ('response' in resolved) return resolved.response;
    const {identity} = resolved;
    const blocked = denyImpersonatedMutation(identity); if (blocked) return blocked;
    if (!parseUserRole(identity.effectiveRole)) return Response.json({error:'无导出资格'},{status:403,headers});
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 2048) return Response.json({error:'请求过大'},{status:413,headers});
    let input: unknown; try { input=JSON.parse(raw); } catch { return Response.json({error:'范围无效'},{status:400,headers}); }
    const parsed = schema.safeParse(input);
    if (!parsed.success) return Response.json({error:'范围无效'},{status:400,headers});
    const {action,scope,count,format} = parsed.data;
    if (!['EXPORT_MAP_DATA','EXPORT_BUILDING_COMPARISON','SALES_MATERIAL_DOWNLOAD'].includes(action) && identity.effectiveRole !== 'admin')
      return Response.json({error:'仅管理员可导出此范围'},{status:403,headers});
    let target: {target_table?:string;target_id?:string;building_id?:string;source_sha256?:string} = {};
    if (action==='SALES_MATERIAL_DOWNLOAD') {
      if (!z.uuid().safeParse(scope).success) return Response.json({error:'资料编号无效'},{status:400,headers});
      const material=await client.from('building_sales_materials').select('id,building_id,source_sha256').eq('id',scope).eq('status','ready').maybeSingle();
      if (material.error || !material.data) return Response.json({error:'资料不可用'},{status:404,headers});
      const building=await client.from('buildings').select('id').eq('id',material.data.building_id).eq('is_active',true).eq('tracking_scope','tracked').maybeSingle();
      if (building.error || !building.data) return Response.json({error:'楼宇不可用'},{status:404,headers});
      target={target_table:'building_sales_materials',target_id:scope,building_id:building.data.id,source_sha256:material.data.source_sha256};
    }
    return await withCriticalAudit(client,{user_id:identity.caller.id,action_type:action,module:'export',target_table:target.target_table,target_id:target.target_id,
      details:{phase:'artifact_delivery_authorized',metadata_source:'client_reported',reported_scope:scope,reported_count:count,format,building_id:target.building_id,source_sha256:target.source_sha256}},
      'audit-events/critical',async () => Response.json({authorized:true},{headers}),true);
  } catch { return Response.json({error:'导出授权未完成，请重试'},{status:503,headers}); }
}
