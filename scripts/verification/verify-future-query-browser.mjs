// Optional real browser acceptance against the dedicated, synthetic Auth preview.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),{chromium}=require('playwright'),pg=require('pg'),XLSX=require('xlsx'),JSZip=require('jszip');
assert.equal(process.env.AI_QUERY_AUTH_ALLOW_LOCAL,'disposable');
const cfg=JSON.parse(await readFile(process.env.AI_QUERY_AUTH_PREVIEW_FILE,'utf8')),settings=JSON.parse(await readFile(process.env.AI_QUERY_AUTH_STATUS,'utf8'));
assert.equal(cfg.app,'http://127.0.0.1:3289');const url=new URL(settings.DB_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55992');
const db=new pg.Client({connectionString:settings.DB_URL});await db.connect();
const browser=await chromium.launch({headless:true,...(process.env.AI_QUERY_BROWSER_CHANNEL?{channel:process.env.AI_QUERY_BROWSER_CHANNEL}:{})}),output=path.resolve('docs/verification/future-query');await mkdir(output,{recursive:true});
const evidence={browser:browser.version(),synthetic:true,production:false,realMobileDevices:false,checks:[],downloads:[],screenshots:[]};
const save=async(page,name)=>{await page.screenshot({path:path.join(output,name+'.png')});evidence.screenshots.push(name+'.png');};
const initial=(await db.query('select * from private.ai_query_grants where user_id=$1',[cfg.userId])).rows[0];
try{
 await db.query("update private.ai_query_grants set capabilities=array['query:future-catalog','query:future-progress','query:future-quality','export:internal'],all_buildings=false,building_ids='{}' where user_id=$1",[cfg.userId]);
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<640,hasTouch:width<640,acceptDownloads:true});
  try{
   await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
   const page=await context.newPage();page.setDefaultTimeout(20000);
   await page.goto(cfg.app+'/login');await page.getByLabel('企业邮箱').fill(cfg.email);await page.getByLabel('手机号',{exact:true}).fill(cfg.phone);await page.locator('#password').fill(cfg.password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(cfg.app+'/');
   const input=page.locator('#home-query');await page.waitForFunction(()=>!!document.querySelector('#home-query')&&!document.querySelector('#home-query').disabled);
   await page.getByText('查看提问示例与查询范围',{exact:true}).click();assert.equal(await page.getByRole('button',{name:'CBD有哪些楼',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'CBD未来供应有哪些',exact:true}).count(),1);await page.getByText('查看提问示例与查询范围',{exact:true}).click();
   await input.click();await input.pressSequentially('C');assert.equal(await input.evaluate(e=>e===document.activeElement),true);await input.pressSequentially('BD未来供应有哪些');await input.press('Home');await input.press('ArrowRight');await input.pressSequentially('x');await input.press('Backspace');assert.equal(await input.inputValue(),'CBD未来供应有哪些');assert.equal(await input.evaluate(e=>e===document.activeElement),true);
   evidence.checks.push({width,case:'future-only examples and uninterrupted input with mid-text edit',passed:true});
   const ask=async question=>{await input.fill(question);const pending=page.waitForResponse(r=>r.url().endsWith('/api/intelligence/query')&&r.request().method()==='POST');await page.getByRole('button',{name:'发送问题'}).click();const response=await pending;assert.equal(response.status(),200);const reply=await response.json();await page.getByRole('region',{name:'查询结果',exact:true}).waitFor();for(const text of reply.result.parameters.answer.paragraphs)await page.getByText(text,{exact:true}).waitFor({state:'visible'});return reply;};
   const catalog=await ask('CBD未来供应有哪些');assert.equal(catalog.result.analysis.catalog.records,5);assert.equal(catalog.result.analysis.catalog.missingArea,1);
   await page.getByRole('region',{name:'查询结果',exact:true}).scrollIntoViewIfNeeded();await save(page,`${width}-catalog`);
   const source=page.getByRole('button',{name:'查看来源：预计入市时间 2026年下半年（季度未定）',exact:true});await source.click();const panel=page.getByRole('region',{name:'来源详情',exact:true});assert.match(await panel.innerText(),/launch_quarter/);assert.match(await panel.innerText(),/H2/);await save(page,`${width}-source`);await page.getByRole('button',{name:'关闭来源'}).click();assert.equal(await source.evaluate(e=>e===document.activeElement),true);
   evidence.checks.push({width,case:'catalog unknown area and half-year original source; source close restores focus',passed:true});
   const progress=await ask('当前填报季度CBD未来供应填报进度');assert.match(progress.result.parameters.answer.paragraphs[0],/提交覆盖率 66.67%/);
   const drawn=page.waitForResponse(r=>r.url().endsWith('/query/artifact'));await page.getByRole('button',{name:'查看柱状图',exact:true}).click();const chart=await (await drawn).json();assert.deepEqual(chart.chart.points.map(p=>p.y),[2,1,0,2]);await page.getByRole('figure',{name:'同源查询图表'}).scrollIntoViewIfNeeded();await save(page,`${width}-progress-chart`);
   const quality=await ask('2026Q3CBD未来供应填报数据质量');assert.match(quality.result.parameters.answer.paragraphs[0],/最新提交可核查 2 条/);assert.match(quality.result.parameters.answer.paragraphs[0],/缺项 1 条/);assert.match(quality.result.parameters.answer.paragraphs[1],/3 条无该季提交/);
   const result=page.getByRole('region',{name:'查询结果',exact:true});await result.scrollIntoViewIfNeeded();await save(page,`${width}-quality`);
   const scroll=page.getByRole('region',{name:'查询结果',exact:true}).locator('table').locator('..');assert.ok(await scroll.evaluate(e=>e.scrollWidth>=e.clientWidth));if(width<640)assert.ok(await scroll.evaluate(e=>e.scrollWidth>e.clientWidth));
   const nameCell=scroll.locator('tbody tr').first().locator('td').first(),x=(await nameCell.boundingBox()).x;
   await scroll.evaluate(e=>{e.scrollLeft=500;e.scrollTop=100;});
   assert.ok(Math.abs((await nameCell.boundingBox()).x-x)<2);const head=scroll.locator('th').first();assert.ok(Math.abs((await head.boundingBox()).y-(await scroll.boundingBox()).y)<3);
   await save(page,`${width}-quality-scroll`);await scroll.evaluate(e=>{e.scrollLeft=0;e.scrollTop=0;});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   await page.getByText('来源、口径与结果版本',{exact:true}).click();assert.equal(await page.getByText(/分配使用所查季度当前保存的任务记录/).isVisible(),true);await page.getByText('来源、口径与结果版本',{exact:true}).click();
   await page.getByText('下载本次结果',{exact:true}).click();
   for(const [label,format] of [['Excel','xlsx'],...(width===1280?[['CSV 与来源','csv_zip'],['SVG 图与来源','svg_zip']]:[])]){
    const downloading=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const download=await downloading;const file=path.join(tmpdir(),`colliers-future-${width}-${format}-${quality.result.resultId}`);await download.saveAs(file);const bytes=await readFile(file);
    if(format==='xlsx'){
     const book=XLSX.read(bytes,{type:'buffer'}),explanation=XLSX.utils.sheet_to_json(book.Sheets['查询说明'],{header:1}),data=XLSX.utils.sheet_to_json(book.Sheets['未来填报质量'],{header:1});
     assert.deepEqual(explanation.filter(r=>r[0]==='回答').map(r=>r[1]),quality.result.parameters.answer.paragraphs);assert.equal(explanation[0][1],quality.result.resultId);
     const idx=data[2].findIndex(v=>String(v).startsWith('填报空置率'));assert.deepEqual(data.slice(3).map(r=>r[idx]).filter(v=>typeof v==='number'),[0.5,0.5]);assert.equal(data.slice(3).filter(r=>r[idx]==='未记录').length,3);
    }else{const zip=await JSZip.loadAsync(bytes),manifest=JSON.parse(await zip.file('manifest.json').async('string'));assert.equal(manifest.resultId,quality.result.resultId);assert.deepEqual(manifest.parameters.answer.paragraphs,quality.result.parameters.answer.paragraphs);if(format==='svg_zip')assert.ok((await zip.file('chart.svg').async('string')).includes(quality.result.resultId));}
    evidence.downloads.push({width,format,resultId:quality.result.resultId,sha256:createHash('sha256').update(bytes).digest('hex'),readback:true});
   }
   const recovery=page.waitForResponse(r=>r.url().endsWith('/query/recover'));await page.getByRole('button',{name:'检查状态并恢复结果',exact:true}).click();const restored=await (await recovery).json();assert.equal(restored.result.resultId,quality.result.resultId);assert.deepEqual(restored.result.parameters.answer,quality.result.parameters.answer);
   evidence.checks.push({width,case:'progress chart and quality unknowns, complete source notes, actual downloads and same-result recovery',passed:true});
   if(width===390){await page.setViewportSize({width:320,height:740});await page.getByRole('region',{name:'查询结果',exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);await save(page,'320-quality');evidence.checks.push({width:320,case:'narrow viewport retains full result in local table scroll',passed:true});}
   await db.query("update public.user_roles set role='viewer' where user_id=$1",[cfg.userId]);try{await page.reload();await page.getByRole('heading',{name:'北京办公楼业务',exact:true}).waitFor();await page.getByRole('button',{name:'用户菜单',exact:true}).click();await page.getByRole('menu',{name:'账户操作'}).getByText('查看用户',{exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('#home-query'));assert.equal(await page.getByRole('link',{name:'业务智能',exact:true}).count(),0);evidence.checks.push({width,case:'real role downgrade hides AI and old browser session cannot retain entry',passed:true});}finally{await db.query("update public.user_roles set role='admin' where user_id=$1",[cfg.userId]);}
  }finally{await context.close();}
 }
 await writeFile(path.join(output,'browser-evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({checks:evidence.checks.length,downloads:evidence.downloads.length,browser:evidence.browser}));
}finally{
 await db.query("update public.user_roles set role='admin' where user_id=$1",[cfg.userId]);
 await db.query('update private.ai_query_grants set capabilities=$2,all_buildings=$3,building_ids=$4 where user_id=$1',[cfg.userId,initial.capabilities,initial.all_buildings,initial.building_ids]);
 await db.end();await browser.close();
}
