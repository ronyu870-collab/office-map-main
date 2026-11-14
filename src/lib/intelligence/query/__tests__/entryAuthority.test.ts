import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {loadEntryAuthority,loadOperationAuthority} from '../entryAuthority';
import {resolveBusinessQuestion} from '../question';
import {parseQueryPlan} from '../plan';
import {authorizePlan} from '../admission';
const identity={actorId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',effectiveUserId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',expiresAt:Date.now()+3600000};
const common={allowed:true,access_policy:'admin-only/1',actor_id:identity.actorId,effective_user_id:identity.effectiveUserId,session_id:identity.sessionId,policy_version:'test',permission_revision:'a'.repeat(64),fields:[],all_submarkets:true,submarkets:[]};
const future={...common,future_policy:'future-observation/1',capabilities:['query:future-catalog','query:future-progress'],all_future_supplies:true,future_supply_ids:[]};
const stock={...common,capabilities:['query:catalog'],all_buildings:true,building_ids:[]};
const signal=()=>new AbortController().signal;
const client=(stockData:unknown,futureData:unknown,error:unknown=null)=>({rpc:vi.fn((name:string)=>({abortSignal:async()=>({data:name==='ai_query_authority'?stockData:futureData,error:name==='ai_query_authority'?error:null})}))});
const plan=parseQueryPlan({operation:'future_observation',view:'catalog',period:null,scope:{inventory:'future'}});
describe('admin-only independent resource entry',()=>{
 it('allows a future-only admin without fabricating stock scope or querying stock for a future plan',async()=>{
  const c=client({allowed:false},future),a=await loadEntryAuthority(c as unknown as SupabaseClient,identity,signal());
  expect(a.allBuildings).toBe(false);expect(a.buildingIds).toEqual([]);expect(a.allFutureSupplies).toBe(true);expect(()=>authorizePlan(plan,a)).not.toThrow();
  expect(()=>authorizePlan(parseQueryPlan({operation:'list',fields:[],period:null,scope:{inventory:'tracked'}}),a)).toThrow('QUERY_DENIED');
  c.rpc.mockClear();await loadOperationAuthority(c as unknown as SupabaseClient,identity,signal(),plan);expect(c.rpc.mock.calls.map(c=>c[0])).toEqual(['ai_query_future_authority']);
 });
 it('does not turn a failed or incompatible stock lookup into future admission',async()=>{
  for(const [data,error] of [[null,{code:'network'}],[{...stock,access_policy:'old'},null]]){
   const c=client(data,future,error);await expect(loadEntryAuthority(c as unknown as SupabaseClient,identity,signal())).rejects.toThrow('QUERY_AUTHORITY_UNAVAILABLE');expect(c.rpc).toHaveBeenCalledTimes(1);
  }
 });
 it('rejects denied, pre-admin-policy and identity-mismatched future authorities',async()=>{
  for(const data of [{allowed:false},{...future,access_policy:'old'},{...future,effective_user_id:identity.sessionId}]){
   const c=client({allowed:false},data);await expect(loadEntryAuthority(c as unknown as SupabaseClient,identity,signal())).rejects.toThrow();
  }
 });
 it('keeps future permission separate when stock access exists',async()=>{
  const c=client(stock,{allowed:false});const a=await loadEntryAuthority(c as unknown as SupabaseClient,identity,signal());
  expect(a.allFutureSupplies).toBe(false);expect(()=>authorizePlan(plan,a)).toThrow('QUERY_DENIED');
  await expect(loadOperationAuthority(c as unknown as SupabaseClient,identity,signal(),plan)).rejects.toThrow('QUERY_DENIED');
 });
 it('parses all future views with explicit/configured periods and never mixes stock ids',()=>{
  for(const [action,view] of Object.entries({填报进度:'summary',填报明细:'buildings',哪些楼还没填:'missing',未分配楼宇:'unassigned',人员填报进度:'people',谁还没填:'missing_people',填报数据质量:'quality',填报缺项:'missing_fields',填报异常:'anomalies'})){
   expect(resolveBusinessQuestion(`2026Q3CBD未来供应${action}`)).toMatchObject({kind:'plan',plan:{operation:'future_observation',view,period:{year:2026,quarter:3},scope:{inventory:'future',submarkets:['CBD']}}});
   expect(resolveBusinessQuestion(`当前填报季度CBD未来供应${action}`)).toMatchObject({kind:'plan',plan:{view,period:null}});
  }
  expect(resolveBusinessQuestion('全部获权未来供应有哪些')).toMatchObject({kind:'plan',plan:{view:'catalog',scope:{inventory:'future'}}});
  expect(resolveBusinessQuestion('CBD未来供应预计时间精度')).toMatchObject({kind:'plan',plan:{view:'launch_summary',period:null}});
  expect(resolveBusinessQuestion('上季度CBD未来供应填报进度',new Date('2026-11-14T00:00:00Z'))).toMatchObject({kind:'plan',plan:{period:{year:2026,quarter:3}}});
  for(const question of ['CBD未来供应有哪些并给我联系方式','2026Q5CBD未来供应填报进度','CBD未来供应有哪些排除半年不明的','2026Q3CBD未来供应有哪些'])expect(resolveBusinessQuestion(question).kind).toBe('clarification');
  expect(()=>parseQueryPlan({...plan,scope:{inventory:'future',buildingIds:[identity.actorId]}})).toThrow();
  expect(()=>parseQueryPlan({...plan,period:{year:2026,quarter:3}})).toThrow();
 });
});
