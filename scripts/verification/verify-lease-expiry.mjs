// Execute the real React review panel/API client and production CSS with synthetic HTTP data.
// Authentication provider is isolated here only; application routes retain real authorization.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const root=process.cwd(), output=path.join(root,'verification/lease-expiry');fs.mkdirSync(output,{recursive:true});
const modules={}, ids=new Map();
const virtual={
 'fixture-session':`exports.useAppSession=()=>({status:'authenticated',session:{role:'admin',user:{id:'synthetic-admin'},session:{access_token:'synthetic-token'}}});`,
 'fixture-impersonation':`exports.useImpersonation=()=>({isImpersonating:false});`,
 'fixture-link':`const React=require('react');exports.__esModule=true;exports.default=({children,...props})=>React.createElement('a',props,children);`,
 'fixture-icons':`const React=require('react');exports.ChevronLeft=()=>React.createElement('span',{'aria-hidden':true},'‹');`,
 'fixture-ui':`Object.assign(exports,require('@/src/components/ui/Button'),require('@/src/components/ui/AppHeader'));`,
 'fixture-layout':`Object.assign(exports,require('@/src/components/layout/WorkspaceShell'));`,
 'fixture-contract':`exports.reviewStatusLabels={pending:'未标记问题',missing_info:'资料不足',source_conflict:'来源差异'};`,
 'fixture-entry':`const React=require('react');const {createRoot}=require('react-dom/client');const {LeaseExpiryWorkspace}=require('@/src/components/intelligence/LeaseExpiryWorkspace');createRoot(document.getElementById('root')).render(React.createElement(LeaseExpiryWorkspace));`,
};
function resolve(name,base){
 if(name.includes('SessionProvider'))return 'fixture-session';
 if(name.includes('ImpersonationContext'))return 'fixture-impersonation';
 if(name==='next/link')return 'fixture-link';
 if(name==='lucide-react')return 'fixture-icons';
 if(name==='@/src/components/ui')return 'fixture-ui';
 if(name==='@/src/components/layout')return 'fixture-layout';
 if(name==='@/src/lib/leaseExpiry/contracts')return 'fixture-contract';
 const cjs={'react':'react.production.js','react/jsx-runtime':'react-jsx-runtime.production.js','react-dom':'react-dom.production.js','react-dom/client':'react-dom-client.production.js','scheduler':'scheduler.production.js'};
 if(cjs[name]) {const pkg=name.startsWith('react-dom')?'react-dom':name.startsWith('react')?'react':'scheduler';return path.join(path.dirname(require.resolve(pkg+'/package.json')),'cjs',cjs[name]);}
 if(name.startsWith('@/')||name.startsWith('.')){const stem=name.startsWith('@/')?path.join(root,name.slice(2)):path.resolve(path.dirname(base),name);for(const ext of ['', '.tsx','.ts','.js'])if(fs.existsSync(stem+ext))return stem+ext;}
 return createRequire(base.startsWith('/')?base:import.meta.url).resolve(name);
}
function bundle(file){
 if(ids.has(file))return ids.get(file);const id=ids.size;ids.set(file,id);
 let source=virtual[file]??fs.readFileSync(file,'utf8');
 if(/\.tsx?$/.test(file))source=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const dependencies={};for(const [,name] of source.matchAll(/require\(['"]([^'"]+)['"]\)/g))dependencies[name]=bundle(resolve(name,file));
 modules[id]=`[function(require,module,exports){${source}\n},${JSON.stringify(dependencies)}]`;return id;
}
const entry=bundle('fixture-entry');
const script=`const process={env:{NODE_ENV:'production'}};const modules={${Object.entries(modules).map(([id,value])=>JSON.stringify(id)+':'+value).join(',')}};const cache={};function load(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};const [fn,map]=modules[id];fn(name=>load(map[name]),m,m.exports);return m.exports;}load(${entry});`;
const cssDir=path.join(root,'.next/static/css');const css=fs.readdirSync(cssDir,{recursive:true}).filter(n=>String(n).endsWith('.css')).map(n=>fs.readFileSync(path.join(cssDir,String(n)),'utf8')).join('\n');
const source={id:'11111111-1111-4111-8111-111111111111',company:'合成验证企业（非真实业务数据）',building:'合成长名称示范楼宇 A 座',period_start:'2021-10-01',period_end:'2021-12-31',period_source:'info_date_inferred_same_year',precision:'quarter',lease_term_months:60,source_lease_term_raw:'60',source_file:'synthetic-evidence.xlsx',source_sheet:'合成样本',source_row:2,source_info_date:null,quality_status:'synthetic',building_match_scope:'project'};
let review=null,failSave=false,saveCount=0;const requests=[];
const item=()=>({source_kind:'history',source_available:true,source,source_fingerprint:'a'.repeat(32),proxy_start:'2026-10-01',proxy_end:'2026-12-31',has_later_name_match:true,review});
const server=http.createServer(async(req,res)=>{
 if(req.url.startsWith('/api/intelligence/lease-expiry')){
  res.setHeader('content-type','application/json');
  if(req.method==='POST'){
   let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);requests.push(input);
   if(failSave){failSave=false;res.statusCode=503;res.end(JSON.stringify({error:'合成网络故障，可重试'}));return;}
   saveCount++;review={source_kind:'history',source_id:source.id,revision:saveCount,...input,source_snapshot:source,source_fingerprint:'a'.repeat(32),updated_by:'synthetic-admin',updated_at:'2026-11-11T03:00:00Z'};res.end(JSON.stringify(review));return;
  }
  res.end(JSON.stringify({items:[item()],total:1,page:1,page_size:25,as_of:'2026-11-11',window_end:'2027-05-11'}));return;
 }
 if(req.url==='/bundle.js'){res.setHeader('content-type','application/javascript');res.end(script);return;}
 res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="zh-CN" class="h-full"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="h-full flex flex-col"><div id="root" style="display:contents"></div><script src="/bundle.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const {chromium}=require(process.env.PERF_PLAYWRIGHT_MODULE||'playwright-core');let browser;const results=[];
try{
 browser=await chromium.launch({headless:true,channel:process.env.PERF_BROWSER_CHANNEL||undefined});
 for(const width of [1280,390,320]){
  review=null;saveCount=0;requests.length=0;const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:/合成验证企业/}).waitFor();
  await page.getByLabel('企业或楼宇').fill('合成');await page.getByRole('button',{name:'筛选',exact:true}).click();await page.getByRole('button',{name:/合成验证企业/}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:path.join(output,`${width}-list.png`),fullPage:true});
  await page.getByRole('button',{name:/合成验证企业/}).click();
  await page.getByText('预计到期区间：2026-10-01 — 2026-12-31',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('补充备注').isVisible(),false);
  await page.getByText('补充资料或标记问题（可选）',{exact:true}).click();
  await page.mouse.move(width/2,600);await page.mouse.wheel(0,10000);
  await page.waitForFunction(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='保存补充记录');const box=button?.getBoundingClientRect();return box && box.top>=0 && box.bottom<=innerHeight;});
  await page.getByLabel('资料标记').selectOption('missing_info');
  await page.getByLabel('依据定位').fill('合成原件第 2 行');await page.getByLabel('补充备注').fill('缺少合同起租日与原件租期单位，需要进一步核实。');
  failSave=true;await page.getByRole('button',{name:'保存补充记录',exact:true}).click();await page.getByText('合成网络故障，可重试').waitFor();
  assert.equal(await page.getByLabel('补充备注').inputValue(),'缺少合同起租日与原件租期单位，需要进一步核实。');
  await page.getByRole('button',{name:'保存补充记录',exact:true}).click();await page.getByText('补充记录已保存，预计到期区间仍按成交数据计算。').waitFor();
  assert.equal(requests[0].request_id,requests[1].request_id);assert.equal(saveCount,1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:path.join(output,`${width}-draft.png`),fullPage:true});
  await page.getByRole('button',{name:'返回清单',exact:true}).click();await page.getByLabel('范围').selectOption('saved');await page.getByRole('button',{name:/合成验证企业/}).click();
  await page.getByText('预计到期区间：2026-10-01 — 2026-12-31',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('补充备注').isVisible(),false);
  await page.getByText('补充资料或标记问题（可选）',{exact:true}).click();
  assert.equal(await page.getByLabel('依据定位').inputValue(),'合成原件第 2 行');assert.deepEqual(errors,[]);
  results.push({width,estimateWithoutEvidence:true,optionalNotesCollapsed:true,saveRetry:true,readBack:true,noOverflow:true,userCanScrollToSave:true,pageErrors:errors});await page.close();
 }
 if(process.argv[2]){const res=await fetch(process.argv[2]+'/api/intelligence/lease-expiry');assert.equal(res.status,403);assert.match(res.headers.get('cache-control'),/no-store/);results.push({actualNextRoute:'closed by default, no-store'});}
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
