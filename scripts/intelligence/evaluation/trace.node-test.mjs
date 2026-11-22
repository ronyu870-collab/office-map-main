import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hash, recordingAdapter, replayAdapter } from './trace.mjs';
test('exact replay refuses changed permissions, data, messages or schemas; no raw thinking is stored', async () => {
  const contract = { fixture: 'synthetic-v1', clock: 'frozen', permission: 'p1' };
  const trace = { environment: 'synthetic-local', source: 'scripted', contractHash: hash(contract), requests: [] };
  const completion = { provider: 'deepseek', model: 'fake', inputTokens: 10, outputTokens: 2,
    message: { role: 'assistant', content: 'hello', reasoning_content: 'DO_NOT_RECORD' }, continuation: 'DO_NOT_RECORD' };
  const messages = [{ role: 'user', content: 'hello' }], options = { tools: [], model: 'fake' };
  const adapter = recordingAdapter(async () => completion, trace);
  await adapter(messages, undefined, undefined, options);
  assert.ok(!JSON.stringify(trace).includes('DO_NOT_RECORD'));
  assert.throws(() => replayAdapter(trace, { ...contract, permission: 'p2' }), /CONTRACT_MISMATCH/);
  const replay = replayAdapter(trace, contract); await replay.adapter(messages, undefined, undefined, options); replay.finish();
  await assert.rejects(replayAdapter(trace, contract).adapter([...messages, { role: 'user', content: 'changed' }], undefined, undefined, options), /INPUT_MISMATCH/);
  await assert.rejects(replayAdapter(trace, contract).adapter(messages, undefined, undefined, { tools: [{ name: 'other' }] }), /INPUT_MISMATCH/);
});
test('offline guard blocks external fetch, raw TCP, fallback SDK transport and children even with clean env', () => {
  const guard = fileURLToPath(new URL('./offline-guard.cjs', import.meta.url));
  for (const code of [
    `fetch('https://api.deepseek.com')`,
    `require('net').connect(443,'api.openai.com')`,
    `require('https').get('https://api.deepseek.com')`,
    `require('child_process').spawnSync('/usr/bin/curl',['https://api.deepseek.com'])`,
    `const r=require('child_process').spawnSync(process.execPath,['-e',"require('net').connect(443,'api.deepseek.com')"],{env:{}});process.stderr.write(r.stderr);process.exit(r.status)`,
  ]) {
    const result = spawnSync(process.execPath, ['--require', guard, '-e', code], { encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /EVALUATION_EXTERNAL_IO_BLOCKED/);
  }
});
test('Worker with empty env and execArgv cannot drop the offline guard', () => {
  const guard = fileURLToPath(new URL('./offline-guard.cjs', import.meta.url));
  const childCode = `const {Worker}=require('node:worker_threads');
    const w=new Worker(\`const {parentPort}=require('node:worker_threads');
      try {require('net').connect(443,'api.deepseek.com');parentPort.postMessage('unguarded');}
      catch(e){parentPort.postMessage(e.message);}\`,{eval:true,env:{},execArgv:[]});
    w.on('message',m=>{console.log(m);process.exitCode=m==='EVALUATION_EXTERNAL_IO_BLOCKED'?0:1;});`;
  const result = spawnSync(process.execPath, ['--require', guard, '-e', childCode], { encoding: 'utf8' });
  assert.equal(result.status, 0); assert.match(result.stdout, /EVALUATION_EXTERNAL_IO_BLOCKED/);
});
