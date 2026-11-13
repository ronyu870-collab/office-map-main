import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const state=vi.hoisted(()=>({reads:0,mode:'progress',action:'status'}));
vi.mock('../serverAuthority',()=>({
  verifyQueryIdentity:async()=>({actorId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',effectiveUserId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',expiresAt:Date.now()+60000}),
  loadDataAuthority:async()=>({actorId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',effectiveUserId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionActive:true,policyVersion:'test',permissionRevision:'a'.repeat(64),grants:['query:catalog'],fields:[]}),
}));
vi.mock('../recovery',()=>({
  readOwnResult:async()=>{
    state.reads++;
    return {allowed:true,state:state.action==='recover'?'succeeded':state.reads===1?'running':'succeeded',
      permission_revision:state.reads>1&&state.mode==='revoked'?'b'.repeat(64):'a'.repeat(64),
      head_hash:state.reads===1?'c'.repeat(64):'d'.repeat(64),head_sequence:state.reads===1?3:4,events:[]};
  },
  recoverOwnResult:async()=>({result:{value:170},resultId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',redactionTypes:[],recheck:async()=>{}}),
}));
import { handleResultRecovery } from '../recoveryHttp';

describe('recovery state races at the HTTP boundary',()=>{
  beforeEach(()=>{state.reads=0;state.mode='progress';state.action='status';});
  const run=async()=>{
    const rpc=vi.fn(()=>({abortSignal:()=>Promise.resolve({data:{event_id:crypto.randomUUID(),sequence:1,event_hash:'a'.repeat(64),replayed:false},error:null})}));
    const request=new Request('http://localhost/api/intelligence/query/recover',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic'},body:JSON.stringify({requestId:crypto.randomUUID(),action:state.action})});
    const response=await handleResultRecovery(request,{client:{rpc} as unknown as SupabaseClient,enabled:true,keys:{keyId:'test',encryptionKey:new Uint8Array(32).fill(1),digestKey:new Uint8Array(32).fill(2)}});
    return {response,body:await response.json()};
  };
  it('does not turn normal task progress during a status poll into permission denial',async()=>{
    const {response,body}=await run();expect(response.status).toBe(200);expect(body.status).toBe('running');expect(body).not.toHaveProperty('result');
  });
  it('asks to retry a changed archived result without misreporting a permission denial',async()=>{
    state.action='recover';const {response,body}=await run();expect(response.status).toBe(409);expect(body.status).toBe('changed');expect(body).not.toHaveProperty('result');
  });
  it('still refuses a status response when the actual permission revision changed',async()=>{
    state.mode='revoked';const {response,body}=await run();expect(response.status).toBe(403);expect(body.status).toBe('denied');
  });
});
