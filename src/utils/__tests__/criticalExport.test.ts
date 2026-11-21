import {beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({session:vi.fn()}));
vi.mock('@/src/services/supabaseClient',()=>({supabase:{auth:{getSession:f.session}}}));
import {authorizeCriticalExport} from '../criticalExport';
beforeEach(()=>{f.session.mockReset().mockResolvedValue({data:{session:{user:{id:'actor'},access_token:'synthetic'}}});vi.stubGlobal('fetch',vi.fn(async()=>Response.json({authorized:true})));});
it('requires explicit durable authorization before the caller can deliver bytes',async()=>{
 await authorizeCriticalExport('EXPORT_DATA','buildings',10);
 expect(fetch).toHaveBeenCalledWith('/api/audit-events/critical',expect.objectContaining({body:JSON.stringify({action:'EXPORT_DATA',scope:'buildings',count:10,format:'xlsx'})}));
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({error:'offline'},{status:503}));await expect(authorizeCriticalExport('EXPORT_DATA','buildings',10)).rejects.toThrow('导出授权');
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({}));await expect(authorizeCriticalExport('EXPORT_DATA','buildings',10)).rejects.toThrow('导出授权');
});
it('stops stale-account artifact delivery after the server response',async()=>{
 f.session.mockResolvedValueOnce({data:{session:{user:{id:'actor'},access_token:'synthetic'}}}).mockResolvedValueOnce({data:{session:{user:{id:'other'},access_token:'new'}}});
 await expect(authorizeCriticalExport('EXPORT_DATA','buildings',10)).rejects.toThrow('登录状态已变化');
});
