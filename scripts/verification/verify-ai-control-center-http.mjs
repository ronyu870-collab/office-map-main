// Focused rerun on the SAME already-initialized disposable stack and production
// build. CI still runs the complete verify-ai-query-auth suite without skips.
import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { readFile,writeFile,open,mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { verifyAiControlCenter } from './ai-control-center-scenarios.mjs';
assert.equal(process.env.AI_QUERY_AUTH_ALLOW_LOCAL,'disposable');
const settings=JSON.parse(await readFile(process.env.AI_QUERY_AUTH_STATUS,'utf8'));
for(const [url,port] of [[settings.API_URL,'55991'],[settings.DB_URL,'55992']]){const parsed=new URL(url);assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.port,port);}
const db=new pg.Client({connectionString:settings.DB_URL});await db.connect();
const service=createClient(settings.API_URL,settings.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),people=[],results=[];
await mkdir('verification/ai-control-center',{recursive:true});const log=await open('verification/ai-control-center/next-focused.log','w',0o600);
const app='http://127.0.0.1:3289';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3289'],{cwd:process.cwd(),env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:settings.API_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:settings.ANON_KEY,SUPABASE_SECRET_KEY:settings.SERVICE_ROLE_KEY,AI_QUERY_AUDIT_KEY_ID:'synthetic-focused',AI_QUERY_AUDIT_ENCRYPTION_KEY:randomBytes(32).toString('hex'),AI_QUERY_AUDIT_DIGEST_KEY:randomBytes(32).toString('hex'),AI_QUERY_HTTP_ENABLED:'true',DEEPSEEK_API_KEY:'',OPENAI_API_KEY:''},stdio:['ignore',log.fd,log.fd]});
try{
 const start=Date.now();while(true){try{if((await fetch(app+'/api/intelligence/management')).status===405)break;}catch{}if(Date.now()-start>30000)throw new Error('local Next startup timeout');await new Promise(r=>setTimeout(r,100));}
 const person=async(role,label)=>{const email=`synthetic-${label}-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url')+'aA1!';const created=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'合成管理 '+label}});assert.equal(created.error,null);const id=created.data.user.id;people.push(id);await db.query('update public.user_roles set role=$1 where user_id=$2',[role,id]);const client=createClient(settings.API_URL,settings.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),signed=await client.auth.signInWithPassword({email,password});assert.equal(signed.error,null);const token=signed.data.session.access_token,sessionId=JSON.parse(Buffer.from(token.split('.')[1],'base64url')).session_id;return {id,client,token,sessionId};};
 const check=async(scenario,fn)=>{await fn();results.push({scenario,status:'passed'});console.log('PASS '+scenario);};
 await verifyAiControlCenter({db,app,check,person});
 await writeFile('verification/ai-control-center/auth-http-results.json',JSON.stringify({database:'PostgreSQL 17 disposable',authentication:'real GoTrue',server:'Next production build',paidCalls:0,scope:'focused control HTTP regression; not full suite replacement',results},null,2));
}finally{if(server.exitCode===null){const stopped=once(server,'exit');server.kill('SIGTERM');await stopped;}for(const id of people)await service.auth.admin.deleteUser(id);await db.end();await log.close();}
