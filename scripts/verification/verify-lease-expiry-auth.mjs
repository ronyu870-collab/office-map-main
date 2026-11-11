/** Real local GoTrue + PostgREST + PostgreSQL + Next route integration. No auth or HTTP mocks.
 * Start a dedicated empty Supabase CLI project named f6-auth-integration first.
 * F6_AUTH_TEST_ALLOW_LOCAL=disposable F6_LOCAL_SUPABASE_STATUS=/private/path/status.json node ...
 * Only loopback endpoints are accepted. Credentials/tokens never enter result artifacts.
 */
import assert from 'node:assert/strict';
import { leaseServiceBrowserBundle } from './lease-service-browser.mjs';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
const require=createRequire(import.meta.url);
assert.equal(process.env.F6_AUTH_TEST_ALLOW_LOCAL,'disposable');
const settings=JSON.parse(await readFile(process.env.F6_LOCAL_SUPABASE_STATUS,'utf8'));
const url=new URL(settings.API_URL),dbUrl=new URL(settings.DB_URL);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55791');assert.equal(dbUrl.hostname,'127.0.0.1');assert.equal(dbUrl.port,'55792');
const root=process.cwd(), output=path.join(root,'verification/lease-expiry-auth');await mkdir(output,{recursive:true});
const results=[];const pass=(scenario,detail)=>{results.push({scenario,status:'passed',detail});console.log('PASS '+scenario);};
const load=file=>readFile(path.join(root,file),'utf8');
const db=new pg.Client({connectionString:settings.DB_URL});await db.connect();
const second=new pg.Client({connectionString:settings.DB_URL});await second.connect();
const blocker=new pg.Client({connectionString:settings.DB_URL});await blocker.connect();
for(const client of [db,second,blocker])await client.query("set statement_timeout='15s'");
const superClient=createClient(settings.API_URL,settings.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const people=[],sources=[],liveSources=[];let server,browser;const app='http://127.0.0.1:3287';
const pause=ms=>new Promise(done=>setTimeout(done,ms));
async function until(fn,label,timeout=90000){const start=Date.now();for(;;){if(await fn())return;if(Date.now()-start>timeout)throw new Error('Timed out: '+label);await pause(250);}}
async function call(person,method='GET',body,headers={}){
 const response=await fetch(app+'/api/intelligence/lease-expiry',{method,headers:{...(person?{Authorization:'Bearer '+person.token}:{}),'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,body:await response.json()};
}
async function freshPerson(role,label){
 const password=randomBytes(24).toString('base64url')+'aA1!';const email=`f6-${label}-${randomUUID().slice(0,8)}@example.invalid`;
 const {data,error}=await superClient.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'合成联调 '+label}});if(error)throw new Error('Create local Auth account: '+error.message);
 const person={id:data.user.id,email,password,phone:'19900000001',role};people.push(person);
 await db.query('update public.user_roles set role=$1,phone=$2,chinese_name=$3 where user_id=$4',[role,person.phone,'合成联调 '+label,person.id]);
 const client=createClient(settings.API_URL,settings.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const login=await client.auth.signInWithPassword({email,password});assert.equal(login.error,null);assert.ok(login.data.session?.access_token);
 person.client=client;person.token=login.data.session.access_token;person.sessionId=JSON.parse(Buffer.from(person.token.split('.')[1],'base64url')).session_id;
 assert.ok((await db.query('select id from auth.sessions where id=$1 and user_id=$2',[person.sessionId,person.id])).rowCount);return person;
}
async function source(label){const id=randomUUID();sources.push(id);await db.query(`insert into public.lease_transactions_history(id,source_uid,company,new_building,transaction_year,transaction_quarter,lease_term_months,period_source,source_file,source_sheet,source_row,source_lease_term_raw)
 values($1,$2,$3,'合成联调楼宇',extract(year from current_date)::int-5,'Q'||extract(quarter from current_date)::int,60,'info_date_inferred_same_year','synthetic.xlsx','联调',2,'60')`,[id,'f6-auth-'+id,'合成联调 '+label]);return id;}
async function input(person,id,revision=0){const res=await call(person);assert.equal(res.status,200);const item=res.body.items.find(item=>item.source.id===id);assert.ok(item);return {source_kind:item.source_kind,source_id:id,expected_revision:revision,source_fingerprint:item.source_fingerprint,request_id:randomUUID(),status:'missing_info',notes:'合成核实：缺起租日和原件单位',evidence_reference:'合成原件第 2 行'};}
async function persisted(id){return (await db.query(`select (select revision from public.lease_expiry_reviews where source_id=$1) revision,(select count(*)::int from public.lease_expiry_review_events where source_id=$1) events,(select count(*)::int from public.audit_logs where target_id=$1::text and action_type='LEASE_EXPIRY_REVIEW_SAVE') audits`,[id])).rows[0];}
async function waitRpcLock(){await until(async()=>Boolean((await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%lease_expiry_review_save%' and pid<>pg_backend_pid() limit 1")).rowCount),'RPC row lock',10000);}
try{
 const version=(await db.query('select version() v')).rows[0].v;assert.match(version,/PostgreSQL 17\./);
 if(!(await db.query("select to_regclass('public.lease_expiry_reviews') r")).rows[0].r){
  assert.equal((await db.query("select to_regclass('public.user_roles') r")).rows[0].r,null,'This harness only initializes its dedicated EMPTY local project');
  await db.query(await load('supabase/migrations/20260730043721_create_colliers_lite_schema.sql'));
  const fixture=await load('supabase/tests/lease-expiry/fixture.sql');
  const history=fixture.slice(fixture.indexOf('create table public.lease_transactions_history'),fixture.indexOf('create table public.audit_logs')).replace('submitter_id uuid','submitter_id varchar');
  await db.query(history);
  await db.query('alter table public.lease_transactions_history enable row level security; revoke all on public.lease_transactions_history from anon,authenticated; grant select on public.lease_transactions_history to service_role;');
  await db.query(await load('supabase/migrations/20260915061154_append_project_association_fields_to_lease_read_v1.sql'));
  const auditContext=await load('supabase/migrations/20260909065734_extend_audit_log_context.sql');await db.query(auditContext.slice(0,auditContext.indexOf('create or replace function public.admin_get_auth_audit_logs')));
  await db.query(await load('supabase/migrations/20261102063824_audit_actor_identity.sql'));
  await db.query(await load('supabase/migrations/20261111034942_lease_expiry_review_workspace.sql'));
 }
 if(!(await db.query("select to_regclass('public.auth_session_audit_context') r")).rows[0].r){
  await db.query(await load('supabase/migrations/20260909084827_fix_auth_audit_session_context.sql'));
  await db.query(await load('supabase/migrations/20260909084927_sync_auth_session_audit_context.sql'));
 }
 if(!(await db.query("select 1 from information_schema.columns where table_schema='public' and table_name='lease_expiry_reviews' and column_name='source_kind'")).rowCount) await db.query(await load('supabase/migrations/20261111055947_lease_expiry_live_sources.sql'));
 await db.query("notify pgrst,'reload schema'");await pause(1500);
 const admin=await freshPerson('admin','admin-a'),other=await freshPerson('admin','admin-b'),editor=await freshPerson('editor','editor'),viewer=await freshPerson('viewer','viewer');
 pass('真实 Auth 登录与会话落库',{roles:['admin A','admin B','editor','viewer'],database:version});
 const log=await open(path.join(output,'next-local.log'),'w',0o600);
 const appEnv={...process.env,NEXT_PUBLIC_SUPABASE_URL:settings.API_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:settings.ANON_KEY,SUPABASE_SECRET_KEY:settings.SERVICE_ROLE_KEY,LEASE_EXPIRY_REVIEW_ENABLED:'true',DEEPSEEK_API_KEY:'',NEXT_PUBLIC_AMAP_KEY:'',NEXT_PUBLIC_AMAP_SECURITY_CODE:''};
 const build=spawn('npm',['run','build'],{cwd:root,env:appEnv,stdio:['ignore',log.fd,log.fd]});
 await new Promise((resolve,reject)=>{build.on('error',reject);build.on('exit',code=>code===0?resolve():reject(new Error('Local production build failed; inspect private next-local.log')));});
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3287'],{cwd:root,env:appEnv,stdio:['ignore',log.fd,log.fd]});
 await until(async()=>{try{return (await fetch(app+'/api/intelligence/lease-expiry')).status===401;}catch{return false;}},'Next API ready');
 const id=await source('主要样本'),draft=await input(admin,id);
 assert.equal((await call(null)).status,401);for(const denied of [editor,viewer]){assert.equal((await call(denied)).status,403);assert.equal((await call(denied,'POST',draft)).status,403);}
 assert.equal((await call(admin,'GET',null,{'X-Colliers-Impersonate-User':editor.id})).status,403);
 assert.equal((await call(admin,'POST',draft,{'X-Colliers-Impersonate-User':other.id})).status,403);
 pass('真实角色、匿名及用户模拟的读取／保存边界');
 await viewer.client.auth.updateUser({data:{role:'admin'}});assert.equal((await call(viewer)).status,403);
 const upgrade=await viewer.client.from('user_roles').update({role:'admin'}).eq('user_id',viewer.id);assert.ok(upgrade.error);
 for(const client of [admin.client,editor.client,viewer.client]){
  const direct=await client.from('lease_expiry_reviews').select('*');assert.ok(direct.error);
  const rpc=await client.rpc('lease_expiry_review_list',{p_actor:admin.id,p_as_of:new Date().toISOString().slice(0,10)});assert.ok(rpc.error);
 }
 pass('篡改用户 metadata、目录角色和直接 Data API／RPC 均不能提权');
 const first=await call(admin,'POST',draft);assert.equal(first.status,200);assert.equal(first.body.revision,1);
 const replay=await call(admin,'POST',draft);assert.deepEqual(replay,first);
 const changed=await call(admin,'POST',{...draft,notes:'键相同但内容不同'});assert.equal(changed.status,409);
 assert.equal((await db.query('select count(*)::int n from public.lease_expiry_review_events where source_id=$1',[id])).rows[0].n,1);
 const audit=(await db.query("select actor_kind,actor_name from public.audit_logs where target_id=$1 and action_type='LEASE_EXPIRY_REVIEW_SAVE'",[id])).rows;assert.equal(audit.length,1);assert.equal(audit[0].actor_kind,'user');assert.equal(audit[0].actor_name,'合成联调 admin-a');
 pass('HTTP 保存、回读、内容绑定重试及真实审计身份快照');
 const next=await input(admin,id,1);const race=await Promise.all([call(admin,'POST',next),call(other,'POST',{...next,request_id:randomUUID(),notes:'另一位管理员核实'})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 const freshId=await source('首次并发'),freshDraft=await input(admin,freshId);const firstRace=await Promise.all([call(admin,'POST',freshDraft),call(other,'POST',{...freshDraft,request_id:randomUUID()})]);assert.deepEqual(firstRace.map(r=>r.status).sort(),[200,409]);
 const idem=await input(admin,id,2);const duplicates=await Promise.all([call(admin,'POST',idem),call(admin,'POST',idem)]);assert.equal(duplicates[0].status,200);assert.deepEqual(duplicates[0],duplicates[1]);
 pass('两个真实管理员同时修改／首次创建，以及同请求并发重试');
 const stale=await input(admin,id,3);await db.query("update public.lease_transactions_history set source_lease_term_raw='60（来源变更）' where id=$1",[id]);assert.equal((await call(admin,'POST',stale)).status,409);
 await db.query("update public.lease_transactions_history set source_lease_term_raw='60' where id=$1",[id]);pass('加载后来源变化阻止旧依据保存');
 // A committed withdrawal must defeat an already issued JWT, including idempotent retries.
 const beforeDenied=await persisted(id);
 await db.query("update public.user_roles set role='viewer' where user_id=$1",[admin.id]);assert.equal((await call(admin)).status,403);assert.equal((await call(admin,'POST',draft)).status,403);await db.query("update public.user_roles set role='admin' where user_id=$1",[admin.id]);
 assert.deepEqual(await persisted(id),beforeDenied);
 pass('撤权后原 JWT 读取、保存、已成功请求重放都拒绝');
 // Withdrawal starts first: API may see the old committed role, RPC must wait and recheck.
 await blocker.query('begin');await blocker.query("update public.user_roles set role='viewer' where user_id=$1",[admin.id]);
 const pending=call(admin,'POST',{...stale,request_id:randomUUID()});await waitRpcLock();await blocker.query('commit');assert.equal((await pending).status,403);await db.query("update public.user_roles set role='admin' where user_id=$1",[admin.id]);
 assert.deepEqual(await persisted(id),beforeDenied);
 pass('撤权事务先开始：已在途保存等待后拒绝，不落草稿或审计');
 // Save locks identity first: withdrawal waits for that atomic save; all later calls are denied.
 await blocker.query('begin');await blocker.query('select id from public.lease_transactions_history where id=$1 for update',[id]);
 const inFlight=call(admin,'POST',{...stale,request_id:randomUUID()});await waitRpcLock();
 let withdrawn=false;const withdraw=second.query("update public.user_roles set role='viewer' where user_id=$1",[admin.id]).then(()=>{withdrawn=true;});await pause(200);assert.equal(withdrawn,false);await blocker.query('commit');assert.equal((await inFlight).status,200);await withdraw;assert.equal((await call(admin)).status,403);await db.query("update public.user_roles set role='admin' where user_id=$1",[admin.id]);
 assert.deepEqual(await persisted(id),{revision:beforeDenied.revision+1,events:beforeDenied.events+1,audits:beforeDenied.audits+1});
 pass('保存先取得权限锁：完整提交后撤权生效，后续请求拒绝');
 const ban=await superClient.auth.admin.updateUserById(other.id,{ban_duration:'1h'});assert.equal(ban.error,null);assert.ok([401,403].includes((await call(other)).status));assert.ok([401,403].includes((await call(other,'POST',draft)).status));await superClient.auth.admin.updateUserById(other.id,{ban_duration:'none'});
 pass('真实 Auth 封禁立即阻断已有令牌');
 const logout=await freshPerson('admin','logout');assert.equal((await call(logout)).status,200);const signedOut=await superClient.auth.admin.signOut(logout.token,'global');assert.equal(signedOut.error,null);assert.equal((await db.query('select id from auth.sessions where id=$1',[logout.sessionId])).rowCount,0);
 const afterLogout=await call(logout);assert.ok([401,403].includes(afterLogout.status),`REVOKED_SESSION_ACCEPTED: ${afterLogout.status}`);pass('服务端退出会话后旧 JWT 无法访问');
 const deleted=await freshPerson('admin','deleted');await superClient.auth.admin.deleteUser(deleted.id);assert.ok([401,403].includes((await call(deleted)).status));pass('删除测试账号后旧 JWT 无法访问');
 if(process.env.PERF_PLAYWRIGHT_MODULE){
  const {chromium}=require(process.env.PERF_PLAYWRIGHT_MODULE);browser=await chromium.launch({headless:true,channel:process.env.PERF_BROWSER_CHANNEL||undefined});
  const browserUser=await freshPerson('admin','browser');const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(60000);page.on('pageerror',error=>{results.push({scenario:'browser runtime',status:'error',error:error.message});process.exitCode=1;});
  await page.goto(app+'/login');await page.waitForFunction(()=>{const form=document.querySelector('form');return form && Object.keys(form).some(k=>k.startsWith('__reactProps$') && typeof form[k]?.onSubmit==='function');});await page.getByLabel('企业邮箱').fill(browserUser.email);await page.getByLabel('手机号').fill(browserUser.phone);await page.getByLabel('密码',{exact:true}).fill(browserUser.password);await page.getByRole('button',{name:/登录/}).click();await page.waitForURL(app+'/');
  const serviceBundle=await leaseServiceBrowserBundle(root,settings);
  await page.addScriptTag({content:serviceBundle});
  const submitted=await page.evaluate(async userId=>{
    const now=new Date();return window.F6ActualSubmission.submitTransaction({company:'合成日常填报接入',new_building:'合成日常楼宇',transaction_year:now.getUTCFullYear(),transaction_quarter:'Q'+(Math.floor(now.getUTCMonth()/3)+1),lease_term_months:3,area_sqm:100,face_rent:100,effective_rent:90,is_manual_building:true,submitter_id:userId,submitter_name:'合成联调 browser'});
  },browserUser.id);
  assert.equal(submitted.success,true,submitted.error);const liveId=submitted.data.id;liveSources.push(liveId);
  assert.equal(submitted.data.transaction_date,null);assert.equal(submitted.data.lease_term_months,3);
  let live=(await call(browserUser)).body.items.find(item=>item.source.id===liveId&&item.source_kind==='live');assert.ok(live);assert.equal(live.review,null);
  assert.equal((await call(viewer)).status,403);
  await page.goto(app+'/intelligence/lease-expiry');await page.getByRole('button',{name:/合成日常填报接入/}).click();
  await page.getByText('系统内日常成交填报，按最新已保存数据计算',{exact:true}).waitFor();
  await page.getByText('补充资料或标记问题（可选）',{exact:true}).click();await page.getByLabel('补充备注').fill('合成日常成交的补充记录');await page.getByRole('button',{name:'保存补充记录',exact:true}).click();await page.getByText('补充记录已保存，预计到期区间仍按成交数据计算。').waitFor();
  await page.reload();await page.getByRole('button',{name:/合成日常填报接入/}).click();await page.getByText('补充资料或标记问题（可选）',{exact:true}).click();assert.equal(await page.getByLabel('补充备注').inputValue(),'合成日常成交的补充记录');
  live=(await call(browserUser)).body.items.find(item=>item.source.id===liveId&&item.source_kind==='live');assert.equal(live.review.revision,1);
  await page.addScriptTag({content:serviceBundle});
  const modified=await page.evaluate(async p=>window.F6ActualSubmission.updateTransaction(p.id,{lease_term_months:4},p.user,p.updatedAt),{id:liveId,user:browserUser.id,updatedAt:submitted.data.updated_at});assert.equal(modified.success,true,modified.error);
  const changed=(await call(browserUser)).body.items.find(item=>item.source.id===liveId&&item.source_kind==='live');assert.notEqual(changed.proxy_start,live.proxy_start);assert.equal(changed.source.lease_term_months,4);
  assert.equal((await call(browserUser,'POST',{source_kind:'live',source_id:liveId,expected_revision:1,source_fingerprint:live.source_fingerprint,request_id:randomUUID(),status:'pending',notes:'旧依据',evidence_reference:''})).status,409);
  const removed=await page.evaluate(async id=>{const {error}=await window.F6ActualSubmission.getSupabaseClient().from('lease_transactions').delete().eq('id',id);return error?.message??null;},liveId);assert.equal(removed,null);
  assert.ok(!(await call(browserUser)).body.items.some(item=>item.source.id===liveId&&item.source_kind==='live'));
  await page.reload();await page.getByLabel('范围').selectOption('saved');await page.getByRole('button',{name:/合成日常填报接入/}).click();await page.getByText('原成交已删除，以下为已存补充记录，不再参与预计到期计算。',{exact:true}).waitFor();await page.getByText('补充资料或标记问题（可选）',{exact:true}).click();assert.equal(await page.getByRole('button',{name:'保存补充记录',exact:true}).isDisabled(),true);assert.equal(await page.getByLabel('补充备注').inputValue(),'合成日常成交的补充记录');
  assert.equal((await db.query("select count(*)::int n from public.lease_expiry_review_events where source_kind='live' and source_id=$1",[liveId])).rows[0].n,1);
  pass('实际日常填报服务→真实写入→自动入选→浏览器补充回读→修改重算→删除后只读保留');
  await page.goto(app+'/intelligence/lease-expiry');await page.getByRole('button',{name:/合成联调 主要样本/}).click();await page.getByText('补充资料或标记问题（可选）',{exact:true}).click();await page.mouse.move(640,600);await page.mouse.wheel(0,10000);await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='保存补充记录')?.getBoundingClientRect();return b&&b.top>=0&&b.bottom<=innerHeight;});await page.getByLabel('补充备注').fill('真实登录浏览器核实，仍缺起租日');await page.getByRole('button',{name:'保存补充记录',exact:true}).click();await page.getByText('补充记录已保存，预计到期区间仍按成交数据计算。').waitFor();await page.reload();await page.getByRole('button',{name:/合成联调 主要样本/}).click();await page.getByText('补充资料或标记问题（可选）',{exact:true}).click();assert.equal(await page.getByLabel('补充备注').inputValue(),'真实登录浏览器核实，仍缺起租日');
  await page.screenshot({path:path.join(output,'real-login-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.mouse.move(195,600);await page.mouse.wheel(0,10000);await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='保存补充记录')?.getBoundingClientRect();return b&&b.top>=0&&b.bottom<=innerHeight;});await page.screenshot({path:path.join(output,'real-login-mobile.png'),fullPage:true});
  await db.query("update public.user_roles set role='viewer' where user_id=$1",[browserUser.id]);const deniedResponse=page.waitForResponse(res=>res.url().includes('/api/intelligence/lease-expiry')&&res.status()===403);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await deniedResponse;await page.getByLabel('补充备注').waitFor({state:'detached'});assert.equal(await page.getByLabel('补充备注').count(),0);pass('实际登录页→Auth→页面→RPC 保存回读；撤权后清空浏览器数据');
 }
}catch(error){if(browser){for(const context of browser.contexts())for(const page of context.pages()){const diagnostic=await page.evaluate(()=>({path:location.pathname,ready:document.readyState,forms:[...document.querySelectorAll('form')].map(form=>({props:Object.keys(form).filter(k=>k.startsWith('__react')),submitHandler:Object.keys(form).some(k=>k.startsWith('__reactProps$')&&typeof form[k]?.onSubmit==='function')}))})).catch(()=>null);results.push({diagnostic});}}let message=error.message;for(const person of people){message=message.replaceAll(person.password,'[test-secret]').replaceAll(person.token??'__absent__','[test-token]');}results.push({status:'failed',error:message});console.error(message);process.exitCode=1;}
finally{
 await browser?.close();if(server){server.kill('SIGTERM');await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);});}
 await blocker.query('rollback').catch(()=>{});await second.query('rollback').catch(()=>{});
 for(const person of people){await superClient.auth.admin.deleteUser(person.id).catch(()=>{});}
 // Exact UUIDs created by this run only; original fixtures and other processes are never deleted.
 if(liveSources.length){await db.query("delete from public.lease_expiry_review_events where source_kind='live' and source_id=any($1::uuid[])",[liveSources]);await db.query("delete from public.lease_expiry_reviews where source_kind='live' and source_id=any($1::uuid[])",[liveSources]);await db.query('delete from public.lease_transactions where id=any($1::uuid[])',[liveSources]);}
 if(sources.length){await db.query('delete from public.lease_expiry_review_events where source_id=any($1::uuid[])',[sources]);await db.query('delete from public.lease_expiry_reviews where source_id=any($1::uuid[])',[sources]);await db.query('delete from public.lease_transactions_history where id=any($1::uuid[])',[sources]);}
 await writeFile(path.join(output,'results.json'),JSON.stringify({environment:'loopback-only Supabase Auth + PostgREST + PostgreSQL 17 + actual Next production build',authMocks:false,accounts:'disposable test accounts; removed after run',results},null,2));
 await Promise.all([db.end(),second.end(),blocker.end()]);
}
