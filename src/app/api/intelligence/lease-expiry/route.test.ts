// Route contracts plus actual identity helper; DB permissions/concurrency are tested in PostgreSQL.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), maybeSingle: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: mocks.getUser }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }), rpc: mocks.rpc }) }));
import { GET, POST } from './route';
import * as expiryRoute from '@/src/app/api/lease-transactions/expiry/route';
import { chinaToday } from '@/src/lib/leaseExpiry/contracts';
const body = { source_kind:'history',source_id:'11111111-1111-4111-8111-111111111111',expected_revision:0,source_fingerprint:'a'.repeat(32),request_id:'22222222-2222-4222-8222-222222222222',status:'pending',notes:'',evidence_reference:'' };
const request = (method='GET',input: unknown=body,headers: Record<string,string>={}) => new Request('http://localhost/api/intelligence/lease-expiry',{method,headers:{Authorization:'Bearer synthetic',...headers},...(method==='POST'?{body:JSON.stringify(input)}:{})});
beforeEach(() => {
  vi.stubEnv('LEASE_EXPIRY_REVIEW_ENABLED','true'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://synthetic.invalid');vi.stubEnv('SUPABASE_SECRET_KEY','synthetic');
  mocks.rpc.mockReset().mockResolvedValue({data:{items:[],total:0},error:null}); mocks.getUser.mockReset().mockResolvedValue({data:{user:{id:'verified-actor'}},error:null}); mocks.maybeSingle.mockReset().mockResolvedValue({data:{role:'admin'},error:null});
});
describe('F6 route authorization and validation',()=>{
  it('keeps the leasing read endpoint admin-only, uncached and without a write handler', async () => {
    expect('POST' in expiryRoute).toBe(false);
    const read = () => expiryRoute.GET(new Request('http://localhost/api/lease-transactions/expiry?page=2&scope=window', { headers: { Authorization: 'Bearer synthetic' } }));
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'viewer' } });
    expect((await read()).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'admin' } });
    const result = await read();
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('lease_expiry_context_list', expect.objectContaining({ p_actor: 'verified-actor', p_page: 2 }));
    mocks.rpc.mockResolvedValue({ error: { code: '42501', message: 'private' } });
    expect((await read()).status).toBe(403);
  });
  it('is closed by default and denies anonymous, viewer and simulated access before data reads',async()=>{
    vi.stubEnv('LEASE_EXPIRY_REVIEW_ENABLED','');expect((await GET(request())).status).toBe(403);vi.stubEnv('LEASE_EXPIRY_REVIEW_ENABLED','true');
    expect((await GET(request('GET',null,{Authorization:''}))).status).toBe(401);
    mocks.maybeSingle.mockResolvedValue({data:{role:'viewer'}});expect((await GET(request())).status).toBe(403);
    mocks.maybeSingle.mockResolvedValue({data:{role:'admin',user_id:'simulated'}});expect((await POST(request('POST',body,{'x-colliers-impersonate-user':'simulated'}))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('derives actor from verified token and disables caching',async()=>{
    const result=await POST(request('POST'));expect(result.status).toBe(200);expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('lease_expiry_review_save',expect.objectContaining({p_actor:'verified-actor',p_request_id:body.request_id,p_source_kind:'history'}));
  });
  it('passes explicit live identity without accepting a client actor',async()=>{
    expect((await POST(request('POST',{...body,source_kind:'live'}))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('lease_expiry_review_save',expect.objectContaining({p_actor:'verified-actor',p_source_kind:'live',p_source_id:body.source_id}));
  });
  it('rejects forged actor, confirmed expiry, invalid fields and malformed JSON',async()=>{
    for(const input of [{...body,source_kind:undefined},{...body,source_kind:'unknown'},{...body,actor_id:'someone'},{...body,status:'verified'},{...body,status:'source_conflict'},{...body,notes:'a'.repeat(4001)}]) expect((await POST(request('POST',input))).status).toBe(400);
    expect((await POST(new Request('http://localhost',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:'{'}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('maps permission revocation and concurrency errors without returning database details',async()=>{
    mocks.rpc.mockResolvedValue({error:{code:'42501',message:'secret data'}});expect((await GET(request())).status).toBe(403);
    mocks.rpc.mockResolvedValue({error:{code:'P0001',message:'F6_REVISION_CONFLICT'}});expect((await POST(request('POST'))).status).toBe(409);
    mocks.rpc.mockResolvedValue({error:{code:'XX000',message:'secret data'}});const result=await GET(request());expect(result.status).toBe(503);expect(await result.text()).not.toContain('secret data');
  });
  it('uses China business date and validates paging',async()=>{
    expect(chinaToday(new Date('2026-11-10T16:00:00Z'))).toBe('2026-11-11');
    expect((await GET(new Request('http://localhost?scope=all&page=0',{headers:{Authorization:'Bearer synthetic'}}))).status).toBe(400);
  });
});
