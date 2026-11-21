import { beforeEach,expect,it,vi } from 'vitest';
const f=vi.hoisted(()=>({role:'admin',impersonating:false,intentFail:false,head:vi.fn(),put:vi.fn(),remove:vi.fn(),complete:vi.fn(),receipts:[] as Record<string,unknown>[],filters:[] as unknown[][]}));
vi.mock('ali-oss',()=>({default:class{options={bucket:'fixture',region:'fixture'};head=f.head;put=f.put;delete=f.remove;}}));
vi.mock('@/src/lib/server/impersonationAuth',()=>({resolveEffectiveRequestIdentity:async()=>({identity:{caller:{id:'verified'},effectiveRole:f.role,isImpersonating:f.impersonating}})}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:()=>({
 insert:async(value:Record<string,unknown>|Record<string,unknown>[])=>{f.receipts.push(...(Array.isArray(value)?value:[value]));return {error:f.intentFail?{code:'offline'}:null};},
 select(){return this;},eq(...args:unknown[]){f.filters.push(args);return this;},maybeSingle:async()=>({data:f.receipts[0],error:null}),
}),rpc:f.complete})}));
import { POST } from '../route';
const request=(action:string,body:unknown={})=>new Request('http://localhost/api/oss?action='+action,{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify(body)});
beforeEach(()=>{
 vi.clearAllMocks();Object.assign(f,{role:'admin',impersonating:false,intentFail:false,receipts:[],filters:[]});
 for(const [key,value]of Object.entries({NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'synthetic',NEW_OSS_AK:'synthetic',NEW_OSS_SK:'synthetic'}))vi.stubEnv(key,value);
 f.complete.mockResolvedValue({data:true,error:null});f.put.mockResolvedValue({});f.remove.mockResolvedValue({});
 f.head.mockResolvedValue({res:{headers:{'content-length':'8','last-modified':new Date().toUTCString(),etag:'synthetic-version'}}});
});
it('blocks viewers, impersonation, and failed durable receipts before OSS side effects',async()=>{
 f.role='viewer';expect((await POST(request('create-folder',{folder:'a/'}))).status).toBe(403);
 f.role='admin';f.impersonating=true;expect((await POST(request('create-folder',{folder:'a/'}))).status).toBe(403);
 f.impersonating=false;f.intentFail=true;expect((await POST(request('create-folder',{folder:'a/'}))).status).toBe(503);expect(f.put).not.toHaveBeenCalled();
 expect((await POST(request('prepare-upload',{files:[{file_name:'a.pdf',size:8}]}))).status).toBe(503);
});
it('persists actor-bound upload intents and signs only the exact manifest keys',async()=>{
 const result=await (await POST(request('prepare-upload',{files:[{file_name:'research/a.pdf',size:8}]}))).json();
 expect(result.status).toBe('success');expect(f.receipts).toEqual([expect.objectContaining({actor_id:'verified',action_type:'OSS_UPLOAD',target_id:'research/a.pdf'})]);
 const policy=JSON.parse(Buffer.from(result.files[0].policy,'base64').toString());
 expect(policy.conditions).toContainEqual(['eq','$key','research/a.pdf']);expect(policy.conditions).toContainEqual(['content-length-range',1,8]);
 expect(JSON.stringify(f.receipts)).not.toMatch(/signature|synthetic/);
});
it('confirms object metadata before completing an upload and leaves a durable pending outcome on outage',async()=>{
 const id='11111111-1111-4111-8111-111111111111';
 f.receipts=[{id,actor_id:'verified',action_type:'OSS_UPLOAD',target_id:'a.pdf',state:'pending',created_at:new Date().toISOString(),details:{expected_bytes:8}}];
 f.head.mockResolvedValueOnce({res:{headers:{'content-length':'7','last-modified':new Date().toUTCString()}}});
 expect((await POST(request('confirm-upload',{operation_id:id}))).status).toBe(409);expect(f.complete).not.toHaveBeenCalled();
 const response=await POST(request('confirm-upload',{operation_id:id}));expect(response.status).toBe(200);
 expect(f.complete).toHaveBeenCalledWith('audit_complete_operation',expect.objectContaining({p_id:id,p_state:'success',p_details:expect.objectContaining({verified_bytes:8,etag:'synthetic-version'})}));
 expect(f.filters).toContainEqual(['actor_id','verified']);
 f.complete.mockResolvedValueOnce({error:{code:'offline'}});expect(await (await POST(request('confirm-upload',{operation_id:id}))).json()).toMatchObject({status:'success',audit_pending:true});
});
