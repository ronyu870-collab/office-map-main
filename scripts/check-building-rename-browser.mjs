// Optional local production-build browser verification. Use only the disposable
// database provided by supabase/tests/building-renames/run.mjs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const root=process.cwd(), require=createRequire(root+'/package.json');
assert.match(process.env.BUILDING_RENAME_TEST_DB??'',/^lease_synthetic_[a-f0-9]+$/);
assert.ok(process.env.LEASE_TEST_ALLOW_LOCAL==='disposable');
assert.ok(process.env.PLAYWRIGHT_MODULE && process.env.CHROME_PATH && process.env.POSTGREST_PATH);
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const admin='33333333-3333-4333-8333-333333333333',building='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const secret='synthetic_building_rename_local_jwt_secret_only';
const jwt=role=>{const e=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const raw=e({alg:'HS256',typ:'JWT'})+'.'+e({sub:admin,role,aud:'authenticated',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600});return raw+'.'+createHmac('sha256',secret).update(raw).digest('base64url');};
const token=jwt('authenticated'),anon=jwt('anon');
const dir=await mkdtemp('/private/tmp/building-rename-browser-');
const evidence=process.env.BUILDING_RENAME_BROWSER_EVIDENCE || dir+'/evidence'; await mkdir(evidence,{recursive:true});
const database=new pg.Client({host:'127.0.0.1',port:Number(process.env.LEASE_TEST_PG_PORT),user:'postgres',password:'synthetic_ci_only',database:process.env.BUILDING_RENAME_TEST_DB});
await database.connect();
const logs=[],errors=[],consoleErrors=[],external=[],results=[];
const visualPhase=process.env.BUILDING_RENAME_BROWSER_VISUAL;
const originals=new Map();
let rest,bridge,nextServer,browser,page;
const stop=async child=>{if(!child || child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});};
const wait=async(url,headers)=>{for(let i=0;i<150;i++){try{if((await fetch(url,{headers})).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('Local service not ready: '+url);};
try{
  if(visualPhase==='before') {
    for(const file of ['src/components/admin/grid/RecordFields.tsx','src/components/admin/grid/columnMapper.ts']) {
      originals.set(file,await readFile(root+'/'+file));
      await writeFile(root+'/'+file,execFileSync('git',['show','HEAD:'+file],{cwd:root}));
    }
  }
  rest=spawn(process.env.POSTGREST_PATH,[],{env:{...process.env,PGRST_DB_URI:'postgresql://postgres:synthetic_ci_only@127.0.0.1:'+process.env.LEASE_TEST_PG_PORT+'/'+process.env.BUILDING_RENAME_TEST_DB,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3494'},stdio:['ignore','pipe','pipe']});
  for(const stream of [rest.stdout,rest.stderr])stream.on('data',x=>logs.push(x.toString()));
  await wait('http://127.0.0.1:3494/buildings?limit=1',{authorization:'Bearer '+token});
  bridge=createServer(async(req,res)=>{
    const cors={'access-control-allow-origin':'http://127.0.0.1:3496','access-control-allow-headers':'authorization,apikey,content-type,prefer,x-client-info,accept,accept-profile,content-profile,range,range-unit','access-control-allow-methods':'GET,POST,PATCH,OPTIONS','access-control-expose-headers':'content-range'};
    if(req.method==='OPTIONS'){res.writeHead(204,cors);res.end();return;}
    try{
      if(req.url==='/backend/auth/v1/user'){res.writeHead(200,{...cors,'content-type':'application/json'});res.end(JSON.stringify({id:admin,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',created_at:new Date().toISOString(),app_metadata:{},user_metadata:{}}));return;}
      if(req.url.startsWith('/backend/rest/v1/')){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
        const headers={...req.headers};delete headers.host;delete headers.connection;delete headers['content-length'];
        const response=await fetch('http://127.0.0.1:3494'+req.url.replace('/backend/rest/v1',''),{method:req.method,headers,...(body.length?{body}:{} )});
        res.writeHead(response.status,{...Object.fromEntries(response.headers),...cors});res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      res.writeHead(404,cors);res.end();
    }catch(e){res.writeHead(500,{...cors,'content-type':'application/json'});res.end(JSON.stringify({message:e.message}));}
  });
  await new Promise(r=>bridge.listen(3495,'127.0.0.1',r));
  await symlink(root+'/node_modules',dir+'/node_modules','dir');
  await mkdir(dir+'/app');
  await writeFile(dir+'/package.json',JSON.stringify({name:'isolated-building-rename-browser',private:true}));
  await writeFile(dir+'/tsconfig.json',JSON.stringify({compilerOptions:{target:'ES2020',lib:['dom','esnext'],allowJs:true,skipLibCheck:true,esModuleInterop:true,module:'esnext',moduleResolution:'bundler',jsx:'preserve',baseUrl:root,paths:{'@/*':['./*']}},include:['app/**/*.tsx'],exclude:['node_modules']}));
  await writeFile(dir+'/postcss.config.mjs',await readFile(root+'/postcss.config.mjs'));
  const aliases={'@':root};
  for(const [s,t] of [['src/services/Auth','auth.ts'],['src/utils/audit','audit.ts']])
    for(const name of ['@/'+s,root+'/'+s,root+'/'+s+'.ts'])aliases[name+'$']=dir+'/'+t;
  await writeFile(dir+'/next.config.mjs','export default {typescript:{ignoreBuildErrors:true},webpack(config){config.resolve.alias={...config.resolve.alias,...'+JSON.stringify(aliases)+'};return config;}}');
  await writeFile(dir+'/auth.ts','export async function getSession(){return {user:{id:'+JSON.stringify(admin)+'},role:"admin"}};export const getSessionFast=getSession;');
  await writeFile(dir+'/audit.ts','export function logAction(){}');
  await writeFile(dir+'/app/harness.css','@import '+JSON.stringify(root+'/src/app/globals.css')+';\n@source '+JSON.stringify(root+'/src')+';\n');
  await writeFile(dir+'/app/layout.tsx','import * as React from "react";import "./harness.css";export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}');
  await writeFile(dir+'/app/page.tsx',`'use client';import * as React from 'react';import {GridPanel} from ${JSON.stringify(root+'/src/components/admin/grid/GridPanel')};import {supabase} from '@/src/services/supabaseClient';const config:any={table:'buildings',label:'隔离楼宇更名验证',filterField:'id',filterValue:${JSON.stringify(building)},uploadMatchKeys:['name'],cols:[{key:'id',label:'ID',type:'uuid',hidden:true,readOnly:true},{key:'name',label:'项目名称',type:'text',required:true,width:320,pinned:'left'},{key:'former_names',label:'曾用名',type:'tags',width:380}]};const dicts={};export default function Page(){const[ready,setReady]=React.useState(false);React.useEffect(()=>{void supabase.auth.setSession({access_token:${JSON.stringify(token)},refresh_token:'synthetic-refresh'}).then(({error})=>{if(error)throw error;setReady(true)})},[]);return <main style={{height:'100dvh',display:'flex',flexDirection:'column',padding:12}}><h1>楼宇更名隔离验证</h1>{ready&&<GridPanel config={config} dicts={dicts}/>}</main>}`);
  const env={...process.env,NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:3495/backend',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:anon};
  const next=require.resolve('next/dist/bin/next');
  const build=spawn(process.execPath,[next,'build',dir,'--webpack'],{cwd:dir,env,stdio:['ignore','pipe','pipe']});
  for(const stream of [build.stdout,build.stderr])stream.on('data',x=>logs.push(x.toString()));
  assert.equal(await new Promise(r=>build.once('exit',r)),0,'Isolated production build failed');
  nextServer=spawn(process.execPath,[next,'start',dir,'-p','3496','-H','127.0.0.1'],{cwd:dir,env,stdio:['ignore','pipe','pipe']});
  for(const stream of [nextServer.stdout,nextServer.stderr])stream.on('data',x=>logs.push(x.toString()));
  await wait('http://127.0.0.1:3496');
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
  const check=async()=>{
    const b=(await database.query('select * from public.buildings where id=$1',[building])).rows[0];
    const f=(await database.query('select * from public.future_supplies where building_id=$1',[building])).rows[0];
    assert.equal(b.name,f.name);assert.deepEqual(b.former_names,f.former_names);return b;
  };
  for(const width of [1280,390]){
    const context=await browser.newContext({viewport:{width,height:900},...(width===390?{isMobile:true,hasTouch:true}:{})});
    await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1')return route.continue();external.push(u.origin);return route.abort();});
    page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
    await page.goto('http://127.0.0.1:3496',{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'编辑',exact:true}).click();
    if(visualPhase) {
      await page.screenshot({path:evidence+'/edit-'+width+'.png',fullPage:true});
      results.push({width,case:'equivalent-data editor visual comparison',phase:visualPhase});
      await context.close();page=null;continue;
    }
    if(width===1280){
      const name=page.locator('[col-id="name"] input').last();
      const aliases=page.locator('[col-id="former_names"] textarea').last();
      await name.fill('Desktop renamed');
      await aliases.fill('Browser alias（east, west）\nBrowser legacy');
      await page.screenshot({path:evidence+'/desktop-edit.png',fullPage:true});
      await page.getByRole('button',{name:'保存',exact:true}).click();
      await page.locator('[col-id="name"]').filter({hasText:'Desktop renamed'}).first().waitFor();
      const b=await check();assert.equal(b.name,'Desktop renamed');assert.ok(b.former_names.includes('Browser alias（east, west）'));assert.ok(b.former_names.includes('UI final name'));
      results.push({width,case:'real AG Grid full-row edit, multiline aliases, save, reload',name:b.name});
    }else{
      const editor=page.getByRole('dialog',{name:'编辑记录',exact:true});
      await editor.getByLabel(/项目名称/).fill('Mobile renamed');
      await page.screenshot({path:evidence+'/mobile-edit.png',fullPage:true});
      await editor.getByRole('button',{name:'保存',exact:true}).click();
      await page.getByRole('button',{name:'Mobile renamed',exact:true}).waitFor();
      const b=await check();assert.equal(b.name,'Mobile renamed');assert.ok(b.former_names.includes('Desktop renamed'));
      results.push({width,case:'real mobile layout edit and save',name:b.name});
    }
    await page.reload({waitUntil:'networkidle'});
    assert.ok((await page.locator('body').innerText()).includes(width===1280?'Desktop renamed':'Mobile renamed'));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page horizontal overflow');
    await page.screenshot({path:evidence+'/after-'+width+'.png',fullPage:true});
    await context.close();page=null;
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  assert.ok(!consoleErrors.some(s=>s.includes('fullRowEdit')||s.includes('AG Grid: error')),'AG Grid editor compatibility error');
  await writeFile(evidence+'/results.json',JSON.stringify({browser:'Google Chrome',visualPhase:visualPhase??null,app:'actual Next production webpack of GridPanel and shared Supabase client',backend:'real PostgREST 16.5 and PostgreSQL 17; isolated synthetic JWT/auth-user endpoint; no production account',results,pageErrors:errors,consoleErrors,externalRequests:external},null,2)+'\n');
  console.log('PASS actual production browser rename checks: '+JSON.stringify(results));
}catch(e){if(page){await page.screenshot({path:evidence+'/failure.png',fullPage:true}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-3500));}throw e;
}finally{
  // Restore the isolated source before cleanup so a service cleanup error cannot
  // leave the optional baseline display code in the working tree.
  for(const [file,content] of originals)await writeFile(root+'/'+file,content);
  await browser?.close();await stop(nextServer);
  if(bridge)await new Promise(r=>{bridge.closeAllConnections();bridge.close(r)});
  await stop(rest);await database.end();await writeFile(evidence+'/server.log',logs.join(''));await rm(dir,{recursive:true,force:true});
}
