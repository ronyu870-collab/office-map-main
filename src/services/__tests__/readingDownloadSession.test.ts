import {beforeEach,expect,it,vi} from 'vitest';
import {downloadSalesMaterial,salesMaterialReader} from '../salesMaterialsClient';
import {loadStoredBuildingPhoto} from '../buildingPhotosClient';
const session=vi.hoisted(()=>vi.fn());
vi.mock('@/src/services/Auth',()=>({getSessionFast:session}));
const owner={user:{id:'owner'},session:{access_token:'owner-token'}};
const context={entry:'search' as const,correlation_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
beforeEach(()=>{session.mockReset().mockResolvedValue(owner);sessionStorage.clear();vi.stubGlobal('fetch',vi.fn(async()=>Response.json({url:'https://synthetic.invalid/issued'})));});
it.each(['material','photo'])('rejects an old %s download link when the user switches while awaiting the response',async kind=>{
 session.mockResolvedValueOnce(owner).mockResolvedValueOnce({user:{id:'another'},session:{access_token:'other-token'}});
 const pending=kind==='material'?downloadSalesMaterial('building','material',context):loadStoredBuildingPhoto('building','photo',new AbortController().signal,'download',context);
 await expect(pending).rejects.toThrow('登录状态已变化');expect(session).toHaveBeenCalledTimes(2);
});
it('keeps ordinary access to one cached identity read and forwards controlled attribution',async()=>{
 await salesMaterialReader.access('building','material',undefined,context);expect(session).toHaveBeenCalledTimes(1);
 const init=vi.mocked(fetch).mock.calls[0][1]!;const headers=new Headers(init.headers);
 expect(headers.get('x-reading-entry')).toBe('search');expect(headers.get('x-reading-id')).toBe(context.correlation_id);
});
