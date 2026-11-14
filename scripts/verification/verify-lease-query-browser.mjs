import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),{chromium}=require('playwright'),pg=require('pg'),XLSX=require('xlsx'),JSZip=require('jszip');
assert.equal(process.env.AI_QUERY_AUTH_ALLOW_LOCAL,'disposable');
const cfg=JSON.parse(await readFile(process.env.AI_QUERY_AUTH_PREVIEW_FILE,'utf8')),settings=JSON.parse(await readFile(process.env.AI_QUERY_AUTH_STATUS,'utf8'));
assert.equal(cfg.app,'http://127.0.0.1:3289');assert.equal(new URL(settings.DB_URL).port,'55992');
const db=new pg.Client({connectionString:settings.DB_URL});await db.connect();
const browser=await chromium.launch({headless:true,...(process.env.AI_QUERY_BROWSER_CHANNEL?{channel:process.env.AI_QUERY_BROWSER_CHANNEL}:{})});
const output=path.resolve('docs/verification/lease-query');await mkdir(output,{recursive:true});
const evidence={browser:browser.version(),synthetic:true,production:false,realMobileDevices:false,checks:[],downloads:[],screenshots:[]};
const save=async(page,name)=>{await page.screenshot({path:path.join(output,name+'.png')});evidence.screenshots.push(name+'.png');};
const initial=(await db.query('select * from private.ai_query_grants where user_id=$1',[cfg.userId])).rows[0],ids=[randomUUID(),randomUUID()],history=randomUUID();
try{
 await db.query("update private.ai_query_grants set capabilities=array['query:leases','export:internal'],all_buildings=false,building_ids='{}',all_lease_records=true,lease_sources=array['live','history'],lease_fields=array['area_sqm','face_rent','effective_rent'],all_submarkets=false,submarkets=array['CBD'] where user_id=$1",[cfg.userId]);
 await db.query("insert into public.lease_transactions(id,company,new_building,sub_market,area_sqm,effective_rent,transaction_year,transaction_quarter) values($1,'合成甲企业','合成项目甲','CBD',100,8,2026,'Q3'),($2,'合成乙企业','合成项目乙','CBD',300,12,2026,'Q3')",ids);
 await db.query("insert into public.lease_transactions_history(id,source_uid,company,new_building,sub_market,area_sqm,effective_rent,transaction_year) values($1,$2,'合成年份企业','合成历史项目','CBD',100,8,2026)",[history,'browser-'+history]);
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<640,hasTouch:width<640,acceptDownloads:true});
  try{
   assert.equal(initial.all_future_supplies,true);
   await db.query("update private.ai_query_grants set capabilities=array['query:catalog','query:brochure','query:quarter','query:submission-progress','query:submission-quality','query:future-catalog','query:future-progress','query:future-quality','query:leases','export:internal'],all_buildings=true where user_id=$1",[cfg.userId]);
   await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
   const page=await context.newPage();page.setDefaultTimeout(20000);
   await page.goto(cfg.app+'/login');await page.getByLabel('企业邮箱').fill(cfg.email);await page.getByLabel('手机号',{exact:true}).fill(cfg.phone);await page.locator('#password').fill(cfg.password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(cfg.app+'/');
   const input=page.locator('#home-query');await page.waitForFunction(()=>!!document.querySelector('#home-query')&&!document.querySelector('#home-query').disabled);
   await page.getByText('查看提问示例与查询范围',{exact:true}).click();
   for(const name of ['CBD有哪些楼','CBD未来供应有哪些','CBD日常成交明细'])await page.getByRole('button',{name,exact:true}).waitFor();
   assert.equal(await page.locator('details').filter({has:page.getByText('查看提问示例与查询范围',{exact:true})}).getByRole('button').count(),20);
   evidence.checks.push({width,case:'combined stock/future/lease admin scope stays usable within the 20-example client limit',passed:true});
   await db.query("update private.ai_query_grants set capabilities=array['query:leases','export:internal'],all_buildings=false where user_id=$1",[cfg.userId]);await page.reload();await page.waitForFunction(()=>!!document.querySelector('#home-query')&&!document.querySelector('#home-query').disabled);
   await page.getByText('查看提问示例与查询范围',{exact:true}).click();assert.equal(await page.getByRole('button',{name:'CBD日常成交明细',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'CBD有哪些楼',exact:true}).count(),0);await page.getByText('查看提问示例与查询范围',{exact:true}).click();
   await input.click();await input.pressSequentially('CBD日常成交面积汇总');await input.press('Home');await input.press('ArrowRight');await input.pressSequentially('x');await input.press('Backspace');assert.equal(await input.inputValue(),'CBD日常成交面积汇总');assert.equal(await input.evaluate(e=>e===document.activeElement),true);
   evidence.checks.push({width,case:'lease-only examples and uninterrupted input',passed:true});
   const ask=async question=>{await input.fill(question);const pending=page.waitForResponse(r=>r.url().endsWith('/api/intelligence/query')&&r.request().method()==='POST');await page.getByRole('button',{name:'发送问题'}).click();const response=await pending;assert.equal(response.status(),200);const reply=await response.json();await page.getByRole('region',{name:'查询结果',exact:true}).waitFor();for(const text of reply.result.parameters.answer.paragraphs)await page.getByText(text,{exact:true}).waitFor({state:'visible'});return reply;};
   const area=await ask('2026Q3CBD全部来源成交面积汇总');assert.equal(area.result.parameters.coverage.possible,1);assert.deepEqual(area.result.table.rows.map(r=>r.cells.area.kind==='number'?r.cells.area.value.numeric:null),[400,null]);
   await page.getByRole('region',{name:'查询结果',exact:true}).scrollIntoViewIfNeeded();await save(page,`${width}-area`);
   await page.getByRole('combobox',{name:/^图表指标/}).selectOption('area');const drawing=page.waitForResponse(r=>r.url().endsWith('/query/artifact'));await page.getByRole('button',{name:'查看柱状图',exact:true}).click();const chart=await (await drawing).json();assert.deepEqual(chart.chart.points.map(p=>p.y),[400,null]);
   await page.getByRole('figure',{name:'同源查询图表'}).scrollIntoViewIfNeeded();await save(page,`${width}-chart`);
   const source=page.getByRole('button',{name:'查看来源：已知成交面积合计 400',exact:true});await source.click();await page.getByRole('region',{name:'来源详情',exact:true}).waitFor();assert.match(await page.getByRole('region',{name:'来源详情',exact:true}).innerText(),/lease_transactions_read_v1/);await page.getByRole('button',{name:'关闭来源'}).click();assert.equal(await source.evaluate(e=>e===document.activeElement),true);
   for(const format of ['xlsx','svg_zip']){
    const details=page.locator('details').filter({has:page.getByText('下载本次结果',{exact:true})});if(await details.getAttribute('open')===null)await page.getByText('下载本次结果',{exact:true}).click();
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:format==='xlsx'?'Excel':'SVG 图与来源',exact:true}).click();const file=await pending,p=path.join(tmpdir(),`colliers-lease-browser-${randomUUID()}`);await file.saveAs(p);const bytes=await readFile(p);await unlink(p);
    if(format==='xlsx'){const book=XLSX.read(bytes,{type:'buffer'});assert.ok(book.SheetNames.includes('查询说明'));assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets['数据'],{header:1}).slice(1).map(r=>r.at(-1)),[400,'未记录']);}
    else{const zip=await JSZip.loadAsync(bytes),m=JSON.parse(await zip.file('manifest.json').async('string'));assert.equal(m.resultId,area.result.resultId);assert.deepEqual(m.chart,chart.chart);}
    evidence.downloads.push({width,format,resultId:area.result.resultId,sha256:createHash('sha256').update(bytes).digest('hex'),readback:true});
   }
   evidence.checks.push({width,case:'quarter precision, unknown historical area, same-source chart, source focus and XLSX/SVG readback',passed:true});
   const rent=await ask('2026Q3CBD日常成交有效租金');assert.equal(rent.result.table.rows.find(r=>r.entityId==='live/not_marked_estimated').cells.rent.value.numeric,11);
   await page.getByRole('region',{name:'查询结果',exact:true}).scrollIntoViewIfNeeded();await save(page,`${width}-rent`);
   const table=page.getByLabel('查询结果表，可横向滚动',{exact:true});if(width<640){assert.ok(await table.evaluate(e=>e.scrollWidth>e.clientWidth));await table.focus();await table.press('ArrowRight');}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);evidence.checks.push({width,case:'exact rent 11 and mobile local table scroll without page overflow',passed:true});
   if(width===390){await page.setViewportSize({width:320,height:740});await page.getByRole('region',{name:'查询结果',exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);await save(page,'320-rent');evidence.checks.push({width:320,case:'narrow viewport preserves readable answer and locally scrollable full rent table',passed:true});await page.setViewportSize({width,height:900});}
   await page.reload();await page.waitForFunction(()=>!!document.querySelector('#home-query')&&!document.querySelector('#home-query').disabled);
   const catalog=await ask('企业「合成甲企业」日常成交明细');assert.equal(catalog.result.table.rows.length,1);
   await page.getByRole('region',{name:'查询结果',exact:true}).scrollIntoViewIfNeeded();await save(page,`${width}-company`);
   await db.query("update public.user_roles set role='viewer' where user_id=$1",[cfg.userId]);try{await page.reload();await page.getByRole('heading',{name:'北京办公楼业务',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('#home-query'));}finally{await db.query("update public.user_roles set role='admin' where user_id=$1",[cfg.userId]);}
   evidence.checks.push({width,case:'exact company lookup and live role downgrade removes AI entry',passed:true});
  }finally{await context.close();}
 }
 await writeFile(path.join(output,'browser-evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({leaseChecks:evidence.checks.length,downloads:evidence.downloads.length,browser:evidence.browser}));
}finally{
 await db.query("update public.user_roles set role='admin' where user_id=$1",[cfg.userId]);
 await db.query('update private.ai_query_grants set capabilities=$2,all_buildings=$3,building_ids=$4,all_lease_records=$5,lease_record_ids=$6,lease_sources=$7,lease_fields=$8,all_submarkets=$9,submarkets=$10 where user_id=$1',[cfg.userId,initial.capabilities,initial.all_buildings,initial.building_ids,initial.all_lease_records,initial.lease_record_ids,initial.lease_sources,initial.lease_fields,initial.all_submarkets,initial.submarkets]);
 await db.query('delete from public.lease_transactions where id=any($1::uuid[])',[ids]);await db.query('delete from public.lease_transactions_history where id=$1',[history]);await db.end();await browser.close();
}
