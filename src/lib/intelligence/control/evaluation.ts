import { routeTask } from '../agent/taskRouting';
import { executeQueryPlan } from '../query/executePlan';
import { describePlanRead } from '../query/snapshotReader';
import { resolveNumericFact } from '../query/facts';
import { numericFields } from '../query/registry';
import type { FactSnapshot, SourceRef } from '../query/contracts';
import { resultViewSchema } from '../query/presentation';
import { buildResultChart } from '../query/charts';
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
  return {suiteVersion:'ai6-control-1',results,paidCalls:0,durationMs:Date.now()-started,scope:'synthetic_offline_only',actualBilledUsd:null};
}
