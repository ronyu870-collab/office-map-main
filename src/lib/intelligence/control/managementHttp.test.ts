import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const {identity}=vi.hoisted(()=>({identity:vi.fn()}));
vi.mock('../query/serverAuthority',()=>({verifyQueryIdentity:identity}));
import { handleManagement } from './managementHttp';
const actorId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const state={version:null,revision:crypto.randomUUID(),paused:false,disabled_providers:[],disabled_models:[],changed_at:new Date().toISOString()};
const current=(capabilities=['operations:read'])=>({allowed:true,capabilities,state,config:null,models:[],drafts:[]});
const request=(input:unknown,headers:Record<string,string>={})=>new Request('https://example.invalid/api/intelligence/management',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(input)});
const dependencies=(answer:(name:string,args:Record<string,unknown>)=>unknown)=>({client:{rpc:vi.fn((name,args)=>({abortSignal:async()=>({data:answer(name,args),error:null})}))} as unknown as SupabaseClient,digestKey:new Uint8Array(32).fill(2)});
beforeEach(()=>{identity.mockResolvedValue({actorId,effectiveUserId:actorId,sessionId,expiresAt:Date.now()+3600000});});
afterEach(()=>vi.restoreAllMocks());
describe('management HTTP trusted boundary',()=>{
 it('never accepts a client operator, raw model endpoint, arbitrary SQL or unconfirmed paid test',async()=>{
  for(const input of [{action:'read',actorId},{action:'simulate',question:'你好',url:'https://foreign.invalid'},{action:'query',sql:'select 1'},{action:'test_run',modelId:'ds',expectedRevision:crypto.randomUUID(),kind:'connection',confirmed:false,maxUsd:.001,reason:'synthetic'}]){
   const deps=dependencies(()=>current());expect((await handleManagement(request(input),deps)).status).toBe(400);expect(deps.client.rpc).not.toHaveBeenCalled();
  }
 });
 it('rejects cross origin and oversized or overlong range inputs before querying operational data',async()=>{
  const deps=dependencies(()=>current());expect((await handleManagement(request({action:'read'},{Origin:'https://other.invalid'}),deps)).status).toBe(400);
  expect((await handleManagement(request({action:'simulate',question:'x'.repeat(30000)}),deps)).status).toBe(413);
  expect((await handleManagement(request({action:'overview',from:'2025-01-01T00:00:00Z',to:'2026-01-01T00:00:00Z'}),deps)).status).toBe(400);
  expect(vi.mocked(deps.client.rpc).mock.calls.every(c=>c[0]==='ai_control_manage')).toBe(true);
 });
 it('denies identity mismatch and a removed management qualification',async()=>{
  identity.mockResolvedValueOnce({actorId,effectiveUserId:crypto.randomUUID(),sessionId,expiresAt:Date.now()+10000});expect((await handleManagement(request({action:'read'}),dependencies(()=>current()))).status).toBe(401);
  expect((await handleManagement(request({action:'read'}),dependencies(()=>({allowed:false})))).status).toBe(403);
 });
 it('rechecks the exact operational permission before delivery even when another management qualification remains',async()=>{
  let reads=0;const deps=dependencies((name)=>name==='ai_control_manage'?current(++reads===1?['operations:read']:['models:write']):{allowed:true,asOf:new Date().toISOString(),items:[],hasMore:false});
  const response=await handleManagement(request({action:'tasks',from:new Date(Date.now()-60000).toISOString(),to:new Date().toISOString()}),deps);
  expect(response.status).toBe(403);expect(await response.json()).toEqual({status:'denied'});expect(reads).toBe(2);
 });
 it('uses the actual production router for fixed offline evaluations without a paid adapter or arbitrary executor',async()=>{
  const deps=dependencies((name,args)=>name==='ai_control_admin'?{allowed:true,run:{summary:(args.p_input as {summary:unknown}).summary}}:current());const response=await handleManagement(request({action:'evaluate'}),deps);expect(response.status).toBe(200);
  const body=await response.json();expect(body.data.run.summary.paidCalls).toBe(0);expect(body.data.run.summary.results.every((r:{state:string})=>r.state==='offline_passed')).toBe(true);
  expect(vi.mocked(deps.client.rpc).mock.calls.map(c=>c[0])).toEqual(['ai_control_manage','ai_control_admin','ai_control_manage']);
 });
});
