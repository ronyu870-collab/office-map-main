import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
vi.mock('../serverAuthority',async importOriginal=>({...await importOriginal<object>(),verifyQueryIdentity:async()=>({actorId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',effectiveUserId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',expiresAt:Date.now()+3600000})}));
import {handleQueryCapabilities} from '../capabilities';
const allowed={allowed:true,access_policy:'admin-only/1',actor_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',effective_user_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',session_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',policy_version:'test',permission_revision:'a'.repeat(64),fields:[],all_submarkets:true,submarkets:[],future_policy:'future-observation/1',all_future_supplies:true,future_supply_ids:[],capabilities:['query:future-catalog','query:catalog']};
const keys={keyId:'test',encryptionKey:new Uint8Array(32).fill(1),digestKey:new Uint8Array(32).fill(2)};
async function run(data:unknown,error:unknown=null){
 const rpc=vi.fn((name:string)=>({abortSignal:async()=>({data:name==='ai_query_authority'?{allowed:false}:data,error:name==='ai_query_authority'?null:error})}));
 return handleQueryCapabilities(new Request('http://localhost/api/intelligence/query/capabilities'),{client:{rpc} as unknown as SupabaseClient,enabled:true,keys});
}
describe('capability examples require current resource scope and the admin policy',()=>{
 it('offers only future catalog examples when stock scope is absent even if its capability string exists',async()=>{
  const response=await run(allowed),body=await response.json();expect(response.status).toBe(200);expect(body.enabled).toBe(true);expect(body.examples).toEqual(['CBD未来供应有哪些','CBD未来供应预计时间精度']);
 });
 it('does not turn declined authority into an enabled entry',async()=>{
  const response=await run({allowed:false});expect(response.status).toBe(403);expect(await response.json()).toEqual({enabled:false,examples:[]});
 });
 it('does not enable a future entry for old policies or lookup failures',async()=>{
  for(const [data,error] of [[{...allowed,access_policy:'old'},null],[null,{code:'unavailable'}]]){
   const response=await run(data,error);expect(response.status).toBe(503);expect(await response.json()).toEqual({enabled:false,examples:[]});
  }
 });
});
