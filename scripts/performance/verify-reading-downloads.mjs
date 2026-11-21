import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const folder=await mkdtemp(join(tmpdir(),'reading-download-'));const rows=[];
const id='11111111-1111-4111-8111-111111111111';
try{
 for(const failure of ['none','receipt','completion']){
  const events=join(folder,failure+'.jsonl');await writeFile(events,'');
  const child=spawn(process.execPath,['--import',resolve('scripts/performance/fixtures/audit-lifecycle-fetch.mjs'),resolve('node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p','3245'],{cwd:process.cwd(),env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'synthetic',AUDIT_LIFECYCLE_SYNTHETIC:'yes',AUDIT_LIFECYCLE_EVENTS:events,AUDIT_READING_PROBE:'yes',AUDIT_READING_FAIL:failure},stdio:['ignore','pipe','pipe']});
  let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output=(output+data).slice(-8000);});
  try{
   for(let i=0;i<200&&!output.includes('Ready');i++){assert.equal(child.exitCode,null,output);await delay(50);}assert.ok(output.includes('Ready'),output);
   const headers={authorization:'Bearer synthetic','x-reading-entry':'search','x-reading-id':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
   const base='http://127.0.0.1:3245/api/map/';const material=`sales-materials?building_id=${id}&material_id=${id}`;const photo=`building-photos?building_id=${id}&photo_id=${id}`;
   for(const endpoint of [material,photo]){
    assert.equal((await fetch(base+endpoint+'&download=1')).status,401,'anonymous delivery denied');
    const ordinary=await fetch(base+endpoint,{headers});assert.equal(ordinary.status,200,output);const body=await ordinary.json();
    if(endpoint===material){assert.equal(body.download_url,null);assert.equal(body.can_download,true);}
    const started=performance.now();const response=await fetch(base+endpoint+'&download=1',{headers});const result=await response.json();
    assert.equal(response.status,failure==='none'?200:503,JSON.stringify({result,output}));
    assert.equal(typeof result.url==='string',failure==='none','outage cannot leak a signed download URL');
    rows.push({failure,resource:endpoint===material?'project_original':'building_photo',status:response.status,responseMs:performance.now()-started});
   }
   const persisted=(await readFile(events,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
   const receipts=persisted.filter(row=>row.kind==='receipt');const completions=persisted.filter(row=>row.kind==='complete');
   assert.equal(receipts.length,2);assert.equal(completions.length,failure==='receipt'?0:2);
   for(const row of receipts){assert.equal(row.payload.actor_id,id);assert.equal(row.payload.details.entry,'search');assert.equal(row.payload.details.correlation_id,headers['x-reading-id']);assert.equal(row.payload.details.phase,'download_requested');}
   for(const row of completions)assert.equal(row.payload.p_details.phase,'download_link_issued');
  }finally{child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
 }
 await mkdir('verification/audit-2',{recursive:true});await writeFile('verification/audit-2/reading-downloads.json',JSON.stringify({environment:'Actual Next production HTTP routes with isolated synthetic Supabase transport; receipt and completion each inject 25ms. No real remote services or disk completion claims.',rows},null,2));console.log(JSON.stringify({status:'pass',rows}));
}finally{await rm(folder,{recursive:true,force:true});}
