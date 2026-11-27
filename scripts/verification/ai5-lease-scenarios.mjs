// All records are synthetic. Real GoTrue/session/PostgREST/audit and production-built artifact HTTP.
// Only native model planning is scripted; no lease rows are sent to an external provider.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { loadAgentHandler } from './ai5-export-scenarios.mjs';
import { observedResultReference, assertSelectedAnswer } from './agent-result-references.mjs';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { grantLeaseResearch, seedLeaseResearch } from '../../supabase/tests/ai-lease-research/fixture.mjs';
export async function verifyAi5Leases({ db, app, service, keys, output, check, person, artifact, recover, events, decrypt, exportCaps, buildingIds }) {
  const handle = await loadAgentHandler(output), seeded = await seedLeaseResearch(db,buildingIds);
  let scenario;
  const tool = (name,args) => ({ id: randomUUID(), type:'function', function:{ name, arguments:JSON.stringify(args) } });
  const completion = calls => ({model:'synthetic-lease-planner',inputTokens:20,outputTokens:20,message:{role:'assistant',content:calls?null:'查询已完成，来源与限制见正式结果。',...(calls?{tool_calls:calls}:{})}});
  const server=createServer(async(req,res)=>{
    try {
      const chunks=[]; for await(const chunk of req) chunks.push(chunk);
      const controller = new AbortController();
      const response=await handle(new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,body:Buffer.concat(chunks),signal:controller.signal}),{
        client:service,keys,enabled:true,invokeModel:async (messages, signal)=>{
          // Check actual provider-bound input, not just the response table.
          const content=JSON.stringify(messages);
          for(const secret of ['合成保密客户_禁止模型日志','synthetic-lease-7','agency_person','submitter_name']) assert.equal(content.includes(secret),false);
          const step=scenario.round++;
          if (scenario.workbookQueries) {
            if (step === 0) return completion(scenario.workbookQueries.map(([name, args]) => tool(name, args)));
            if (step === 1) {
              const [primaryResultId, ...supporting] = scenario.workbookQueries.map(([name]) => observedResultReference(messages, name));
              return completion([tool('select_answer_results', { primaryResultId, task: 'list', status: 'answered',
                auxiliary: supporting.map(resultId => ({ resultId, role: 'supporting' })) })]);
            }
            return completion();
          }
          if(step===0) {
            if(scenario.textOnly) return completion([tool('select_answer_results',{primaryResultId:scenario.reuseResultId,task:'list',status:'answered'})]);
            if(scenario.importResultId) { assert.ok(content.includes(scenario.importResultId)); return completion([tool('export_table',{resultIds:[scenario.importResultId],format:'xlsx'})]); }
            return completion([tool('query_lease_transactions',scenario.plan)]);
          }
          const observations=messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
          const resultId=observations.find(o=>o.resultId)?.resultId;
          if(step===1) {
            if (scenario.interruptAfterDetails) {
              assert.ok(resultId, 'fault must occur after the actual lease tool creates its result');
              controller.abort();
              signal.throwIfAborted();
            }
            if(scenario.plan.mode==='details') {
              const detailObservation=JSON.stringify(observations[0]);
              assert.equal(detailObservation.includes('A座'),false); assert.equal(detailObservation.includes('300.75'),false);
            }
            await scenario.beforeFollowup?.();
            if(scenario.followup) return completion([tool(scenario.followup,{...scenario.followupArgs,...(scenario.followup==='export_table'?{resultIds:[resultId],format:'xlsx'}:scenario.followup==='list_buildings'?{}:{resultId})})]);
          }
          if(step===2 && scenario.followup==='list_buildings') {
            scenario.primaryResultId=observedResultReference(messages,'list_buildings');
            scenario.supportingResultId=observedResultReference(messages,'query_lease_transactions');
            return completion([tool('select_answer_results',{primaryResultId:scenario.primaryResultId,task:'list',status:'answered',
              auxiliary:[{resultId:scenario.supportingResultId,role:'supporting'}]})]);
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
    await check('AI5成交 / 当前对话恢复获权结果继续导出，显式复用续轮仍绑定成交权限',async()=>{
      const restored=await submit(base,{importResultId:combined.body.result.resultId},who,{...combined.body.conversation,parentRequestId:combined.body.requestId});
      assert.equal(restored.status,200,JSON.stringify(restored.body));assert.equal((await download(restored)).status,200);
      textHistory=await submit(base,{textOnly:true,reuseResultId:restored.body.result.resultId},who,{...restored.body.conversation,parentRequestId:restored.body.requestId});
      assert.equal(textHistory.status,200);assertSelectedAnswer(textHistory.body,[{role:'primary',resultId:restored.body.result.resultId}]);assert.equal(textHistory.body.result.parameters.dataDomain,'lease-research/1');
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
    await check('AI6 T17 / 同一会话的三类获权快照经真实登录生成工作簿，逐表回读并在撤权后拒绝', async () => {
      const analyst = await person('admin', 'ai6-workbook');
      const grantWorkbook = actor => grantQuery({ setup: db }, actor.id, { capabilities: exportCaps,
        fields: ['height', 'netEffectiveRent', 'totalArea'], allBuildings: false, buildingIds: buildingIds.slice(0, 3) });
      await grantWorkbook(analyst);
      await grantWorkbook(other);
      await grantLeaseResearch(db, analyst.id);
      await grantLeaseResearch(db, other.id);
      const markerId = randomUUID();
      await db.query(`insert into public.lease_transactions(id,company,new_building,industry,sub_market,area_sqm,transaction_year,transaction_quarter,transaction_date)
        values($1,'合成保密客户_禁止模型日志','=1+1','TMT','CBD',600,2026,'Q1','2026-02-02')`, [markerId]);
      try {
        const scope = { inventory: 'tracked', submarkets: ['CBD'], buildingIds: buildingIds.slice(0, 3) };
        const quarter = { year: 2026, quarter: 2 };
        const lease = { source: 'live', from: '2026-01-01', to: '2026-06-30', submarkets: ['CBD'], mode: 'details', fields: ['building', 'area'] };
        const source = await submit(lease, {
          question: '分别列出获权楼宇的建筑高度、2026Q2净有效租金汇总，另给出2026年上半年CBD逐笔租赁成交。',
          workbookQueries: [['list_buildings', { scope, fields: ['height'], period: null }],
            ['query_quarterly_metrics', { scope: { ...scope, buildingIds: buildingIds.slice(0, 2) }, period: quarter, metric: 'rent' }],
            ['query_lease_transactions', lease]],
        }, analyst);
        assert.equal(source.status, 200, JSON.stringify(source.body));
        assert.equal(source.body.agent.executionStatus, 'completed', JSON.stringify(source.body));
        const originals = source.body.answerSelection.results.map(entry => entry.result);
        assert.deepEqual(originals.map(result => result.operation), ['list', 'aggregate', 'list']);
        const ids = originals.map(result => result.resultId);
        const expectedRent = Number((await db.query(`select sum(total_area*net_effective_rent)/sum(total_area) as rent
          from public.building_metrics where building_id=any($1::uuid[]) and record_year=2026 and record_quarter=2 and is_locked and not is_draft`,
        [buildingIds.slice(0, 2)])).rows[0].rent);
        const conversation = { id: source.body.conversation.id, parentRequestId: source.body.requestId };
        const askExport = async question => {
          const response = await fetch(app + '/api/intelligence/query/agent', { method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + analyst.token },
            body: JSON.stringify({ idempotencyKey: randomUUID(), question, conversation }) });
          return { status: response.status, body: await response.json() };
        };
        for (const question of ['请把刚才三份结果分别放到一个 Excel 工作簿。', '把刚才的结果导出Excel。']) {
          const exported = await askExport(question);
          assert.equal(exported.status, 200, JSON.stringify(exported.body));
          assert.equal(exported.body.agent.executionStatus, 'completed', JSON.stringify(exported.body));
          assert.equal(exported.body.agent.modelCalls, 0);
          assert.equal(exported.body.agent.toolCalls, 1);
          assert.equal(exported.body.conversation.id, conversation.id);
          const result = exported.body.result;
          assert.deepEqual(result.parameters.agentExport.selection.resultIds, ids);
          const sheets = result.parameters.agentWorkbook.sheets;
          assert.deepEqual(sheets.map(sheet => sheet.snapshot), originals);
          const names = ['楼宇参数', '季度指标', '成交明细'];
          assert.deepEqual(sheets.map(sheet => sheet.name), names);
          assert.deepEqual((await recover(analyst, exported.body.requestId)).body.result, result);
          const file = await download({ ...exported, actor: analyst });
          assert.equal(file.status, 200, JSON.stringify(file.body));
          const book = XLSX.read(file.bytes, { type: 'array' });
          assert.deepEqual(book.SheetNames, [...names, '来源', '口径与快照']);
          const read = name => XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: null });
          const citations = read('来源');
          for (const [index, name] of names.entries()) {
            const [header, ...rows] = read(name);
            const snapshot = originals[index];
            assert.equal(rows.length, snapshot.table.rows.length);
            assert.equal(header.length, snapshot.table.columns.length + 1);
            assert.equal(header[0], '实体编号');
            assert.deepEqual(rows.map(row => row[0]), snapshot.table.rows.map(row => row.entityId));
            for (const cell of Object.values(book.Sheets[name])) assert.equal(cell?.f, undefined);
            const rowsForSheet = citations.filter(row => row[0] === name && row[1] === ids[index]);
            assert.ok(rowsForSheet.some(row => row[3] && row[5] && (index !== 1 || row[7] === '2026Q2')));
          }
          const valueColumn = (index, column) => originals[index].table.columns.findIndex(item => item.key === column) + 1;
          const listing = read(names[0]);
          assert.match(listing[0][valueColumn(0, 'height')], /建筑高度.*米/);
          assert.deepEqual(buildingIds.slice(0, 3).map(id => listing.find(row => row[0] === id)[valueColumn(0, 'height')]), [210, 198, null]);
          assert.equal(read(names[1])[1][valueColumn(1, 'value')], expectedRent);
          const detailRows = read(names[2]);
          const areaIndex = valueColumn(2, 'area');
          const buildingIndex = valueColumn(2, 'building');
          assert.deepEqual(detailRows.slice(1).map(row => row[areaIndex]).sort(), [0, 100.25, 200.5, 600, null].sort());
          assert.equal(detailRows.find(row => row[areaIndex] === 600)[buildingIndex], '=1+1');
          assert.ok(!JSON.stringify(citations).includes('合成保密客户'));
          assert.ok(!JSON.stringify(detailRows).includes('合成保密客户'));
          assert.equal((await download({ ...exported, actor: analyst }, other)).status, 403);
          assert.equal((await recover(other, exported.body.requestId)).status, 403);
          if (question.startsWith('把刚才')) {
            await db.query('update private.ai_lease_research_grants set allow_export=false where user_id=$1', [analyst.id]);
            assert.equal((await download({ ...exported, actor: analyst })).status, 403);
            assert.equal((await recover(analyst, exported.body.requestId)).status, 403);
            assert.equal((await recover(analyst, source.body.requestId)).status, 200);
          }
        }
      } finally {
        await db.query('delete from public.lease_transactions where id=$1', [markerId]);
      }
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
      assert.equal(mixed.status,200);assertSelectedAnswer(mixed.body,[{role:'primary',resultId:scenario.primaryResultId},{role:'supporting',resultId:scenario.supportingResultId}]);assert.equal(mixed.body.result.parameters.dataDomain,undefined);assert.equal(mixed.body.result.parameters.leaseBindings,undefined);assert.ok(mixed.body.answerSelection.results[1].result.parameters.leaseBindings.length);
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
    await check('AI6 T13 / 单笔成交前十笔在查询后中断，原会话可恢复同一份获权正式明细', async () => {
      await nextActor('t13-interrupted'); await grant();
      const project = '合成T13单笔排名项目';
      const transactionIds = Array.from({ length: 13 }, () => randomUUID());
      await db.query("insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method) values('BJ',$1,$2,'manual')", [project, buildingIds[0]]);
      try {
        for (const [index, id] of transactionIds.entries()) {
          await db.query(`insert into public.lease_transactions(id,company,new_building,industry,sub_market,area_sqm,transaction_year,transaction_quarter,transaction_date)
            values($1,'合成保密客户_禁止模型日志',$2,'TMT','CBD',$3,2026,$4,$5)`,
          [id, project, index === 12 ? 9000 : 1000 + index * 250, index === 12 ? 'Q3' : 'Q2', index === 12 ? '2026-07-01' : '2026-06-30']);
        }
        const question = '列出2026年上半年CBD单笔租赁成交按面积排名前十笔。';
        const expected = Array.from({ length: 10 }, (_, index) => 3750 - index * 250);
        const plan = { source: 'live', from: '2026-01-01', to: '2026-06-30', submarkets: ['CBD'], mode: 'details',
          fields: ['area'], sort: 'area', direction: 'desc', topN: 10 };
        const conversation = { id: randomUUID() };
        const stopped = await submit(plan, { question, interruptAfterDetails: true }, who, conversation);
        assert.equal(stopped.status, 409, JSON.stringify(stopped.body));
        assert.match(stopped.body.error, /历史恢复/);
        assert.equal(stopped.body.result, undefined);
        const restored = await recover(who, stopped.body.requestId);
        assert.equal(restored.status, 200);
        assert.equal(restored.body.answerSelection.status, 'partial');
        assert.equal(restored.body.result.parameters.leaseBindings[0].plan.mode, 'details');
        assert.equal(restored.body.result.parameters.leaseBindings[0].plan.topN, 10);
        assert.deepEqual(restored.body.result.table.rows.map(row => row.cells.area.value.numeric), expected);
        const history = await fetch(app + '/api/intelligence/query/history', { method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + who.token },
          body: JSON.stringify({ action: 'open', conversationId: conversation.id, requestId: stopped.body.requestId }) });
        assert.equal(history.status, 200);
        const { opened } = await history.json();
        assert.equal(opened.conversation.id, conversation.id);
        assert.equal(opened.selected.question, question);
        assert.deepEqual(opened.selected.reply.result, restored.body.result);
        const archived = await events(stopped.body.requestId);
        assert.equal(archived.filter(event => event.kind === 'response_generated').length, 1);
        assert.equal((await recover(other, stopped.body.requestId)).status, 403);
        await db.query('update private.ai_lease_research_grants set enabled=false where user_id=$1', [who.id]);
        assert.equal((await recover(who, stopped.body.requestId)).status, 403);
      } finally {
        await db.query('delete from public.lease_transactions where id=any($1::uuid[])', [transactionIds]);
        await db.query("delete from public.lease_building_name_map where market_code='BJ' and alias_name=$1", [project]);
      }
    });
  } finally {server.close();await once(server,'close');}
}
