import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import * as route from '../route';
const mocks=vi.hoisted(()=>({identity:vi.fn(),audit:vi.fn(),from:vi.fn(),query:vi.fn(),sign:vi.fn(),calls:[] as {table:string;op:string;args:unknown[]}[]}));
vi.mock('@/src/lib/server/impersonationAuth',()=>({resolveEffectiveRequestIdentity:mocks.identity}));
vi.mock('@/src/lib/serverAudit',()=>({writeAuditBestEffort:mocks.audit}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:mocks.from,storage:{from:()=>({createSignedUrl:mocks.sign})}})}));
const building='749e53a6-9d2e-40f0-8d36-e42a6e6ad36d',id='22222222-2222-4222-8222-222222222222';
const row={id,title:'空置面积表',storage_path:`${building}/${id}/original.png`,original_name:'原件.png',details:[],created_at:'2026-10-23T01:00:00Z',source_sha256:'a'.repeat(64),extraction:{contacts:[{name:'private contact'}],source_timing:{document_date_evidence:'原图页眉',received:{value:'2026-10-22',evidence:'用户提供的原始消息日期'}}}};
const identity=(role='viewer',isImpersonating=false)=>({caller:{id:'caller',email:'synthetic@invalid.test'},effectiveRole:role,isImpersonating});
const request=(extra='')=>new Request(`https://synthetic.invalid/api/map/sales-materials?building_id=${building}${extra}`);
beforeEach(()=>{
  vi.clearAllMocks();mocks.calls.length=0;vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://synthetic.invalid');vi.stubEnv('SUPABASE_SECRET_KEY','synthetic');
  mocks.identity.mockResolvedValue({identity:identity()});mocks.audit.mockResolvedValue(true);
  mocks.query.mockImplementation((table:string,operations:{op:string;args:unknown[]}[])=>table==='buildings'?{data:{id:building,name:'测试楼宇'},error:null}:operations.some(item=>item.op==='range')?{data:[row],count:1,error:null}:{data:row,error:null});
  mocks.from.mockImplementation((table:string)=>{
    const operations:{op:string;args:unknown[]}[]=[];const chain:Record<string,unknown>={};
    for(const op of ['select','eq','or','order','range'])chain[op]=(...args:unknown[])=>{operations.push({op,args});mocks.calls.push({table,op,args});return chain;};
    chain.maybeSingle=()=>mocks.query(table,operations);chain.then=(resolve:(value:unknown)=>void,reject:(error:unknown)=>void)=>Promise.resolve(mocks.query(table,operations)).then(resolve,reject);return chain;
  });
  mocks.sign.mockResolvedValue({data:{signedUrl:'https://synthetic.invalid/signed'},error:null});
});
afterEach(()=>vi.unstubAllEnvs());
describe('broker 销控只读 API',()=>{
  it.each(['viewer','editor','admin'])('allows %s read access without advertising management controls',async role=>{
    mocks.identity.mockResolvedValue({identity:identity(role)});const response=await route.GET(request());expect(response.status).toBe(200);
    const body=await response.json();expect(body.count).toBe(1);expect(body.can_upload).toBeUndefined();expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.calls).toContainEqual({table:'buildings',op:'eq',args:['tracking_scope','tracked']});
    expect(mocks.calls).toContainEqual({table:'building_sales_materials',op:'eq',args:['status','ready']});
  });
  it('removes browser mutation routes entirely',()=>{expect(route).not.toHaveProperty('POST');expect(route).not.toHaveProperty('PATCH');expect(route).not.toHaveProperty('DELETE');});
  it('rejects unauthenticated or invalid roles before reading materials',async()=>{
    mocks.identity.mockResolvedValueOnce({response:NextResponse.json({error:'login'},{status:401})});expect((await route.GET(request())).status).toBe(401);expect(mocks.from).not.toHaveBeenCalled();
    mocks.identity.mockResolvedValue({identity:identity('unknown')});expect((await route.GET(request())).status).toBe(403);expect(mocks.from).not.toHaveBeenCalled();
  });
  it('does not expose the parsed evidence bundle or object paths in a version list',async()=>{
    await route.GET(request());const select=mocks.calls.find(call=>call.table==='building_sales_materials'&&call.op==='select')?.args[0];
    expect(select).not.toContain('extraction');expect(select).not.toContain('storage_path');expect(select).not.toContain('created_by');
  });
  it('keeps impersonated reads scoped without returning edit privileges',async()=>{
    mocks.identity.mockResolvedValue({identity:identity('admin',true)});const response=await route.GET(request(`&material_id=${id}`));expect(response.status).toBe(200);expect(await response.json()).not.toHaveProperty('can_edit_details');
  });
  it.each(['&page=-1','&page=1.5','&page=100000','&material_id=bad'])('validates %s',async extra=>{expect((await route.GET(request(extra))).status).toBe(400);});
  it('refuses out-of-scope building reads before querying documents',async()=>{
    mocks.query.mockResolvedValue({data:null,error:null});expect((await route.GET(request())).status).toBe(404);expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it('signs the immutable original selected by both material and building IDs',async()=>{
    const response=await route.GET(request(`&material_id=${id}`));expect(await response.json()).toMatchObject({details:[],preview_url:'https://synthetic.invalid/signed'});
    expect(mocks.calls).toContainEqual({table:'building_sales_materials',op:'eq',args:['building_id',building]});expect(mocks.calls).toContainEqual({table:'building_sales_materials',op:'eq',args:['id',id]});
    expect(mocks.sign).toHaveBeenCalledWith(row.storage_path,300,{download:row.original_name});expect(mocks.audit).toHaveBeenCalled();
  });
  it('returns time evidence with the recorded version time, but omits private extraction metadata',async()=>{
    const body=await (await route.GET(request(`&material_id=${id}`))).json();
    expect(body.provenance).toEqual({document_date_evidence:'原图页眉',received:{value:'2026-10-22',evidence:'用户提供的原始消息日期'},version_recorded_at:row.created_at,source_sha256:row.source_sha256});
    expect(body).not.toHaveProperty('extraction');expect(body).not.toHaveProperty('storage_path');expect(JSON.stringify(body)).not.toContain('private contact');
  });
  it('does not sign unpublished or absent originals',async()=>{
    mocks.query.mockImplementation((table:string)=>({data:table==='buildings'?{id:building}:null,error:null}));expect((await route.GET(request(`&material_id=${id}`))).status).toBe(404);expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('reports an unconfigured database without fake data',async()=>{
    mocks.query.mockImplementation((table:string)=>table==='buildings'?{data:{id:building},error:null}:{data:null,error:{code:'42P01'}});expect((await route.GET(request())).status).toBe(503);
  });
});
