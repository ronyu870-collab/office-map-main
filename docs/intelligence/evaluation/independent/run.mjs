// Independent assertions. This runner only adapts filesystem paths, not the frozen oracle.
import { createRequire } from 'node:module';
import { mkdtemp, symlink, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const directory=fileURLToPath(new URL('./',import.meta.url));
const output=process.argv[2]??await mkdtemp(join(tmpdir(),'colliers-independent-evidence-'));
await mkdir(output,{recursive:true});
const require=createRequire(join(root,'package.json'));
const {rolldown}=await import(require.resolve('rolldown'));
const temporary=await mkdtemp(join(tmpdir(),'colliers-independent-bundle-'));
await symlink(join(root,'node_modules'),join(temporary,'node_modules'),'dir');
const build=await rolldown({input:join(directory,'acceptance.ts'),platform:'node',external:[/^[^./]/]});
try{await build.write({file:join(temporary,'acceptance.cjs'),format:'cjs'});}finally{await build.close();}
const guard=join(root,'scripts/intelligence/evaluation/offline-guard.cjs');
const env={PATH:process.env.PATH,HOME:process.env.HOME,NODE_OPTIONS:`--require=${guard}`,COLLIERS_INDEPENDENT_OUTPUT:output};
let failed=false;
for(const file of [join(temporary,'acceptance.cjs'),join(directory,'budget-acceptance.mjs')]){
 const result=spawnSync(process.execPath,[file],{stdio:'inherit',env});
 if(result.status!==0)failed=true;
}
console.log('Independent evidence: '+output);
if(failed)process.exitCode=1;
