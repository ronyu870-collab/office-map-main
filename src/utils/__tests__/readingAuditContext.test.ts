import {expect,it,vi} from 'vitest';
import {beginBuildingReading,buildingReadingContext,createReadingContext,readingEntry,readingHeaders} from '../readingAuditContext';
import {readingAuditContext} from '@/src/lib/server/readingAudit';
it('keeps one correlation for stock/future and their linked resources and bounds the cache',()=>{
 const context=beginBuildingReading('future','map_full_list','stock');
 expect(buildingReadingContext('stock')).toEqual(context);expect(buildingReadingContext('future')).toEqual(context);
 for(let i=0;i<100;i++)beginBuildingReading('future'+i,'map_list','stock'+i);
 expect(buildingReadingContext('future').correlation_id).not.toBe(context.correlation_id);
 expect(buildingReadingContext('stock99')).toEqual(buildingReadingContext('future99'));
});
it('retains controlled search / AI / history origins without copying a URL or user query',()=>{
 window.history.replaceState(null,'','/map?aiRequest=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&private=secret');
 const context=createReadingContext();expect(context).toMatchObject({entry:'ai_query',origin_request_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
 expect(JSON.stringify(context)).not.toMatch(/private|secret|\/map/);expect(readingHeaders(context)['x-reading-origin-id']).toBe(context.origin_request_id);
 window.history.replaceState(null,'','/lease-submission/history?back=%2Fsearch%3Fq%3Dsecret');expect(createReadingContext('lease_history').entry).toBe('search');
 expect(readingEntry('/unknown-secret')).toBe('unknown');window.history.replaceState(null,'','/');
});
it('derives actual and effective identity only from trusted server resolution',()=>{
 const identity={effectiveUserId:'effective',isImpersonating:true} as Parameters<typeof readingAuditContext>[1];
 const request=new Request('http://localhost/',{headers:{'x-reading-entry':'unknown-url','x-reading-id':'not-a-uuid','x-effective-user-id':'forged'}});
 expect(readingAuditContext(request,identity)).toEqual({entry:'unknown',effective_user_id:'effective',is_impersonating:true});
});

it('does not break a view if browser correlation generation is unavailable',()=>{
 const random=vi.spyOn(crypto,'randomUUID').mockImplementation(()=>{throw new Error('entropy unavailable');});
 try{expect(createReadingContext('library')).toMatchObject({entry:'library',correlation_id:''});}finally{random.mockRestore();}
});
