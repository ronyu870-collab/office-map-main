import { beforeEach, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
const fixture=vi.hoisted(()=>({role:'admin',impersonating:false,revoked:false,intentError:false,completionError:false,readError:false,rows:[] as Record<string,unknown>[],calls:[] as unknown[][],complete:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({
 from:(table:string)=>{
  const q:Record<string,unknown>={};
  for(const method of ['select','eq','neq','in','not','or','ilike','gte','lte','order','limit','abortSignal'])q[method]=(...args:unknown[])=>{fixture.calls.push([table,method,...args]);return q;};
  q.insert=async(value:unknown)=>{fixture.calls.push([table,'insert',value]);return {error:fixture.intentError?{code:'offline'}:null};};
  q.maybeSingle=async()=>({data:{role:fixture.revoked?'viewer':'admin'},error:null});
  q.then=(resolve:(result:unknown)=>void)=>resolve({data:fixture.rows,error:fixture.readError?{code:'offline'}:null});
  return q;
 },rpc:(...args:unknown[])=>fixture.complete(...args),
})}));
vi.mock('@/src/lib/server/impersonationAuth',()=>({
 resolveEffectiveRequestIdentity:async()=>({identity:{caller:{id:'verified-admin'},effectiveRole:fixture.role,isImpersonating:fixture.impersonating}}),
 denyImpersonatedMutation:(identity:{isImpersonating:boolean})=>identity.isImpersonating?Response.json({error:'readonly'},{status:403}):null,
}));
import { POST } from '../route';
const request=(format='json',filters:Record<string,unknown>={view:'all',excludeCodex:false},limit=500)=>new Request('http://localhost/api/admin/audit/export',{method:'POST',body:JSON.stringify({format,filters,limit})});
beforeEach(()=>{
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://example.supabase.co');vi.stubEnv('SUPABASE_SECRET_KEY','synthetic');
 Object.assign(fixture,{role:'admin',impersonating:false,revoked:false,intentError:false,completionError:false,readError:false,calls:[],rows:[{id:1,user_id:'verified-admin',action_type:'AI_QUERY',target_name:'=HYPERLINK("unsafe")',error_message:'Bearer private-token',details:{prompt:'restricted AI original'},new_values:{password:'private'}}]});
 fixture.complete.mockReset().mockImplementation(async()=>({data:!fixture.completionError,error:fixture.completionError?{code:'offline'}:null}));
 vi.spyOn(console,'error').mockImplementation(()=>undefined);
});
it('rejects viewers and impersonated administrators before any data or receipt access',async()=>{
 fixture.role='viewer';expect((await POST(request())).status).toBe(403);
 fixture.role='admin';fixture.impersonating=true;expect((await POST(request())).status).toBe(403);expect(fixture.calls).toEqual([]);
});
it('uses server-side current filters and exports only explicit sanitized summary columns',async()=>{
 const response=await POST(request('json',{view:'all',targetTable:'buildings',targetId:'object-id',operationId:'request-id'}));
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
 const result=await response.json();expect(result.count).toBe(1);expect(result.records[0].error_message).toBe('Bearer [REDACTED]');
 expect(JSON.stringify(result)).not.toMatch(/restricted AI original|private-token|password/);
 expect(fixture.calls).toContainEqual(['audit_logs','eq','target_id','object-id']);
 expect(fixture.calls).toContainEqual(['audit_logs','or','details->>operation_id.eq.request-id,details->>request_id.eq.request-id,event_id.eq.request-id']);
 expect(fixture.calls.find(c=>c[0]==='audit_logs'&&c[1]==='select')?.[2]).not.toContain('*');
 expect(fixture.complete).toHaveBeenCalledWith('audit_complete_operation',expect.objectContaining({p_state:'success'}));
});
it('refuses delivery when durable intent, final persistence, reads, or live authorization fail',async()=>{
 fixture.intentError=true;expect((await POST(request())).status).toBe(503);expect(fixture.calls.some(c=>c[0]==='audit_logs')).toBe(false);
 fixture.intentError=false;fixture.completionError=true;let response=await POST(request());expect(response.status).toBe(503);expect(await response.text()).not.toContain('HYPERLINK');
 fixture.completionError=false;fixture.revoked=true;response=await POST(request());expect(response.status).toBe(403);
 fixture.revoked=false;fixture.readError=true;expect((await POST(request())).status).toBe(503);
});
it('bounds the result and neutralizes CSV formulas while generating a readable Excel workbook',async()=>{
 fixture.rows.push({id:2});expect((await POST(request('json',{},1))).status).toBe(413);fixture.rows.pop();
 const csv=await POST(request('csv'));expect(await csv.text()).toContain("\"'=HYPERLINK");
 const excel=await POST(request('xlsx'));expect(excel.status).toBe(200);
 const book=XLSX.read(new Uint8Array(await excel.arrayBuffer()),{type:'array'});
 const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(book.Sheets[book.SheetNames[0]]);
 expect(rows).toHaveLength(1);expect(rows[0].target_name).toBe('=HYPERLINK("unsafe")');expect(rows[0].error_message).toBe('Bearer [REDACTED]');
});
