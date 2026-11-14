import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),{chromium}=require('playwright'),pg=require('pg'),XLSX=require('xlsx'),JSZip=require('jszip');
assert.equal(process.env.AI_QUERY_AUTH_ALLOW_LOCAL,'disposable');
const cfg=JSON.parse(await readFile(process.env.AI_QUERY_AUTH_PREVIEW_FILE,'utf8')),settings=JSON.parse(await readFile(process.env.AI_QUERY_AUTH_STATUS,'utf8'));
assert.equal(cfg.app,'http://127.0.0.1:3289');assert.equal(new URL(settings.DB_URL).hostname,'127.0.0.1');assert.equal(new URL(settings.DB_URL).port,'55992');
const db=new pg.Client({connectionString:settings.DB_URL});await db.connect();
const browser=await chromium.launch({headless:true,...(process.env.AI_QUERY_BROWSER_CHANNEL?{channel:process.env.AI_QUERY_BROWSER_CHANNEL}:{})});
const output=path.resolve('docs/verification/lease-analytics');await mkdir(output,{recursive:true});
const evidence={browser:browser.version(),synthetic:true,production:false,realMobileDevices:false,checks:[],downloads:[],screenshots:[]};
const save=async(page,name)=>{await page.screenshot({path:path.join(output,name+'.png')});evidence.screenshots.push(name+'.png');};
const initial=(await db.query('select * from private.ai_query_grants where user_id=$1',[cfg.userId])).rows[0],ids=[randomUUID(),randomUUID()],history=randomUUID();
try{
 await db.query("update private.ai_query_grants set capabilities=array['query:leases','export:internal'],all_buildings=false,building_ids='{}',all_lease_records=true,lease_sources=array['live','history'],lease_fields=array['area_sqm','industry','sub_industry','demand_type'],all_submarkets=false,submarkets=array['CBD'] where user_id=$1",[cfg.userId]);
 await db.query("insert into public.lease_transactions(id,company,new_building,sub_market,industry,area_sqm,transaction_year,transaction_quarter) values($1,'合成金融企业','合成统计甲楼','CBD','金融',100,2026,'Q3'),($2,'合成科技企业','合成统计乙楼','CBD','科技',300,2026,'Q3')",ids);
 await db.query("insert into public.lease_transactions_history(id,source_uid,company,new_building,sub_market,area_sqm,transaction_year) values($1,$2,'合成年份企业','合成历史统计楼','CBD',100,2026)",[history,'analytics-browser-'+history]);
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<640,hasTouch:width<640,acceptDownloads:true});
  try{
   await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
   const page=await context.newPage();page.setDefaultTimeout(20000);
   await page.goto(cfg.app+'/login');await page.getByLabel('企业邮箱').fill(cfg.email);await page.getByLabel('手机号',{exact:true}).fill(cfg.phone);await page.locator('#password').fill(cfg.password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(cfg.app+'/');
   const input=page.locator('#home-query');await page.waitForFunction(()=>!!document.querySelector('#home-query')&&!document.querySelector('#home-query').disabled);
   await page.getByText('查看提问示例与查询范围',{exact:true}).click();await page.getByRole('button',{name:'CBD日常成交行业占比',exact:true}).waitFor();await page.getByText('查看提问示例与查询范围',{exact:true}).click();
   const ask=async question=>{await input.fill(question);const pending=page.waitForResponse(r=>r.url().endsWith('/api/intelligence/query')&&r.request().method()==='POST');await page.getByRole('button',{name:'发送问题'}).click();const response=await pending;assert.equal(response.status(),200);const reply=await response.json();await page.getByRole('region',{name:'查询结果',exact:true}).waitFor();for(const text of reply.result.parameters.answer.paragraphs)await page.getByText(text,{exact:true}).waitFor();return reply;};
   const groups=await ask('CBD全部来源成交行业占比');assert.equal(groups.result.table.rows.length,3);assert.equal(groups.result.parameters.leaseAnalytics.sourceTotals[1].unknownCategoryRecords,1);
   await page.getByRole('region',{name:'查询结果',exact:true}).scrollIntoViewIfNeeded();await save(page,`${width}-industry`);
   assert.equal(await page.getByRole('combobox',{name:/^图表指标/}).inputValue(),'areaShare');
   let pending=page.waitForResponse(r=>r.url().endsWith('/query/artifact'));await page.getByRole('button',{name:'查看柱状图',exact:true}).click();let chart=await(await pending).json();assert.deepEqual(chart.chart.points.map(p=>p.y).sort((a,b)=>a-b),[25,75,100]);
   await page.getByRole('figure',{name:'同源查询图表'}).scrollIntoViewIfNeeded();await save(page,`${width}-share-chart`);
   const source=page.getByRole('button',{name:'查看来源：同来源已知面积占比 25',exact:true});await source.click();const panel=page.getByRole('region',{name:'来源详情',exact:true});assert.match(await panel.innerText(),/area_sqm/);await page.getByRole('button',{name:'关闭来源',exact:true}).click();assert.equal(await source.evaluate(e=>e===document.activeElement),true);
   evidence.checks.push({width,case:'authorized industry examples, distinct missing classification, source-separated percentage chart and full denominator source focus',passed:true});
   const trend=await ask('CBD全部来源成交2026Q1至2026Q4趋势');assert.equal(trend.result.parameters.coverage.possible,1);assert.equal(trend.result.table.rows.length,8);
   pending=page.waitForResponse(r=>r.url().endsWith('/query/artifact'));await page.getByRole('button',{name:'查看折线图',exact:true}).click();chart=await(await pending).json();assert.deepEqual(chart.chart.facets.map(f=>f.points.map(p=>p.y)),[[null,null,400,null],[null,null,null,null]]);
   const figure=page.getByRole('figure',{name:'同源查询图表'});await figure.scrollIntoViewIfNeeded();await save(page,`${width}-trend`);
   for(const field of ['count','names','area']){await page.getByRole('combobox',{name:/^图表指标/}).selectOption(field);pending=page.waitForResponse(r=>r.url().endsWith('/query/artifact'));await page.getByRole('button',{name:'更新折线图',exact:true}).click();chart=await(await pending).json();assert.equal(chart.chart.request.field,field);}
   assert.deepEqual(chart.chart.facets[0].points.map(p=>p.y),[null,null,400,null]);
   evidence.checks.push({width,case:'quarter allocation, year-only exclusion, gaps and same-result area/record/name chart switching',passed:true});
   for(const [label,format]of [['Excel','xlsx'],['SVG 图与来源','svg_zip']]){
    const menu=page.locator('details').filter({has:page.getByText('下载本次结果',{exact:true})});if(await menu.getAttribute('open')===null)await page.getByText('下载本次结果',{exact:true}).click();
    const downloading=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const download=await downloading,file=path.join(tmpdir(),'colliers-analytics-'+randomUUID());await download.saveAs(file);const bytes=await readFile(file);await unlink(file);
    if(format==='xlsx'){const book=XLSX.read(bytes,{type:'buffer'});assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets['数据'],{header:1}).slice(1).map(r=>r.at(-1)),['未记录','未记录',400,'未记录','未记录','未记录','未记录','未记录']);}
    else{const zip=await JSZip.loadAsync(bytes),manifest=JSON.parse(await zip.file('manifest.json').async('string'));assert.equal(manifest.resultId,trend.result.resultId);assert.deepEqual(manifest.chart,chart.chart);assert.match(await zip.file('chart.svg').async('string'),/历史成交/);}
    evidence.downloads.push({width,format,resultId:trend.result.resultId,sha256:createHash('sha256').update(bytes).digest('hex'),readback:true});
   }
   pending=page.waitForResponse(r=>r.url().endsWith('/query/recover'));await page.getByRole('button',{name:'检查状态并恢复结果',exact:true}).click();assert.deepEqual((await(await pending).json()).result,trend.result);
   const table=page.getByLabel('查询结果表，可横向滚动',{exact:true});if(width<640){await table.focus();await table.press('ArrowRight');assert.ok(await table.evaluate(e=>e.scrollWidth>e.clientWidth));}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);evidence.checks.push({width,case:'XLSX/SVG readback, immutable recovery and local table scroll without page overflow',passed:true});
   if(width===390){await page.setViewportSize({width:320,height:740});await table.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);await save(page,'320-trend-table');evidence.checks.push({width:320,case:'narrow viewport retains full trend table locally scrollable',passed:true});}
  }finally{await context.close();}
 }
 await writeFile(path.join(output,'browser-evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({leaseAnalyticsChecks:evidence.checks.length,downloads:evidence.downloads.length,browser:evidence.browser}));
}finally{
 await db.query('update private.ai_query_grants set capabilities=$2,all_buildings=$3,building_ids=$4,all_lease_records=$5,lease_record_ids=$6,lease_sources=$7,lease_fields=$8,all_submarkets=$9,submarkets=$10 where user_id=$1',[cfg.userId,initial.capabilities,initial.all_buildings,initial.building_ids,initial.all_lease_records,initial.lease_record_ids,initial.lease_sources,initial.lease_fields,initial.all_submarkets,initial.submarkets]);
 await db.query('delete from public.lease_transactions where id=any($1::uuid[])',[ids]);await db.query('delete from public.lease_transactions_history where id=$1',[history]);await db.end();await browser.close();
}
