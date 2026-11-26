import { routeTask } from '../agent/taskRouting';
import { executeQueryPlan } from '../query/executePlan';
import { describePlanRead } from '../query/snapshotReader';
import { resolveNumericFact } from '../query/facts';
import { numericFields } from '../query/registry';
import type { FactSnapshot, SourceRef } from '../query/contracts';
import { resultViewSchema } from '../query/presentation';
import { buildResultChart, lineGeometry, renderChartSvg } from '../query/charts';
import { buildTrendResult } from '../query/result';
import { composeResponse, responseDecision, responseResultContent } from '../query/responsePresentation';
import { quarterlyAnswerIssues } from '../query/answerCompleteness';
import { attachResearchAnalysis } from '../query/researchAnalysis';
import { researchAnalysisSchema } from '../query/researchAnalysisView';
import { buildXlsx } from '../query/exports';
/** The same production router, fixed synthetic questions, no CLI or model access. */
export const routeCases=[
  ['问候','你好','direct_response'],['概念','解释净有效租金的定义','bounded_agent'],['权限','我有哪些数据权限','direct_response'],
  ['楼宇列表','CBD楼宇列表','deterministic_query'],['楼宇排名','CBD建筑高度排名前10','deterministic_query'],
  ['季度指标','2026Q2CBD净有效租金','deterministic_query'],['全部获权比较','2026Q2全部获权楼宇净有效租金按子市场比较','deterministic_query'],
  ['Top10 Excel','把CBD在2026Q2净有效租金最高的10栋楼导出Excel','deterministic_query'],
  ['成交研究','分析租赁成交行业分布','bounded_agent'],['深度研究','生成深度研究报告','deep_research'],
] as const;
export function routeEvaluation(){return routeCases.map(([name,question,expected])=>{const actual=routeTask(question);return {name,question,expected,actual:actual.route,state:actual.route===expected?'offline_passed':'failed'};});}

/** Fixed in-memory sources, isolated from all database/business credentials. The
 * production fact resolver, calculation, chart and workbook builders are reused. */
export async function registeredEvaluation() {
  const started=Date.now(),results: {name:string;state:string;scope:string}[]=routeEvaluation().map(r=>({name:r.name,state:r.state,scope:'production_router'}));
  const check=async(name:string,run:()=>boolean|Promise<boolean>)=>{
    try{results.push({name,state:await run()?'offline_passed':'failed',scope:'synthetic_formal_engine'});}
    catch{results.push({name,state:'failed',scope:'synthetic_formal_engine'});}
  };
  const task=routeTask('2026Q2全部获权楼宇净有效租金按子市场比较');
  if(!task.plan)throw new Error('CONTROL_EVALUATION_PLAN');
  const plan=task.plan,read=describePlanRead(plan),period={year:2026,quarter:2};
  const source=(id:string,field:string,raw:unknown,unit='text',table='buildings'):SourceRef=>({id:`synthetic/${id}/${field}`,table,recordId:id,field,entityId:id,recordVersion:'synthetic-control-1',rawValue:raw,unit,period:table==='buildings'?null:period,recordedAt:null,businessAsOf:null,verification:'database_only',original:null});
  const snapshot:FactSnapshot={snapshotId:'synthetic-control-1',dataVersion:'synthetic-control-1',scopeFingerprint:'synthetic-only',period,expectedCount:3,complete:true,
    queryScope:{...plan.scope,filter:plan.filter??null,requestedFields:read.fields,inventoryTime:'current_catalog',brochureSelection:'all_unresolved_record_candidates'},
    rows:['A','B','C'].map((id,i)=>({id,name:`合成${id}座`,nameSource:source(id,'name',`合成${id}座`),dimensions:{submarket:{value:i<2?'CBD':'金融街',source:source(id,'submarket',i<2?'CBD':'金融街')}},
      facts:Object.fromEntries(read.fields.map(field=>{const rule=numericFields[field],raw=field==='netEffectiveRent'?[100,200,300][i]:field==='totalArea'?100:0;return [field,resolveNumericFact(field,id,[source(id,rule.column,raw,rule.unit,rule.table)],period)];}))}))};
  const result=executeQueryPlan(plan,[snapshot]),view=resultViewSchema.parse(result);
  await check('全部获权分组正式计算',()=>result.table.rows.length===2&&result.table.rows.some(r=>r.cells.value?.kind==='number'&&r.cells.value.value.numeric===150)&&result.table.rows.some(r=>r.cells.value?.kind==='number'&&r.cells.value.value.numeric===300));
  await check('多轮季度续问',()=>{const next=routeTask('那2026Q3呢',plan);return next.route==='deterministic_query'&&next.plan?.operation==='group_aggregate'&&next.plan.period?.quarter===3;});
  await check('图表数值与结果绑定',()=>{const chart=buildResultChart(view,{kind:'bar',field:'value'});return chart.resultId===result.resultId&&chart.points.length===2&&chart.points.some(p=>p.y===150);});
  await check('Excel 实际内容',async()=>{const XLSX=await import('xlsx'),book=XLSX.read(await buildXlsx(result),{type:'array'}),rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(book.Sheets['数据']);return rows.length===2&&rows.some(r=>Object.values(r).includes(150))&&rows.some(r=>Object.values(r).includes(300));});
  // Independent synthetic quarters with distinct membership and fractional
  // values. Never use live business facts as an offline test fixture.
  const q1={year:2026,quarter:1},q2={year:2026,quarter:2};
  const quarterSnapshot=(quarter:typeof q1, rents:(number|null)[]):FactSnapshot=>({
    ...snapshot,snapshotId:'answer-evaluation-Q'+quarter.quarter,period:quarter,queryScope:undefined,
    rows:snapshot.rows.map((row,i)=>({...row,facts:Object.fromEntries((['totalArea','netEffectiveRent'] as const).map(field=>{
      const rule=numericFields[field],raw=field==='totalArea'?100:rents[i];
      const ref={...source(row.id,rule.column,raw,rule.unit,rule.table),id:'synthetic/answer/Q'+quarter.quarter+'/'+row.id+'/'+field,period:quarter};
      return [field,resolveNumericFact(field,row.id,[ref],quarter)];
    }))})),
  });
  const snapshots=[quarterSnapshot(q1,[200,220,null]),quarterSnapshot(q2,[190,210,215])];
  const trend=resultViewSchema.parse(attachResearchAnalysis(buildTrendResult(snapshots,'rent','per_period'),snapshots));
  const question='CBD净有效租金2026Q1至2026Q2趋势各期样本';
  await check('两期样本表格优先',()=>{const blocks=composeResponse(undefined,trend,'trend',question).blocks.map(b=>b.type);return responseDecision(trend,'trend',question).primaryExpression==='table'&&blocks.indexOf('table')<blocks.indexOf('analysis')&&trend.table.rows.map(r=>r.cells.usedCount).every((cell,i)=>cell?.kind==='number'&&cell.value.numeric===i+2);});
  await check('两期专业措辞与共同样本',()=>{const research=researchAnalysisSchema.parse(trend.parameters.researchAnalysis);const content=responseResultContent(trend,research);return !content.conclusion.includes('逐季连续')&&research.series[0].comparability[0].commonCount===2&&research.series[0].comparability[0].commonSample.change?.numeric!==research.series[0].overall?.change?.numeric;});
  await check('两期坐标刻度与导出',()=>{const chart=buildResultChart(trend,{kind:'time_series'}),plot=lineGeometry(chart),svg=renderChartSvg(chart);return plot.ticks.length===5&&new Set(plot.ticks.map(t=>t.label)).size===5&&plot.ticks.every(t=>svg.includes('>'+t.label+'</text>'))&&plot.points.every(p=>p.y===null||Number.isFinite(p.y));});
  await check('回答完整性不将缺失当零',()=>{const copy=structuredClone(trend);copy.table.rows[1].cells.usedCount={kind:'unknown',state:'missing',reason:'not_returned',sourceIds:[]};return quarterlyAnswerIssues(question,trend).length===0&&quarterlyAnswerIssues(question,copy).length===1;});
  await check('明确图表与表格偏好',()=>responseDecision(trend,'trend','画一张折线图').primaryExpression==='chart'&&responseDecision(trend,'trend','用表格，不要图').primaryExpression==='table');
  return {suiteVersion:'ai6-control-1',results,paidCalls:0,durationMs:Date.now()-started,scope:'synthetic_offline_only',actualBilledUsd:null};
}
