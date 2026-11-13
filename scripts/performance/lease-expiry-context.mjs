// A/B actual production pages, synthetic authorized HTTP; no production data or model calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PERF_PLAYWRIGHT_MODULE||'playwright-core');
const origins=process.argv.slice(2,4).map(x=>new URL(x));assert.equal(origins.length,2);for(const u of origins)assert.equal(u.hostname,'127.0.0.1');
const browser=await chromium.launch({headless:true,channel:process.env.PERF_BROWSER_CHANNEL==='chromium'?undefined:'chrome'});
const user={id:'12345678-1111-4111-8111-111111111111',email:'expiry@example.test',app_metadata:{},user_metadata:{}};
const exp=Math.floor(Date.now()/1000)+3600,enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:user.id,exp,aud:'authenticated',session_id:user.id})}.fixture`;
const session={user,expires_at:exp,expires_in:3600,token_type:'bearer',refresh_token:'synthetic',access_token:token};
const samples=[];
try{
 for(const width of [1280,390])for(let n=0;n<20;n++)for(const [version,base] of (n%2?[...origins.entries()].reverse():[...origins.entries()])){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});await context.routeWebSocket(/.*/,ws=>ws.close());
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin===base.origin){
    if(url.pathname==='/api/lease-transactions/expiry'){
     const items=Array.from({length:25},(_,i)=>({source_kind:'history',source_available:true,source:{id:`synthetic-${i}`,company:`合成企业 ${i}`,building:'合成商务中心 A 座',period_start:'2021-10-01',period_end:'2021-12-31',precision:'quarter',period_source:'quarter',lease_term_months:60},source_fingerprint:'a'.repeat(32),proxy_start:'2026-10-01',proxy_end:'2026-12-31',review:null,has_later_name_match:false,...(version===1?{details:{area_sqm:1250.5,industry:'信息技术',sub_industry:'软件与互联网',sub_market:'合成核心商务区'}}:{})}));
     await new Promise(resolve=>setTimeout(resolve,100));return route.fulfill({json:{items,total:250,page:1,page_size:25,as_of:'2026-11-13',window_end:'2027-05-13'}});
    }
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:{records:[],count:0,data:[],submissions:[],total:0,access:{effectiveRole:'admin',effectiveSource:'all',canReadHistory:true,impersonating:false}}});return route.continue();
   }
   if(url.origin!=='https://example.supabase.co')return route.abort();
   const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET, HEAD, OPTIONS','access-control-allow-headers':'*','access-control-expose-headers':'content-range'};
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(url.pathname==='/rest/v1/user_roles')return route.fulfill({headers,json:[{role:'admin',session_id:user.id,full_name:'合成验收账号'}]});
   if(url.pathname==='/auth/v1/user')return route.fulfill({headers,json:user});return route.fulfill({headers:{...headers,'content-range':'*/0'},json:[]});
  });
  await context.addInitScript(({origin,session})=>{if(location.origin!==origin)return;localStorage.setItem('colliers_trusted_device_until',String(Date.now()+86400000));localStorage.setItem('sb-example-auth-token',JSON.stringify(session));},{origin:base.origin,session});
  const page=await context.newPage();
  if(width===390){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:1.6*1024*1024/8,uploadThroughput:750*1024/8});}
  for(const cache of ['cold-route','repeat']){
   if(cache==='cold-route')await page.goto(new URL('/lease-submission',base).href);else await page.getByRole('link',{name:'返回租赁成交',exact:true}).click();await page.getByRole('link',{name:'租约到期',exact:true}).waitFor();await page.locator('#nprogress').waitFor({state:'detached'});
   const started=await page.evaluate(()=>{const start=performance.now();window.expiryMeasure={start,feedback:null};const observer=new MutationObserver(()=>{if(document.querySelector('#nprogress')||document.body.textContent.includes('正在读取到期记录')||document.body.textContent.includes('未来六个月的预计到期企业')){window.expiryMeasure.feedback=performance.now()-start;observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true});document.querySelector('a[href="/lease-submission/expiry"]').click();return start;});
   await page.getByText('合成企业 0',{exact:true}).waitFor();if(version===1)await page.getByText('1,250.5 ㎡',{exact:true}).first().waitFor();
   samples.push({version:version===0?'before':'after',width,n,cache,...await page.evaluate(start=>({content:performance.now()-start,feedback:window.expiryMeasure.feedback}),started)});
  }
  await context.close();
 }
 const summary=[];for(const version of ['before','after'])for(const width of [1280,390])for(const cache of ['cold-route','repeat']){
  const rows=samples.filter(x=>x.version===version&&x.width===width&&x.cache===cache),percentile=(key,p)=>rows.map(x=>x[key]).sort((a,b)=>a-b)[Math.ceil(rows.length*p)-1];
  summary.push({version,width,cache,n:rows.length,p50:percentile('content',.5),p90:percentile('content',.9),feedbackP90:percentile('feedback',.9),missing:rows.filter(x=>x.feedback===null).length});
 }
 await mkdir('verification/lease-expiry-context-performance',{recursive:true});await writeFile('verification/lease-expiry-context-performance/browser.json',JSON.stringify({environment:'local production builds; 25 rows/250 total; 100ms API fixture; alternating A/B; fresh browser context per pair; no production claim',mobile:'390px, 4x CPU slowdown, 80ms latency, 1.6Mbps down/750Kbps up; synthetic HTTP fulfillment is fixed 100ms',browser:await browser.version(),summary,samples},null,2));console.log(JSON.stringify(summary,null,2));
}finally{await browser.close();}
