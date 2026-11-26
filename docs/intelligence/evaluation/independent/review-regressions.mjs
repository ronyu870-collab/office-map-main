// Additional independent review findings, not part of the original held-out batch.
// No network request is made: Worker only reports whether preload remains installed.
import assert from 'node:assert/strict';
import { BudgetLedger,nanos } from '../../../../scripts/intelligence/evaluation/budget.mjs';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const guard=fileURLToPath(new URL('../../../../scripts/intelligence/evaluation/offline-guard.cjs',import.meta.url));
const code=`const {Worker}=require('node:worker_threads');const w=new Worker(\`const {parentPort}=require('node:worker_threads');parentPort.postMessage({offline:process.env.COLLIERS_EVAL_OFFLINE??null,guardedFetch:fetch.toString().includes('denied')});\`,{eval:true,execArgv:[],env:{}});w.on('message',x=>console.log(JSON.stringify({parentGuardedFetch:fetch.toString().includes('denied'),worker:x})));`;
const worker=spawnSync(process.execPath,['--require',guard,'-e',code],{encoding:'utf8'});
assert.equal(worker.status,0);const workerResult=JSON.parse(worker.stdout);assert.equal(workerResult.worker.offline,'1');assert.equal(workerResult.worker.guardedFetch,true);
const ledger=new BudgetLedger(join(mkdtempSync(join(tmpdir(),'independent-halt-review-')),'ledger.sqlite'),{taskId:'independent-halt-review',total:nanos(1),acceptance:nanos(.2),buffer:nanos(.1),currency:'USD',model:'synthetic',rates:{input:1,cachedInput:.5,output:2},pricingSource:'synthetic',pricingCheckedAt:'2026-11-22T00:00:00Z'});
ledger.startWorkflow('wf','diagnostic',nanos(.7));ledger.reserve('first','wf',100);ledger.reserve('later-reserved','wf',100);ledger.sent('first');ledger.settle('first',{inputTokens:1000,outputTokens:0},{input:1,output:1});
assert.throws(()=>ledger.sent('later-reserved'),/BUDGET_HALTED/);assert.equal(ledger.snapshot().requests.find(r=>r.id==='later-reserved').state,'reserved');ledger.close();
console.log(JSON.stringify({workerPreloadRegression:workerResult,haltBeforeSendRegression:'PASS'}));
