import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessLatencyBudget, assertLatencyBudgets, LatencyBudgetExceeded, withLatencyRecheck, writeLatencyEvidence } from './latency-budget.mjs';
const sample = p95Ms => ({samples:100,p95Ms});
const budget = (before, after) => assessLatencyBudget('leaseInsert', sample(before), sample(after));

test('keeps the original absolute and relative P95 limits including the boundary', () => {
  assert.equal(budget(1,11).withinBudget,true);
  assert.equal(budget(1,11.01).withinBudget,false);
  assert.equal(budget(1000,1030).withinBudget,true);
  assert.equal(budget(1000,1031).withinBudget,false);
  assert.throws(() => assessLatencyBudget('bad', {samples:99,p95Ms:1},sample(1)));
  assert.throws(() => assessLatencyBudget('bad',sample(1),sample(NaN)));
});

test('first clean pass never repeats; timing failure repeats once and reports both outcomes', async () => {
  let attempts=[];
  const events=[];
  assert.equal((await withLatencyRecheck(async n => {attempts.push(n);},event=>events.push(event))).attempts,1);
  assert.deepEqual(attempts,[1]);assert.equal(events.length,0);
  attempts=[];
  const result=await withLatencyRecheck(async n=>{attempts.push(n);assertLatencyBudgets([budget(1,n===1?12:2)]);},event=>events.push(event));
  assert.equal(result.attempts,2);assert.deepEqual(attempts,[1,2]);
  assert.equal(events[0].firstAttempt,'over_budget');
  assert.equal(events[1].status,'passed_on_independent_recheck');
});

test('persistent timing breach fails; ordinary assertion and database errors never repeat', async () => {
  let attempts=[];
  await assert.rejects(withLatencyRecheck(async n=>{attempts.push(n);assertLatencyBudgets([budget(1,12)]);},()=>{}),LatencyBudgetExceeded);
  assert.deepEqual(attempts,[1,2]);
  for(const error of [new Error('database connection failed'),new assert.AssertionError({message:'functional regression'})]){
    attempts=[];
    await assert.rejects(withLatencyRecheck(async n=>{attempts.push(n);throw error;},()=>{}),e=>e===error);
    assert.deepEqual(attempts,[1]);
  }
});

test('failed and successful evidence remain distinct after a recheck', async () => {
  const dir=await mkdtemp(join(tmpdir(),'audit-2-latency-'));
  try {
    await writeLatencyEvidence('sample',1,{latency:[budget(1,12)]},dir);
    await writeLatencyEvidence('sample',2,{latency:[budget(1,2)]},dir);
    const load=async name=>JSON.parse(await readFile(join(dir,name+'.json'),'utf8'));
    assert.equal((await load('sample-attempt-1')).latencyStatus,'over_budget');
    assert.equal((await load('sample-attempt-2')).latencyStatus,'within_budget');
    assert.equal((await load('sample')).attempt,2);
  } finally {await rm(dir,{recursive:true,force:true});}
});
