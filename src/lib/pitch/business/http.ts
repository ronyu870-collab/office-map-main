import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { authorizePitch, pitchRpc, type PitchDependencies } from '../data/store';
import { readQueryBody } from '@/src/lib/intelligence/query/httpBody';
import { isQuerySameOrigin } from '@/src/lib/intelligence/query/sameOrigin';
import { DocumentError } from '@/src/lib/intelligence/knowledge/safeArchive';
import { LayoutError } from '../layout/metrics';
import { businessReadSchema, businessCommandSchema } from './protocol';
import { DYNAMIC_CAPABILITIES } from './recipes';
import { searchPitchBuildings } from './adapter';
import { generateBusinessProject, saveBusinessProfile, restoreBusinessProject, compareBusinessSnapshots } from './workflow';
const headers={'Cache-Control':'private, no-store',Vary:'Authorization, x-colliers-impersonate-user','X-Content-Type-Options':'nosniff'};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers});
export async function handleBusinessRequest(request:Request,deps:PitchDependencies) {
  try {
    const ctx=await authorizePitch(request,deps);if(!isQuerySameOrigin(request))return reply({error:'请求来源不受信任。'},403);
    if(request.method==='GET') {
      const c=businessReadSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
      if(c.action==='buildings')return reply(await searchPitchBuildings(ctx,c.q,c.offset));
      if(c.action==='compare') {
        const before=await pitchRpc(ctx,{action:'business_generation',projectId:c.projectId}),after=await pitchRpc(ctx,{action:'business_generation',projectId:c.otherProjectId});
        return reply(compareBusinessSnapshots(before,after));
      }
      const result=await pitchRpc(ctx,{...c,action:'business_'+c.action});
      if(c.action==='catalog')return reply({...z.record(z.string(),z.unknown()).parse(result),dynamic:DYNAMIC_CAPABILITIES,aiAssisted:{status:'requires-independent-authorization',protocol:'pitch-assisted/1'}});
      if(c.action==='search'){const items=z.array(z.record(z.string(),z.unknown())).parse(result);return reply({items:items.slice(0,30),next:items.length>30?items[29].id:null});}
      return reply(result);
    }
    if(request.method!=='POST')return reply({error:'不支持此方法。'},405);
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))return reply({error:'需要 JSON 请求。'},415);
    const read=await readQueryBody(request,randomBytes(32));if(read.rejection)return reply({error:'请求过大、编码无效或未完整接收。'},read.rejection==='body_too_large'?413:400);
    let raw:unknown;try{raw=JSON.parse(read.text??'');}catch{return reply({error:'JSON 格式不合法。'},400);}
    const c=businessCommandSchema.parse(raw);
    if(c.action==='generate')return reply(await generateBusinessProject(ctx,c));
    if(c.action==='profile_save')return reply(await saveBusinessProfile(ctx,c));
    if(c.action==='restore')return reply(await restoreBusinessProject(ctx,c));
    return reply(await pitchRpc(ctx,{...c,action:'business_recipe_save'}));
  }catch(error) {
    if(error instanceof DocumentError||error instanceof LayoutError)return reply({code:error.code,error:error.detail},422);
    const code=error instanceof Error?error.message:'';
    if(code==='QUERY_UNAUTHENTICATED')return reply({error:'登录已失效或正在使用模拟身份。'},401);
    if(['QUERY_DENIED','PITCH_DENIED'].includes(code))return reply({error:'当前资产、数据范围或导出权限不足；动态业务沿用既有独立数据授权。'},403);
    if(code==='PITCH_CONFLICT')return reply({error:'资产、模板或项目版本已变化，请重新读取。'},409);
    if(code==='PITCH_INVALID'||error instanceof z.ZodError)return reply({error:'参数、业务档案或模板不完整，请检查输入。'},422);
    return reply({error:'业务页面暂未生成，请稍后重试。'},503);
  }
}
