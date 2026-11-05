/** Verify the actual Next production build. The report is public after PR #115.
 * No session substitution, business database fixture, or production credential is used.
 * Run after next build/start: node scripts/verification/verify-occupier-report.mjs <baseURL>
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const nodeRequire=createRequire(import.meta.url);
assert.ok(process.argv[2],'Pass the running production-build base URL');
const app=process.argv[2].replace(/\/$/,'');
const url=`${app}/occupier-insights`;
const output=path.join(process.cwd(),'verification/occupier-report');
fs.mkdirSync(output,{recursive:true});
const compiled=ts.transpileModule(fs.readFileSync('src/app/occupier-insights/reportContent.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const evaluatedModule={exports:{}};
new Function('module','exports',compiled)(evaluatedModule,evaluatedModule.exports);
const {charts}=evaluatedModule.exports;
const {chromium}=nodeRequire(process.env.PERF_PLAYWRIGHT_MODULE||'playwright-core');
let browser;
const results=[];
try{
 browser=await chromium.launch({headless:true});
 for(const [width,height] of [[1440,900],[1280,800],[768,1024],[390,844],[320,740]]){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const response=await page.goto(url,{waitUntil:'load'});
  assert.equal(response?.status(),200);
  await page.getByRole('heading',{name:'企业选址洞察',exact:true}).waitFor({timeout:15000});
  await page.waitForFunction(()=>document.querySelector('[data-report-header]')?.parentElement.dataset.activeChapter==='cover');
  await page.evaluate(()=>document.fonts.ready);
  assert.ok(await page.evaluate(()=>{
   const luminance=color=>{const channels=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
   return ['ecosystem','checklist'].every(id=>{const section=document.getElementById(id);const foreground=luminance(getComputedStyle(section.querySelector('h2')).color),background=luminance(getComputedStyle(section).backgroundColor);return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05)>=4.5;});
  }),'Dark-scene headings need sufficient contrast');
  assert.equal(await page.locator('main section').count(),18);
  assert.equal(await page.locator('[data-chart]').count(),11);
  assert.equal(await page.locator('[data-observation]').count(),62);
  assert.equal(await page.locator('details').count(),0);
  assert.equal(await page.locator('[data-report-header] nav a').count(),6);
  assert.equal(await page.locator('a[href="/"],a[href="/map"]').count(),0);
  const text=await page.locator('[data-report-header]').evaluate(node=>node.parentElement.innerHTML);
  assert.ok(!/戴德梁行|Cushman|Wakefield|cushwake|AI\s*生成/i.test(text));
  for(const [key,chart]of Object.entries(charts))for(const [label,value]of chart.items){
   const row=page.locator(`[data-chart="${key}"] [data-observation]`).filter({hasText:label});
   assert.equal(await row.count(),1);assert.ok((await row.innerText()).includes(value.toFixed(1)));
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow at ${width}`);
  await page.mouse.move(width/2,height/2);await page.mouse.wheel(0,650);await page.waitForFunction(()=>scrollY>100);
  await page.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';scrollTo(0,0);});
  if(width===1440||width===390)await page.screenshot({path:path.join(output,`${width}-cover.png`)});
  for(const key of Object.keys(charts)){
   await page.locator(`[data-chart="${key}"]`).scrollIntoViewIfNeeded();
   await page.waitForFunction(key=>document.querySelector(`[data-chart="${key}"]`).dataset.revealed==='true',key);
  }
  await page.waitForTimeout(1400);
  const scenes=await page.locator('main section').evaluateAll(nodes=>nodes.map(node=>({id:node.id,chapter:node.dataset.reportChapter})));
  for(const {id,chapter}of scenes){
   await page.evaluate(id=>{const h=document.querySelector('[data-report-header]').getBoundingClientRect().height;scrollTo(0,Math.max(0,document.getElementById(id).getBoundingClientRect().top+scrollY-h-20));},id);
   await page.waitForFunction(chapter=>document.querySelector('[data-report-header]').parentElement.dataset.activeChapter===chapter,chapter);
   assert.equal(await page.locator('nav [aria-current]').count(),chapter==='cover'?0:1);
   assert.ok(await page.evaluate(()=>Math.abs(document.querySelector('[data-report-header]').getBoundingClientRect().top)<1));
   if(width===1440||width===390)await page.locator(`#${id}`).screenshot({path:path.join(output,`${width}-${id}.png`)});
  }
  assert.ok(await page.locator('img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0)),'Images must load');
  for(let index=0;index<3;index++){
   await page.evaluate(index=>{const step=document.querySelector(`[data-cost-step="${index}"]`),h=document.querySelector('[data-report-header]').getBoundingClientRect().height;scrollTo(0,step.getBoundingClientRect().top+scrollY-h-30);},index);
   await page.waitForFunction(index=>document.querySelector('[data-report-header]').parentElement.dataset.costStep===String(index),index);
  }
  await page.evaluate(()=>{document.documentElement.style.scrollBehavior='';});
  await page.locator('nav a[href="#factors"]').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>Math.abs(document.getElementById('factors').getBoundingClientRect().top-document.querySelector('[data-report-header]').getBoundingClientRect().height-20)<3);
  assert.equal(new URL(page.url()).hash,'#factors');
  assert.ok((await page.locator('#sources').innerText()).includes('不将其表述为本平台自行开展的调查'));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>document.querySelector('[data-report-header]').parentElement.dataset.motion==='reduce');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
  assert.deepEqual(errors,[]);
  results.push({width,height,actualProductionBuild:true,anonymousReport:true,charts:11,observations:62,scenes:17,nativeScroll:true,stickyNav:true,costStory:true,keyboardAnchor:true,motionPreferenceChange:true,horizontalOverflow:false,errors});
  await page.close();
 }
 const reduced=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await reduced.goto(`${url}#checklist`);
 await reduced.waitForFunction(()=>document.querySelector('nav [aria-current]')?.getAttribute('href')==='#advisory');
 assert.equal(await reduced.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
 await reduced.locator('nav a[href="#conclusions"]').click();await reduced.waitForURL('**/occupier-insights#conclusions');
 await reduced.locator('a[href="#report-top"]').last().click();await reduced.waitForURL('**/occupier-insights#report-top');
 await reduced.goto(app+'/');await reduced.waitForURL('**/login',{timeout:15000});
 await reduced.goto(app+'/map');await reduced.waitForURL('**/login',{timeout:15000});
 await reduced.close();
 const fallback=await browser.newPage({viewport:{width:320,height:740}});
 await fallback.addInitScript(()=>{window.IntersectionObserver=undefined;window.ResizeObserver=undefined;});
 await fallback.goto(url);await fallback.waitForFunction(()=>document.querySelectorAll('[data-revealed]').length===11);await fallback.close();
 results.push({reducedMotionDeepLink:true,missingObserverFallback:true,anonymousInternalLinks:0,homeAndMapRequireLogin:true});
 console.log(JSON.stringify({status:'passed',results},null,2));
}finally{
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
 await browser?.close();
}
