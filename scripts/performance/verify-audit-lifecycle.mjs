import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,readFile,writeFile,mkdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const beforeRoot=process.argv[2];
const variants=beforeRoot?[['before',resolve(beforeRoot),false],['after',process.cwd(),false],['after-failure',process.cwd(),true]]:[['after',process.cwd(),false],['after-failure',process.cwd(),true]];
const folder=await mkdtemp(join(tmpdir(),'audit-lifecycle-'));const rows=[];
try{
 for(const [variant,cwd,fail] of variants){
  const events=join(folder,variant+'.jsonl');await writeFile(events,'');
  const child=spawn(process.execPath,['--import',resolve('scripts/performance/fixtures/audit-lifecycle-fetch.mjs'),resolve(cwd,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3243'],{
   cwd,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'synthetic',AUDIT_LIFECYCLE_SYNTHETIC:'yes',AUDIT_LIFECYCLE_EVENTS:events,AUDIT_LIFECYCLE_FAIL:fail?'yes':'no'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',data=>{output=(output+data).slice(-8000);});child.stderr.on('data',data=>{output=(output+data).slice(-8000);});
  try{
   for(let i=0;i<100&&!output.includes('Ready');i++){assert.equal(child.exitCode,null,output);await delay(50);}
   assert.ok(output.includes('Ready'),output);
   const samples=[];const received=[];
   for(let i=0;i<12;i++){
    const started=performance.now();const response=await fetch('http://127.0.0.1:3243/api/map/building-photos?building_id=11111111-1111-4111-8111-111111111111&photo_id=11111111-1111-4111-8111-111111111111',{headers:{authorization:'Bearer synthetic'}});
    const body=await response.json();assert.equal(response.status,200,JSON.stringify({body,output}));assert.equal(body.url,'https://example.org/photo.jpg');
    received.push(Date.now());if(i>=2)samples.push(performance.now()-started);
   }
   await delay(600);
   const persisted=(await readFile(events,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
   assert.equal(persisted.length,12,'Next production lifecycle completes every scheduled attempt');
   if(variant.startsWith('after'))assert.ok(persisted.some(row=>row.finished>received.at(-1)),'business response finishes while audit is still pending');
   samples.sort((a,b)=>a-b);rows.push({variant,samples:samples.length,responseP95Ms:samples.at(-1),auditInjectedDelayMs:400,completedAttempts:persisted.length,businessSuccess:12,auditFailure:fail});
  }finally{child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
 }
 await mkdir('verification/audit-2',{recursive:true});
 await writeFile('verification/audit-2/lifecycle.json',JSON.stringify({environment:'Actual Next 16 production route + Node after lifecycle; synthetic remote Supabase fetch delayed 400ms, no remote connections',rows},null,2));
 console.log(JSON.stringify({status:'pass',rows}));
}finally{await rm(folder,{recursive:true,force:true});}
