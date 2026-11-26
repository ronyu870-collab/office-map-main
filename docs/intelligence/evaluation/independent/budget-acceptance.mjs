import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { BudgetLedger, nanos, budgetedAdapter, usageCost } from '../../../../scripts/intelligence/evaluation/budget.mjs';

const outputDir=process.env.COLLIERS_INDEPENDENT_OUTPUT;
const root=mkdtempSync(join(tmpdir(),'independent-ai-budget-'));
const rates={input:1,cachedInput:.5,output:2};
const config={taskId:'independent-acceptance',total:nanos(1),acceptance:nanos(.2),buffer:nanos(.1),currency:'USD',model:'synthetic-deepseek',rates,pricingSource:'synthetic-no-live-price',pricingCheckedAt:'2026-11-22T00:00:00Z'};
const results=[];
const check=async(id,fn)=>{try{await fn();results.push({id,status:'PASS'});}catch(e){results.push({id,status:'FAIL',error:e.message});}};
const ledgerModule=new URL('../../../../scripts/intelligence/evaluation/budget.mjs',import.meta.url).href;
await check('H7.zero',async()=>{
 const ledger=new BudgetLedger(join(root,'zero.sqlite'),{...config,total:0,acceptance:0,buffer:0});let calls=0;
 assert.throws(()=>ledger.startWorkflow('zero','diagnostic',nanos(.001)),/BUDGET_BLOCKED/);
 const adapter=budgetedAdapter(async()=>{calls++;throw Error('MUST_NOT_SEND');},ledger,'missing','zero-attempt');
 await assert.rejects(adapter([{role:'user',content:'问候'}],new AbortController().signal,undefined,{model:config.model,maxOutputTokens:16,tools:[]}),/BUDGET_BLOCKED/);
 assert.equal(calls,0);assert.equal(ledger.snapshot().pending,0);ledger.close();
});
await check('H7.restart-timeout',()=>{
 const file=join(root,'restart.sqlite');let ledger=new BudgetLedger(file,config);ledger.startWorkflow('diagnose','diagnostic',nanos(.7));
 ledger.reserve('timeout','diagnose',nanos(.5));ledger.sent('timeout');ledger.unknown('timeout');ledger.close();ledger=new BudgetLedger(file);
 assert.equal(ledger.snapshot().pending,nanos(.5));assert.equal(ledger.snapshot().settled,0);assert.equal(ledger.snapshot().available,0);
 assert.throws(()=>ledger.releaseNotSent('timeout'),/REQUEST_MAY_HAVE_BEEN_SENT/);
 assert.throws(()=>ledger.startWorkflow('extra','diagnostic',1),/BUDGET_BLOCKED/);ledger.close();
});
await check('H7.acceptance-isolation',()=>{
 const ledger=new BudgetLedger(join(root,'holds.sqlite'),config);
 assert.throws(()=>ledger.startWorkflow('excess','diagnostic',nanos(.701)),/BUDGET_BLOCKED/);
 ledger.startWorkflow('accept','acceptance',nanos(.2));assert.equal(ledger.snapshot().available,nanos(.7));
 ledger.reserve('accept-request','accept',nanos(.1));assert.equal(ledger.snapshot().pending,nanos(.1));assert.equal(ledger.snapshot().available,nanos(.7));
 ledger.releaseNotSent('accept-request');ledger.finishWorkflow('accept');
 assert.equal(ledger.snapshot().pools.find(p=>p.id==='acceptance-hold').remaining,nanos(.2));ledger.close();
});
await check('H7.concurrent-workers',async()=>{
 const file=join(root,'concurrent.sqlite'),ledger=new BudgetLedger(file,config);ledger.startWorkflow('shared','diagnostic',nanos(.7));ledger.close();
 const code=`import {BudgetLedger,nanos} from ${JSON.stringify(ledgerModule)};const ledger=new BudgetLedger(process.argv[1]);try{ledger.reserve(process.argv[2],'shared',nanos(.5));console.log('RESERVED');}catch(e){console.log(e.message);}finally{ledger.close();}`;
 const workers=[0,1].map(i=>{const child=spawn(process.execPath,['--input-type=module','-e',code,file,'worker-'+i],{env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',x=>output+=x);return once(child,'close').then(([status])=>({status,output}));});
 const values=await Promise.all(workers);assert.ok(values.every(v=>v.status===0));assert.equal(values.filter(v=>v.output.includes('RESERVED')).length,1);assert.equal(values.filter(v=>v.output.includes('BUDGET_BLOCKED')).length,1);
 const reopened=new BudgetLedger(file);assert.equal(reopened.snapshot().pending,nanos(.5));assert.ok(reopened.snapshot().available>=0);reopened.close();
});
await check('H7.usage-halt-cache',()=>{
 assert.equal(usageCost({inputTokens:10,cachedInputTokens:2,outputTokens:2,reasoningTokens:1},rates),nanos(.000013));
 const ledger=new BudgetLedger(join(root,'usage.sqlite'),config);ledger.startWorkflow('test','diagnostic',nanos(.1));ledger.reserve('over','test',nanos(.0001));ledger.sent('over');
 ledger.settle('over',{inputTokens:1000,outputTokens:0},{input:10,output:10});assert.ok(ledger.snapshot().halted);assert.equal(ledger.snapshot().settled,nanos(.001));assert.throws(()=>ledger.reserve('next','test',1),/BUDGET_HALTED/);ledger.close();
});
writeFileSync(join(outputDir??root,'budget-results.json'),JSON.stringify({evidence:'synthetic-sqlite-workers-no-model',results},null,2));
console.log(JSON.stringify(results,null,2));if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
