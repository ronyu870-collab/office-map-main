// All records are synthetic. Real GoTrue/session/PostgREST/audit and production-built artifact HTTP.
// Only native model planning is scripted; no lease rows are sent to an external provider.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { loadAgentHandler } from './ai5-export-scenarios.mjs';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { grantLeaseResearch, seedLeaseResearch } from '../../supabase/tests/ai-lease-research/fixture.mjs';
export async function verifyAi5Leases({ db, service, keys, output, check, person, artifact, recover, events, decrypt, exportCaps, buildingIds }) {
  const handle = await loadAgentHandler(output), seeded = await seedLeaseResearch(db,buildingIds);
  let scenario;
  const tool = (name,args) => ({ id: randomUUID(), type:'function', function:{ name, arguments:JSON.stringify(args) } });
  const completion = calls => ({model:'synthetic-lease-planner',inputTokens:20,outputTokens:20,message:{role:'assistant',content:calls?null:'查询已完成，来源与限制见正式结果。',...(calls?{tool_calls:calls}:{})}});
  const server=createServer(async(req,res)=>{
    try {
      const chunks=[]; for await(const chunk of req) chunks.push(chunk);
      const response=await handle(new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,body:Buffer.concat(chunks)}),{
        client:service,keys,enabled:true,invokeModel:async messages=>{
          // Check actual provider-bound input, not just the response table.
          const content=JSON.stringify(messages);
          for(const secret of ['合成保密客户_禁止模型日志','synthetic-lease-7','agency_person','submitter_name']) assert.equal(content.includes(secret),false);
          const step=scenario.round++;
          if(step===0) {
            if(scenario.textOnly) return completion();
            if(scenario.importResultId) { assert.ok(content.includes(scenario.importResultId)); return completion([tool('export_table',{resultIds:[scenario.importResultId],format:'xlsx'})]); }
            return completion([tool('query_lease_transactions',scenario.plan)]);
          }
          const observations=messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
          const resultId=observations.find(o=>o.resultId)?.resultId;
          if(step===1) {
            if(scenario.plan.mode==='details') {
              const detailObservation=JSON.stringify(observations[0]);
              assert.equal(detailObservation.includes('A座'),false); assert.equal(detailObservation.includes('300.75'),false);
            }
            await scenario.beforeFollowup?.();
            if(scenario.followup) return completion([tool(scenario.followup,{...scenario.followupArgs,...(scenario.followup==='export_table'?{resultIds:[resultId],format:'xlsx'}:scenario.followup==='list_buildings'?{}:{resultId})})]);
          }
          await scenario.beforeAnswer?.(); return completion();
        }});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    } catch {res.writeHead(500);res.end('synthetic scenario failed');}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const endpoint='http://127.0.0.1:'+server.address().port;
  let who=await person('admin','ai5-lease');
  const other=await person('admin','ai5-lease-other');
  const nextActor = async label => { who = await person('admin','ai5-lease-'+label); };
  const base={source:'combined',from:'2026-01-01',to:'2026-12-31',submarkets:['CBD']};
  const grant=async(options={})=>{ await grantQuery({setup:db},who.id,{capabilities:exportCaps}); await grantLeaseResearch(db,who.id,{allSubmarkets:false,submarkets:['CBD'],...options}); };
  async function submit(plan=base,options={},actor=who,conversation={id:randomUUID()}) {
    scenario={plan,round:0,...options};
    const response=await fetch(endpoint+'/api/intelligence/query/agent',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+actor.token},body:JSON.stringify({idempotencyKey:randomUUID(),question:options.question??'按照季度统计租赁成交总面积和成交数量；历史与当前合并但不要重复计数。',conversation})});
    return {status:response.status,body:await response.json(),actor};
  }
  const n=(r,key,index=0)=>r.table.rows[index].cells[key].value.numeric;
  const download=(source,actor=source.actor,format='xlsx')=>artifact(actor,{requestId:source.body.requestId,resultId:source.body.result.resultId,action:'export',format});
  try {
    await grantQuery({setup:db},who.id,{capabilities:exportCaps});
    await check('AI5成交 / 有AI资格但无独立成交研究资格拒绝',async()=>assert.equal((await submit()).status,403));
    await grant(); let combined, textHistory;
    await check('AI5成交 / 当前、历史、两表合并覆盖与人工核验去重',async()=>{
      for(const [source,count,area] of [['live',4,300.75],['history',3,900.25],['combined',6,1100.75]]) {
        const r=await submit({...base,source});assert.equal(r.status,200);assert.equal(n(r.body.result,'count'),count);assert.equal(n(r.body.result,'area'),area);
        if(source==='combined')combined=r;
      }
    });
    await check('AI5成交 / 当前对话恢复获权结果继续导出，纯文字续轮仍绑定成交权限',async()=>{
      const restored=await submit(base,{importResultId:combined.body.result.resultId},who,{...combined.body.conversation,parentRequestId:combined.body.requestId});
      assert.equal(restored.status,200,JSON.stringify(restored.body));assert.equal((await download(restored)).status,200);
      textHistory=await submit(base,{textOnly:true},who,{...restored.body.conversation,parentRequestId:restored.body.requestId});
      assert.equal(textHistory.status,200);assert.equal(textHistory.body.result.parameters.dataDomain,'lease-research/1');
    });
    await check('AI5成交 / 楼宇别名、记录级映射、行业分组、楼宇排名及季度低精度',async()=>{
      const alias=await submit({...base,buildingName:'合成历史楼名'});assert.equal(n(alias.body.result,'area'),300.75);
      const ranked=await submit({...base,industries:['TMT'],groupBy:'building',topN:1});assert.equal(n(ranked.body.result,'area'),500);assert.match(ranked.body.result.table.rows[0].cells.group.value,/未分摊/);
      const q=await submit({...base,groupBy:'quarter',sort:'period',direction:'asc'});assert.equal(q.status,200);
      const q1=q.body.result.table.rows.find(r=>r.cells.group.value==='2026-Q1');assert.equal(q1.cells.count.value.numeric,3);assert.equal(q1.cells.area.value.numeric,100.25);
      const q2=q.body.result.table.rows.find(r=>r.cells.group.value==='2026-Q2');assert.equal(q2.cells.count.value.numeric,2);assert.equal(q2.cells.area.value.numeric,500.5);
      assert.equal(q.body.result.parameters.leaseCoverage.uncertainQuarter,1);
      const byIndustry=await submit({...base,groupBy:'industry'});assert.equal(byIndustry.body.result.table.rows.length,2);
    });
    await check('AI5成交 / 聚合专用资格抑制小样本，明细和财务分别拒绝',async()=>{
      await nextActor('fields'); await grant({details:false});
      const aggregate=await submit({...base,groupBy:'quarter'});assert.equal(aggregate.status,200);assert.equal(aggregate.body.result.table.rows.length,4);assert.equal(aggregate.body.result.table.rows.filter(row=>row.cells.count.kind==='number').length,1);
      assert.equal((await submit({...base,mode:'details'})).status,403);
      await grant(); assert.equal((await submit({...base,mode:'details',fields:['area','liveEffectiveRent']})).status,403);
    });
    await check('AI5成交 / 获权财务明细分表保留原始租金，不发送模型；分页亦不发送明细',async()=>{
      await grant({financials:true});
      const r=await submit({...base,mode:'details',fields:['area','liveFaceRent','liveEffectiveRent','historyFaceRent','historyEffectiveRent','historyManagementFee']},{followup:'read_result_page',followupArgs:{offset:0,limit:100}});
      assert.equal(r.status,200);const result=r.body.result;
      assert.ok(result.table.rows.some(row=>row.cells.liveEffectiveRent.kind==='number'&&row.cells.liveEffectiveRent.value.numeric===210));
      assert.ok(result.table.rows.some(row=>row.cells.historyEffectiveRent.kind==='number'&&row.cells.historyEffectiveRent.value.numeric===150));
      assert.ok(result.table.rows.some(row=>row.cells.area.kind==='unknown'));
      assert.ok(result.table.rows.some(row=>row.cells.area.kind==='number'&&row.cells.area.value.numeric===0));
      assert.equal(JSON.stringify(result).includes('合成保密客户'),false);
    });
    let exported;
    await check('AI5成交 / 完整脱敏Excel真实HTTP下载回读、选择字段、来源不含客户',async()=>{
      await grant();
      const r=await submit({...base,mode:'details'},{followup:'export_table',followupArgs:{fields:['building','industry','area'],singleSheet:true},question:'2025—2026年这栋楼有哪些租赁成交？把完整获权脱敏结果导出Excel。'});
      assert.equal(r.status,200);assert.equal(r.body.result.table.rows.length,6);
      const file=await download(r);assert.equal(file.status,200,JSON.stringify(file.body));
      const book=XLSX.read(file.bytes,{type:'array'});assert.equal(book.SheetNames.length,1);
      const sheet=book.Sheets[book.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sheet,{header:1,range:sheet['!autofilter'].ref});
      assert.equal(rows.length,7);assert.equal(rows[0].length,3);assert.ok(rows.some(row=>row[0]==='合成多栋项目'));
      assert.equal(rows.slice(1).reduce((sum,row)=>sum+(typeof row[2]==='number'?row[2]:0),0),1100.75);
      for(const row of XLSX.utils.sheet_to_json(sheet,{header:1}))assert.equal(JSON.stringify(row).includes('合成保密客户'),false);
      const audit = (await events(file.headers.get('x-audit-attempt-id'))).map(decrypt);
      assert.ok(audit.some(e=>e.content?.result?.artifact?.kind==='download'&&e.content.result.artifact.format==='xlsx'));
      exported=r;
    });
    await check('AI5成交 / CSV中文与来源ZIP真实回读，延续原有公式防护',async()=>{
      const file=await download(exported,who,'csv_zip');assert.equal(file.status,200);
      const zip=await JSZip.loadAsync(file.bytes),csv=await zip.file('data.csv').async('string'),manifest=JSON.parse(await zip.file('manifest.json').async('string'));
      assert.ok(csv.includes('合成多栋项目'));assert.ok(csv.includes('1100')===false);assert.equal(manifest.resultId,exported.body.result.resultId);
      assert.equal(JSON.stringify(manifest).includes('合成保密客户'),false);
    });
    await check('AI5成交 / 同源聚合趋势图和PNG来源文件可用',async()=>{
      await nextActor('charts'); await grant();
      const r=await submit({...base,groupBy:'quarter',sort:'period',direction:'asc'},{followup:'create_chart',followupArgs:{chart:{kind:'plot',type:'line',x:'group',y:['area']}}});assert.equal(r.status,200);
      const image=await artifact(who,{requestId:r.body.requestId,resultId:r.body.result.resultId,action:'export',format:'png_zip',chart:{kind:'plot',type:'line',x:'group',y:['area']}});
      assert.equal(image.status,200,JSON.stringify(image.body));const zip=await JSZip.loadAsync(image.bytes),png=await zip.file('chart.png').async('uint8array');
      assert.equal(Buffer.from(png.subarray(0,8)).toString('hex'),'89504e470d0a1a0a');
    });
    await check('AI5成交 / 下载跨用户隔离、客户端RPC禁止及服务身份会话不匹配拒绝',async()=>{
      await grantQuery({setup:db},other.id,{capabilities:exportCaps});await grantLeaseResearch(db,other.id);
      assert.equal((await download(exported,other)).status,403);assert.equal((await recover(other,exported.body.requestId)).status,403);
      assert.ok((await who.client.rpc('ai_lease_research_snapshot',{p_actor:who.id,p_effective:who.id,p_session:who.sessionId})).error);
      const mismatch=await service.rpc('ai_lease_research_snapshot',{p_actor:who.id,p_effective:who.id,p_session:other.sessionId});assert.equal(mismatch.data.allowed,false);
    });
    await check('AI5成交 / 独立导出撤权、研究撤权及历史恢复均拒绝',async()=>{
      await nextActor('revocation'); await grant(); exported=await submit(base,{followup:'export_table'});assert.equal(exported.status,200);
      await db.query('update private.ai_lease_research_grants set allow_export=false where user_id=$1',[who.id]);assert.equal((await download(exported)).status,403);
      const queryOnly=await submit({...base,groupBy:'building'});assert.equal(queryOnly.status,200);assert.equal((await download(queryOnly)).status,403);
      const inline=await artifact(who,{requestId:queryOnly.body.requestId,resultId:queryOnly.body.result.resultId,action:'chart',chart:{kind:'plot',type:'bar',x:'group',y:['area']}});assert.equal(inline.status,200);
      await db.query('update private.ai_lease_research_grants set enabled=false where user_id=$1',[who.id]);
      await db.query('update private.ai_lease_research_grants set enabled=false where user_id=$1',[combined.actor.id]);
      assert.equal((await recover(combined.actor,combined.body.requestId)).status,403);assert.equal((await recover(textHistory.actor,textHistory.body.requestId)).status,403);assert.equal((await download(exported)).status,403);
      assert.equal((await submit()).status,403);await grant();
    });
    await check('AI5成交 / 生成途中撤权不能交付文件，审计标记拒绝',async()=>{
      const r=await submit({...base,mode:'details'},{followup:'export_table',beforeFollowup:()=>db.query('update private.ai_lease_research_grants set enabled=false where user_id=$1',[who.id])});
      assert.equal(r.status,403);assert.equal(r.body.result,undefined);assert.ok((await events(r.body.requestId)).some(e=>e.kind==='denied'));await grant();
    });
    await check('AI5成交 / 文件已生成后最终回答前撤权仍不交付',async()=>{
      let changed=false;
      const r=await submit({...base,mode:'details'},{followup:'export_table',beforeAnswer:async()=>{if(!changed){changed=true;await db.query('update private.ai_lease_research_grants set enabled=false where user_id=$1',[who.id]);}}});
      assert.equal(r.status,403);assert.equal(r.body.result,undefined);await grant();
    });
    await check('AI5成交 / 混合季度和成交研究的最终档案仍复核成交权限',async()=>{
      await nextActor('mixed');await grant();
      const mixed=await submit(base,{followup:'list_buildings',followupArgs:{scope:{inventory:'all_authorized',buildingIds},fields:[],period:null}});
      assert.equal(mixed.status,200);assert.equal(mixed.body.result.parameters.dataDomain,undefined);assert.ok(mixed.body.result.parameters.leaseBindings.length);
      await db.query('update private.ai_lease_research_grants set enabled=false where user_id=$1',[who.id]);assert.equal((await recover(who,mixed.body.requestId)).status,403);
    });
    await check('AI5成交 / 原记录或映射变更阻止旧文件并将过期去重关联明确保留为两条',async()=>{
      await nextActor('source-change'); await grant();
      const old=await submit(base,{followup:'export_table'});assert.equal(old.status,200);
      await db.query('update public.lease_transactions_history set area_sqm=101 where id=$1',[seeded.ids[4]]);
      assert.equal((await download(old)).status,403);
      const next=await submit();assert.equal(n(next.body.result,'count'),7);assert.equal(n(next.body.result,'area'),1201.75);assert.equal(next.body.result.parameters.leaseCoverage.staleDuplicateLinks,1);
      const prior=await submit(base,{followup:'export_table'});
      await db.query('update public.lease_building_name_map set building_id=$1 where alias_name=$2',[buildingIds[2],'合成历史楼名']);
      assert.equal((await download(prior)).status,403);
    });
  } finally {server.close();await once(server,'close');}
}
