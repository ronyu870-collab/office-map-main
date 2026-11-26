import { z } from 'zod';
import { authorizePitch,pitchRpc,type PitchDependencies } from '../data/store';
import { isQuerySameOrigin } from '@/src/lib/intelligence/query/sameOrigin';
import { documentTokens } from '@/src/lib/intelligence/knowledge/parser';
import { DocumentError } from '@/src/lib/intelligence/knowledge/safeArchive';
import { LayoutError } from '../layout/metrics';
import { libraryReadSchema,libraryCommandSchema } from './api';
import { CHUNK_SIZE } from './protocol';
import { prepareImport,uploadPart,finishUpload,runParseSlice,sourceFile,thumbnailFile,saveLibraryAsset,confirmAssets,normalizeAsset,mergeAssets,variantAsset } from './workflow';
const headers={'Cache-Control':'private, no-store',Vary:'Authorization, x-colliers-impersonate-user','X-Content-Type-Options':'nosniff'};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers});
async function boundedBody(request:Request,limit:number){const reader=request.body?.getReader();if(!reader)throw new Error('PITCH_INVALID');const chunks=[];let size=0;try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit){await reader.cancel();throw new DocumentError('PITCH_BODY_LIMIT','请求体超过限制。');}chunks.push(part.value);}}finally{reader.releaseLock();}return new Uint8Array(Buffer.concat(chunks));}
export async function handleLibraryRequest(request:Request,deps:PitchDependencies,schedule?:(work:()=>Promise<void>)=>void){
 try{
  const ctx=await authorizePitch(request,deps);if(!isQuerySameOrigin(request))return reply({error:'请求来源不受信任。'},403);
  if(request.method==='PUT'){
   const parsed=z.strictObject({jobId:z.uuid(),position:z.coerce.number().int().min(0).max(15)}).safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!parsed.success)return reply({error:'分块参数不合法。'},400);
   if(request.headers.get('content-type')!=='application/octet-stream')return reply({error:'需要二进制分块。'},415);
   return reply(await uploadPart(ctx,parsed.data.jobId,parsed.data.position,await boundedBody(request,CHUNK_SIZE)));
  }
  if(request.method==='GET'){
   const parsed=libraryReadSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!parsed.success)return reply({error:'检索参数不合法。'},400);const input=parsed.data;
   if(input.action==='original'||input.action==='thumbnail'){
    const file=input.action==='original'?await sourceFile(ctx,input.documentId):await thumbnailFile(ctx,input);
    return new Response(Buffer.from(file.bytes),{headers:{...headers,'Content-Type':file.mime,'Content-Disposition':`${input.action==='original'?'attachment':'inline'}; filename="source.${file.filename.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`}});
   }
   const args={...input,action:input.action==='search'&&input.kind==='media'?'library_media':`library_${input.action==='status'?'job_status':input.action}`, ...('q' in input&&input.q?{escapedQuery:input.q.replace(/[\\%_]/g,'\\$&'),tokens:documentTokens(input.q)}:{})};
   const data=await pitchRpc(ctx,args);
   if(input.action==='search'){const items=z.array(z.object({id:z.string()}).passthrough()).parse(data);return reply({items:items.slice(0,30),next:items.length>30?items[29].id:null});}return reply(data);
  }
  if(request.method!=='POST')return reply({error:'不支持此方法。'},405);
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))return reply({error:'需要 JSON。'},415);
  let raw:unknown;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBody(request,512*1024)));}catch(e){if(e instanceof DocumentError)throw e;return reply({error:'JSON 格式不合法。'},400);}
  const parsed=libraryCommandSchema.safeParse(raw);if(!parsed.success)return reply({error:'参数不合法，请核对文件和资料日期。'},400);const c=parsed.data;let result;
  if(c.action==='prepare')result=await prepareImport(ctx,c);
  else if(c.action==='finish'||c.action==='step'||c.action==='retry'){
   if(!schedule)throw new Error('PITCH_WORKER_UNAVAILABLE');
   result=c.action==='finish'?await finishUpload(ctx,c.jobId):c.action==='retry'?await pitchRpc(ctx,{action:'library_job_retry',jobId:c.jobId}):await pitchRpc(ctx,{action:'library_job_status',jobId:c.jobId});
   schedule(()=>runParseSlice({...ctx,signal:AbortSignal.timeout(40000)},c.jobId));return reply(result,202);
  }else if(c.action==='save_asset')result=await saveLibraryAsset(ctx,c);
  else if(c.action==='confirm')result=await confirmAssets(ctx,c);
  else if(c.action==='normalize')result=await normalizeAsset(ctx,c);
  else if(c.action==='merge')result=await mergeAssets(ctx,c);
  else if(c.action==='variant')result=await variantAsset(ctx,c);
  else result=await pitchRpc(ctx,{...c,action:c.action==='cancel'?'library_job_cancel':'library_document_save'});
  return reply(result);
 }catch(error){const code=error instanceof Error?error.message:'';
  if(error instanceof DocumentError||error instanceof LayoutError)return reply({error:error.detail,code:error.code},error.code==='PITCH_BODY_LIMIT'?413:422);
  if(code==='QUERY_UNAUTHENTICATED')return reply({error:'登录失效或当前处于模拟身份。'},401);
  if(code==='PITCH_DENIED')return reply({error:'当前账号、范围或素材权限已失效。'},403);
  if(code==='PITCH_CONFLICT')return reply({error:'记录已变化、任务正被处理或重试次数已用尽，请重新读取。'},409);
  if(code==='PITCH_INVALID'||error instanceof z.ZodError)return reply({error:'内容结构或版本不合法；原件未改变。'},422);
  return reply({error:'素材操作暂未完成，请重试。'},503);
 }
}
