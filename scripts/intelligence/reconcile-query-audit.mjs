// Local/isolated one-shot operator entry. Production scheduling/credentials are
// separate release work; do not copy ambient production environment here.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { rolldown } from 'rolldown';
assert.equal(process.env.AI_QUERY_RECONCILE_ALLOW_LOCAL,'disposable');
const url=new URL(process.env.AI_QUERY_RECONCILE_URL??'');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));assert.ok(['http:','https:'].includes(url.protocol));
assert.equal(url.username,'');assert.equal(url.password,'');assert.equal(url.search,'');assert.equal(url.hash,'');
const secret=process.env.AI_QUERY_RECONCILE_SECRET,keyId=process.env.AI_QUERY_AUDIT_KEY_ID,
  encryption=process.env.AI_QUERY_AUDIT_ENCRYPTION_KEY,digest=process.env.AI_QUERY_AUDIT_DIGEST_KEY;
assert.ok(secret&&keyId&&/^[A-Za-z0-9_-]{1,80}$/.test(keyId));
assert.match(encryption??'',/^[a-f0-9]{64}$/i);assert.match(digest??'',/^[a-f0-9]{64}$/i);assert.notEqual(encryption.toLowerCase(),digest.toLowerCase());
const dir=await mkdtemp(path.join(tmpdir(),'ai-query-reconcile-'));
try{
  const bundle=await rolldown({input:path.resolve('src/lib/intelligence/query/reconciliation.ts'),platform:'node',external:['@supabase/supabase-js']});
  try{await bundle.write({file:path.join(dir,'worker.mjs'),format:'esm'});}finally{await bundle.close();}
  const {reconcileQueryAudits}=await import(pathToFileURL(path.join(dir,'worker.mjs')).href);
  const client=createClient(url.href,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const outcome=await reconcileQueryAudits(client,{keyId,encryptionKey:Buffer.from(encryption,'hex'),digestKey:Buffer.from(digest,'hex')},process.env.AI_QUERY_RECONCILE_WORKER??'isolated-operator',20);
  console.log(JSON.stringify(outcome));
  if(outcome.outcomes.some(item=>['unavailable','integrity_unavailable'].includes(item.status)))process.exitCode=1;
}finally{await rm(dir,{recursive:true,force:true});}
