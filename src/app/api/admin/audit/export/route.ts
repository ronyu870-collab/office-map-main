import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { denyImpersonatedMutation,resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import { applyAuditFilters,auditFiltersSchema } from '@/src/lib/audit/query';
import { sanitizeAuditText } from '@/src/utils/auditSanitizer';
import { withCriticalAudit } from '@/src/lib/serverAudit';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const schema=z.strictObject({filters:auditFiltersSchema,format:z.enum(['csv','xlsx','json']),limit:z.number().int().min(1).max(500)});
const fields='id,user_id,actor_kind,actor_name,actor_role,occurred_at,action_type,module,target_table,target_id,target_name,request_source,error_message';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
function csvCell(value:unknown){let text=value==null?'':String(value);if(/^[\s]*[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
export async function POST(request:Request):Promise<Response>{
 try {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
  if(!url||!key)return Response.json({error:'服务配置不完整'},{status:503,headers});
  const client=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const resolved=await resolveEffectiveRequestIdentity(request,client);
  if('response' in resolved)return resolved.response;
  const {identity}=resolved;
  const blocked=denyImpersonatedMutation(identity);if(blocked)return blocked;
  if(identity.effectiveRole!=='admin')return Response.json({error:'无权导出审计'},{status:403,headers});
  if(Number(request.headers.get('content-length'))>16384)return Response.json({error:'请求过大'},{status:413,headers});
  const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>16384)return Response.json({error:'请求过大'},{status:413,headers});
  let input:unknown;try{input=JSON.parse(raw);}catch{return Response.json({error:'导出范围无效'},{status:400,headers});}
  const parsed=schema.safeParse(input);if(!parsed.success)return Response.json({error:'导出范围无效'},{status:400,headers});
  const {filters,format,limit}=parsed.data;
  return await withCriticalAudit(client,{user_id:identity.caller.id,action_type:'AUDIT_EXPORT',module:'admin',
   details:{filters,format,limit,coverage:'filtered_summary_only',delivery:'file_preparation'}},'admin/audit/export',async()=>{
    const {data,error}=await applyAuditFilters(client.from('audit_logs').select(fields),filters)
      .order('occurred_at',{ascending:false}).order('id',{ascending:false}).limit(limit+1).abortSignal(AbortSignal.timeout(10000));
    if(error)return Response.json({error:'审计读取失败'},{status:503,headers});
    if(data.length>limit)return Response.json({error:`当前筛选超过 ${limit} 条，请缩小范围。`},{status:413,headers});
    // A second live profile lookup prevents delivery if privileges changed while preparing.
    const profile=await client.from('user_roles').select('role').eq('user_id',identity.caller.id).maybeSingle();
    if(profile.error||profile.data?.role!=='admin')return Response.json({error:'读取权限已变更'},{status:403,headers});
    const columns=fields.split(',');
    const records=data.map(value=>{const row=value as Record<string,unknown>;return Object.fromEntries(columns.map(column=>[column,typeof row[column]==='string'?sanitizeAuditText(row[column]):row[column]??null]));});
    let body:Uint8Array;let contentType:string;
    if(format==='xlsx'){
      const XLSX=await import('xlsx');const book=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(records),'业务审计');
      body=new Uint8Array(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));contentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }else{
      const text=format==='csv'?'\uFEFF'+[columns,...records.map((row:Record<string,unknown>)=>columns.map(column=>row[column]))].map(row=>row.map(csvCell).join(',')).join('\r\n')
        :JSON.stringify({schema:'audit-summary/3',coverage:'filtered_summary_only',count:records.length,records});
      body=new TextEncoder().encode(text);contentType=format==='csv'?'text/csv; charset=utf-8':'application/json; charset=utf-8';
    }
    if(body.byteLength>2*1024*1024)return Response.json({error:'文件过大，请缩小范围。'},{status:413,headers});
    return new Response(body as BodyInit,{headers:{...headers,'Content-Type':contentType,'Content-Disposition':`attachment; filename="business-audit.${format}"`,'X-Audit-Row-Count':String(records.length)}});
   },true);
 }catch{return Response.json({error:'导出失败，请重试。'},{status:503,headers});}
}
