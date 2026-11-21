import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PERF_PLAYWRIGHT_MODULE||'playwright-core');
const variants=process.argv[2]?[['before',resolve(process.argv[2])],['after',process.cwd()]]:[['after',process.cwd()]];
const browser=await chromium.launch({headless:true,...(process.env.PERF_BROWSER_CHANNEL==='chromium'?{}:{channel:'chrome'})});
const rows=[];
try{
 for(const [variant,sourceRoot] of variants){
  const folder=await mkdtemp(join(tmpdir(),'audit-budget-'));let child;
  try{
   await symlink(resolve('node_modules'),join(folder,'node_modules'),'dir');await mkdir(join(folder,'app'));
   await writeFile(join(folder,'package.json'),JSON.stringify({name:'isolated-audit-budget',private:true}));
   await writeFile(join(folder,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2020',lib:['dom','esnext'],allowJs:true,skipLibCheck:true,esModuleInterop:true,module:'esnext',moduleResolution:'bundler',jsx:'preserve',baseUrl:sourceRoot,paths:{'@/*':['./*']}},include:['app/**/*.tsx'],exclude:['node_modules']}));
   const aliases={'@':sourceRoot};
   for(const name of ['src/services/supabaseClient','src/services/supabaseClient.ts'])aliases[join(sourceRoot,name)+'$']=join(folder,'backend.js');
   aliases['@/src/services/supabaseClient$']=join(folder,'backend.js');
   await writeFile(join(folder,'next.config.mjs'),`export default {typescript:{ignoreBuildErrors:true},webpack(c){c.resolve.alias={...c.resolve.alias,...${JSON.stringify(aliases)}};return c;}}`);
   await writeFile(join(folder,'backend.js'),`export const supabase={auth:{getSession:async()=>{window.__sessionReads=(window.__sessionReads||0)+1;return{data:{session:{user:{id:'11111111-1111-4111-8111-111111111111'},access_token:'e30.eyJzZXNzaW9uX2lkIjoiYWFhYWFhYWEtYWFhYS00YWFhLThhYWEtYWFhYWFhYWFhYWFhIn0.fixture'}}}}}};`);
   await writeFile(join(folder,'app/layout.tsx'),`import React from 'react';export default function Layout({children}){return <html><body>{children}</body></html>}`);
   await writeFile(join(folder,'app/page.tsx'),`'use client';import React,{useEffect} from 'react';import * as audit from ${JSON.stringify(join(sourceRoot,'src/utils/audit'))};${variant==='after'?`import {auditBuildingReading} from ${JSON.stringify(join(sourceRoot,'src/utils/buildingReadingAudit'))};`:''}export default function Page(){useEffect(()=>{audit.setAuditSessionContext({userId:'11111111-1111-4111-8111-111111111111',authSessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});window.__audit=audit;${variant==='after'?'window.__reading=auditBuildingReading;':''}},[]);return <p>Isolated audit budget</p>}`);
   const next=require.resolve('next/dist/bin/next');
   let output='';const build=spawn(process.execPath,[next,'build',folder,'--webpack'],{cwd:folder,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
   for(const stream of [build.stdout,build.stderr])stream.on('data',data=>{output=(output+data).slice(-12000);});
   const result=await new Promise(resolve=>build.on('exit',resolve));assert.equal(result,0,output);
   child=spawn(process.execPath,[next,'start',folder,'-H','127.0.0.1','-p','3244'],{cwd:folder,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});output='';
   for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output=(output+data).slice(-12000);});
   for(let i=0;i<100&&!output.includes('Ready');i++){assert.equal(child.exitCode,null,output);await delay(50);}assert.ok(output.includes('Ready'),output);
   for(const [width,cpu] of [[1280,1],[390,4]])for(let round=0;round<5;round++){
    const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'});
    try{
     await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
     const page=await context.newPage();const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
     await page.goto('http://127.0.0.1:3244');await page.waitForFunction(()=>Boolean(window.__audit));
     const measured=await page.evaluate(async()=>{
      let counts=0,puts=0;const count=IDBObjectStore.prototype.count,put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.count=function(...args){counts++;return count.apply(this,args);};
      IDBObjectStore.prototype.put=function(...args){puts++;return put.apply(this,args);};
      const longTasks=[];const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(row=>row.duration)));observer.observe({type:'longtask'});
      const samples=[];const started=performance.now();
      for(let i=0;i<120;i++){const before=performance.now();const pending=(window.__reading ? window.__reading('VIEW_BUILDING',{id:String(i),name:'测试楼宇'}) : window.__audit.logAuditEvent({action_type:'VIEW_BUILDING',details:{id:i}}));samples.push(performance.now()-before);pending?.catch?.(()=>{});}
      for(let i=0;i<100&&puts<120;i++)await new Promise(resolve=>setTimeout(resolve,10));
      await new Promise(resolve=>setTimeout(resolve,50));observer.disconnect();samples.sort((a,b)=>a-b);
      return{samples:samples.length,syncP95Ms:samples[113],syncMaxMs:samples.at(-1),counts,puts,sessionReads:window.__sessionReads||0,longTasks,windowMs:performance.now()-started};
     });
     assert.equal(measured.puts,120);if(variant==='after'){assert.ok(measured.syncP95Ms<=1,JSON.stringify(measured));assert.equal(measured.longTasks.length,0);assert.ok(measured.counts<=2);assert.equal(measured.sessionReads,0);}
     rows.push({variant,width,cpu,round,...measured});
    }finally{await context.close();}
   }
  }finally{if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}await rm(folder,{recursive:true,force:true});}
 }
 await mkdir('verification/audit-2',{recursive:true});
 const report={browser:browser.version(),environment:'Actual Chrome + native IndexedDB; production Next/webpack fixture importing actual audit module; synthetic Auth only; 120 distinct business-reading events per burst through the actual shared helper (baseline uses raw audit), five rounds per width; no live backend or map SDK',rows};
 await writeFile('verification/audit-2/browser-budget.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:'pass',...report}));
}finally{await browser.close();}
