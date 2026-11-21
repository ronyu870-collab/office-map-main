import { beforeEach,expect,it,vi } from 'vitest';
const f=vi.hoisted(()=>({role:'admin',impersonating:false,intentError:false,completionError:false,calls:[] as unknown[][]}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:(table:string)=>({insert:async(row:unknown)=>{f.calls.push([table,row]);return {error:f.intentError?{code:'offline'}:null};}}),rpc:async(...args:unknown[])=>{f.calls.push(args);return {data:!f.completionError,error:f.completionError?{code:'offline'}:null};}})}));
vi.mock('@/src/lib/server/impersonationAuth',()=>({resolveEffectiveRequestIdentity:async()=>({identity:{caller:{id:'verified-actor'},effectiveRole:f.role,isImpersonating:f.impersonating}}),denyImpersonatedMutation:()=>f.impersonating?Response.json({error:'readonly'},{status:403}):null}));
import {POST} from '../route';
const request=(action='EXPORT_DATA',extra={})=>new Request('http://localhost/api/audit-events/critical',{method:'POST',body:JSON.stringify({action,scope:'buildings',count:10,format:'xlsx',...extra})});
beforeEach(()=>{Object.assign(f,{role:'admin',impersonating:false,intentError:false,completionError:false,calls:[]});vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://example.supabase.co');vi.stubEnv('SUPABASE_SECRET_KEY','synthetic');vi.spyOn(console,'error').mockImplementation(()=>{});});
it('uses verified actor and limited client-reported metadata without accepting arbitrary audit fields',async()=>{
 expect((await POST(request('EXPORT_DATA',{user_id:'forged'}))).status).toBe(400);
 expect((await POST(request())).status).toBe(200);
 expect(f.calls[0]).toEqual(['audit_operation_receipts',expect.objectContaining({actor_id:'verified-actor',details:expect.objectContaining({phase:'artifact_delivery_authorized',metadata_source:'client_reported',reported_count:10})})]);
 expect(f.calls[1][0]).toBe('audit_complete_operation');
});
it('withholds authorization on missing durable evidence and does not widen viewer or impersonation rights',async()=>{
 f.role='viewer';expect((await POST(request())).status).toBe(403);expect(f.calls).toHaveLength(0);
 expect((await POST(request('EXPORT_BUILDING_COMPARISON'))).status).toBe(200);
 f.role='admin';f.impersonating=true;expect((await POST(request())).status).toBe(403);
 f.impersonating=false;f.intentError=true;expect((await POST(request())).status).toBe(503);
 f.intentError=false;f.completionError=true;const response=await POST(request());expect(response.status).toBe(503);expect(await response.text()).not.toContain('authorized');
});
