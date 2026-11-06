import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { OWNER, OTHER, ADMIN } from '../lease-change-history/database.mjs';

export async function gatewayDrill(db, issue, test) {
  const role=`gateway_probe_${randomBytes(8).toString('hex')}`;
  const password=randomBytes(32).toString('hex');
  const secret=randomBytes(48).toString('hex');
  const portServer=createServer();portServer.listen(0,'127.0.0.1');await once(portServer,'listening');
  const port=portServer.address().port;await new Promise((resolve,reject)=>portServer.close(e=>e?reject(e):resolve()));
  const url=`http://127.0.0.1:${port}`;
  let server;
  const token=(uid)=>{
    const part=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
    const value=`${part({alg:'HS256',typ:'JWT'})}.${part({role:'authenticated',sub:uid,email:`${uid.slice(0,8)}@synthetic.invalid`,exp:Math.floor(Date.now()/1000)+300})}`;
    return `${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`;
  };
  const client=(uid)=>createClient(url,'synthetic-publishable',{
    accessToken:async()=>token(uid),
    global:{fetch:(input,options)=>{
      // Only adapt Supabase's /rest/v1 route prefix to standalone PostgREST.
      // No response or database result is stubbed.
      const target=new URL(input);assert.equal(target.origin,url);
      assert.ok(target.pathname.startsWith('/rest/v1/'));
      target.pathname=target.pathname.slice('/rest/v1'.length);
      return fetch(target,options);
    }},
  });
  try {
    await db.setup.query(`create role ${role} login noinherit password '${password}';grant anon,authenticated,service_role to ${role}`);
    server=spawn(process.env.POSTGREST_PATH||'postgrest',[],{
      env:{PATH:process.env.PATH,PGRST_DB_URI:`postgresql://${role}:${password}@127.0.0.1:${process.env.LEASE_TEST_PG_PORT}/${db.database}`,
        PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,
        PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(port)},
      stdio:['ignore','ignore','pipe'],
    });
    server.stderr.resume();let startError;server.on('error',e=>{startError=e;});
    let ready=false;
    for(let i=0;i<100;i++){
      if(startError)throw new Error('POSTGREST_START_FAILED');
      if(server.exitCode!==null)throw new Error('POSTGREST_EARLY_EXIT');
      try{const r=await fetch(url,{signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(ready,'Actual PostgREST is required');
    await test('actual Supabase SDK → PostgREST JWT → PG preserves feedback reply/read/reopen',async()=>{
      const owner=client(OWNER),admin=client(ADMIN);
      assert.equal((await owner.rpc('feedback_mark_read',{p_issue_id:issue})).error,null);
      const reply=await admin.rpc('feedback_admin_reply',{p_issue_id:issue,p_content:'Gateway synthetic reply',p_images:[],p_next_status:'resolved'});
      assert.equal(reply.error,null);assert.equal(reply.data.status,'resolved');
      const reopen=await owner.rpc('feedback_reopen',{p_issue_id:issue,p_message:'Gateway follow-up'});
      assert.equal(reopen.error,null);assert.equal(reopen.data.status,'open');
      const read=await owner.from('admin_issues').select('id,status,created_by').eq('id',issue).single();
      assert.equal(read.error,null);assert.equal(read.data.status,'open');
      assert.equal((await db.setup.query("select count(*)::int n from public.admin_issue_comments where content='Gateway synthetic reply'")).rows[0].n,1);
    });
    await test('actual gateway rejects another owner and invalid JWT without writes',async()=>{
      const count=(await db.setup.query('select count(*)::int n from public.admin_issue_reads')).rows[0].n;
      const denied=await client(OTHER).rpc('feedback_mark_read',{p_issue_id:issue});assert.equal(denied.error.code,'42501');
      const invalid=await fetch(`${url}/rpc/feedback_mark_read`,{method:'POST',headers:{Authorization:'Bearer invalid-synthetic-token','Content-Type':'application/json'},body:JSON.stringify({p_issue_id:issue})});
      assert.equal(invalid.status,401);
      assert.equal((await db.setup.query('select count(*)::int n from public.admin_issue_reads')).rows[0].n,count);
    });
  } finally {
    if(server&&server.exitCode===null){const stopped=once(server,'exit');server.kill('SIGTERM');await stopped;}
    await db.setup.query(`drop owned by ${role};drop role if exists ${role}`).catch(()=>{});
  }
}
