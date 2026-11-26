import { randomUUID } from 'node:crypto';
import { parseQueryPlan, type QueryPlan } from '@/src/lib/intelligence/query/plan';
import { readQuerySnapshots } from '@/src/lib/intelligence/query/snapshotReader';
import { executeQueryPlan } from '@/src/lib/intelligence/query/executePlan';
import { comparisonQuarters, quarterComparisons, quarterLabel } from './quarter-comparison';
import { aggregateQuarter } from '@/src/lib/intelligence/query/analytics';
import { loadDataAuthority } from '@/src/lib/intelligence/query/serverAuthority';
import { resultViewSchema, cellText, units, resultSummary, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { buildResultChart } from '@/src/lib/intelligence/query/charts';
import { loadLeaseSnapshot, buildLeaseResult, authorizeLeasePlan } from '@/src/lib/intelligence/lease/research';
import { leasePlanSchema } from '@/src/lib/intelligence/lease/protocol';
import { slideContentSchema, type SlideContent } from '../contracts/content';
import type { PitchContext } from '../data/store';
import { digest } from '../data/store';
import { DocumentError } from '@/src/lib/intelligence/knowledge/safeArchive';
import { DYNAMIC_CAPABILITIES } from './recipes';
import type { DynamicParameters } from './protocol';
export type DataBinding = { domain: 'quarter'|'lease'; permissionRevision: string; policyVersion: string };
export type PitchDataSnapshot = { adapter: 'pitch-data/1'; binding: DataBinding; parameters: DynamicParameters; plans: unknown[];
  capturedAt: string; dataAsOf: string; dataVersion: string; results: QueryResultView[]; content: SlideContent[] };
const rejected=(detail:string):never=>{throw new DocumentError('PITCH_DATA_UNAVAILABLE',detail);};
const hash=(v:unknown)=>digest(new TextEncoder().encode(JSON.stringify(v)));
export async function searchPitchBuildings(ctx:PitchContext,q:string,offset:number) {
  const authority=await loadDataAuthority(ctx.client,ctx.identity,ctx.signal);
  const plan=parseQueryPlan({operation:'list',scope:{inventory:'all_authorized'},fields:[],period:null});
  const snapshots=await readQuerySnapshots(ctx.client,ctx.identity,authority,plan,ctx.signal);
  const rows=executeQueryPlan(plan,snapshots).table.rows.filter(r=>r.cells.name?.kind==='text'&&r.cells.name.value.normalize('NFKC').toLowerCase().includes(q.normalize('NFKC').toLowerCase()));
  const fresh=await loadDataAuthority(ctx.client,ctx.identity,ctx.signal);if(fresh.permissionRevision!==authority.permissionRevision)throw new Error('QUERY_DENIED');
  return {items:rows.slice(offset,offset+30).map(r=>({id:r.entityId,name:r.cells.name.kind==='text'?r.cells.name.value:''})),next:rows.length>offset+30?offset+30:null};
}
/** A reviewed adapter owns every query/metric. Business templates receive only SlideContent and an immutable receipt. */
export function quarterPlans(p: DynamicParameters): QueryPlan[] {
  const scope={inventory:p.inventory,...(p.submarkets.length?{submarkets:p.submarkets}:{}),...(p.buildingIds.length?{buildingIds:p.buildingIds}:{})};
  const list=(fields:string[])=>parseQueryPlan({operation:'list',scope,fields,period:p.period});
  if(['building-profile','project-comparison'].includes(p.templateId)) {
    if(!p.buildingIds.length || p.templateId==='building-profile'&&p.buildingIds.length!==1)rejected('请选择明确的项目；概况模板只接受一个项目。');
    if(!p.fields.length)rejected('请选择需要披露的参数。');return [list(p.fields)];
  }
  if(['rent-comparison','vacancy-comparison'].includes(p.templateId)) {
    if(p.buildingIds.length<2)rejected('对比需要至少两个明确项目。');
    return p.templateId==='rent-comparison'?[list(['netEffectiveRent']),parseQueryPlan({operation:'aggregate',scope,period:p.period,metric:'rent'})]:[list(['vacantArea','totalArea']),parseQueryPlan({operation:'aggregate',scope,period:p.period,metric:'vacancy'})];
  }
  if(['rent-trend','vacancy-trend'].includes(p.templateId))return [parseQueryPlan({operation:'trend',scope,metric:p.templateId==='rent-trend'?'rent':'vacancy',start:p.start,end:p.end,mode:'per_period'})];
  if(p.templateId==='building-submarket') {
    if(!p.targetBuildingId||p.submarkets.length!==1)rejected('需要一个目标项目和一个已确认子市场。');
    return [parseQueryPlan({operation:'aggregate',scope:{...scope,buildingIds:[p.targetBuildingId]},period:p.period,metric:'rent',metrics:['rent','vacancy']}),parseQueryPlan({operation:'aggregate',scope:{inventory:p.inventory,submarkets:p.submarkets},period:p.period,metric:'rent',metrics:['rent','vacancy']})];
  }
  return rejected('此模板没有受控季度数据适配器。');
}
function quarterDate(year:number,quarter:number) {return new Date(Date.UTC(year,quarter*3,0)).toISOString().slice(0,10);}
function resultContent(r: QueryResultView, p: DynamicParameters, language: 'zh'|'en', asOf:string, index:number): SlideContent {
  const capability=DYNAMIC_CAPABILITIES.find(c=>c.id===p.templateId)!;
  const sourceId=randomUUID(), sourceIds=[sourceId];
  const title=language==='en'?p.templateId:capability.name;
  const provenance={id:sourceId,kind:'record' as const,label:'已授权正式数据库 · '+[...new Set(r.sources.map(s=>s.table))].join(' / '),recordId:r.resultId,locator:`结果 ${r.resultId}`,version:r.dataVersion.slice(0,100),dataAsOf:asOf};
  const columns=r.table.columns;
  const rows=[...r.table.rows];
  if(['rent-comparison','vacancy-comparison'].includes(p.templateId)&&index===0) {
    const key=p.templateId==='rent-comparison'?'netEffectiveRent':'vacancyRatio';
    const get=(row:typeof rows[number])=>{const value=row.cells[key];return value?.kind==='number'?value.value.numeric*(p.templateId==='vacancy-comparison'?100:1):null;};
    rows.sort((a,b)=>{const x=get(a),y=get(b);return x===null?y===null?0:1:y===null?-1:(p.direction==='asc'?1:-1)*(x-y);});
    const labels=rows.map(row=>{const cell=row.cells.name;return (cell?.kind==='text'?cell.value:row.entityId)+(row.entityId===p.targetBuildingId?(language==='en'?' (Target)':'（目标）'):'');});
    const values=rows.map(get);
    const unit=p.templateId==='rent-comparison'?'元/㎡/月':'%';
    return slideContentSchema.parse({protocol:'colliers-pitch/1',locale:language,title,subtitle:p.period.year+' Q'+p.period.quarter,dataAsOf:asOf,disclosure:'internal',isTestData:false,sources:[provenance],blocks:p.chart==='table'?[{kind:'table',columns:['项目',p.templateId==='rent-comparison'?'净有效租金（'+unit+'）':'空置率（%）'],rows:labels.map((v,i)=>[v,values[i]]),sourceIds}]:[{kind:'chart',chartType:p.chart==='line'?'column':p.chart,categories:labels,series:[{name:p.templateId==='rent-comparison'?'净有效租金':'空置率',values,unit}],sourceIds}]});
  }
  const trend=r.operation==='trend';
  const blocks:SlideContent['blocks']=[];
  if(p.templateId==='lease-industry-distribution'&&p.chart!=='table') {
    const chart=buildResultChart(r,{kind:'bar',field:p.measure});
    blocks.push({kind:'chart',chartType:p.chart==='line'?'column':p.chart,categories:chart.points.map(v=>v.label),series:[{name:p.measure==='area'?'成交面积（㎡）':'成交笔数',values:chart.points.map(v=>v.y),unit:p.measure==='area'?'㎡':'笔'}],sourceIds});
  }else if(trend&&p.chart!=='table') {
    const chart=buildResultChart(r,{kind:'time_series'});
    blocks.push({kind:'chart',chartType:p.chart,categories:chart.points.map(v=>v.label),series:[{name:chart.yLabel,values:chart.points.map(v=>v.y),unit:units[chart.yUnit]??chart.yUnit}],sourceIds});
  }else {
    if(!rows.length)rejected('当前授权范围内没有可生成的样本；未创建空页。');
    // Keep every supported column and every unknown reason; no fabricated zero.
    if(columns.length>12||rows.length>200)rejected('查询结果超出本次页面容量，请缩小范围。');
    blocks.push({kind:'table',columns:columns.map(c=>c.label+(c.unit?` (${units[c.unit]??c.unit})`:'')),rows:rows.map(row=>columns.map(c=>cellText(row.cells[c.key],c.unit))),sourceIds});
  }
  const data:SlideContent={protocol:'colliers-pitch/1',locale:language,title:index?title+' · 参考统计':title,subtitle:trend?`${p.start.year} Q${p.start.quarter} – ${p.end.year} Q${p.end.quarter}`:undefined,dataAsOf:asOf,disclosure:'internal',isTestData:false,sources:[provenance],blocks};
  return slideContentSchema.parse(data);
}
export async function runPitchDataAdapter(ctx:PitchContext,p:DynamicParameters,language:'zh'|'en', compareOutline = false):Promise<PitchDataSnapshot> {
  const capability=DYNAMIC_CAPABILITIES.find(c=>c.id===p.templateId);
  if(capability?.status!=='available')return rejected(capability?.reason??'模板不存在。');
  const results:QueryResultView[]=[],plans:unknown[]=[];let binding:DataBinding;
  const lease=p.templateId.startsWith('lease-');
  const asOf=lease?p.to:quarterDate((p.templateId.endsWith('-trend')?p.end:p.period).year,(p.templateId.endsWith('-trend')?p.end:p.period).quarter);
  if(lease) {
    const snapshot=await loadLeaseSnapshot(ctx.client,ctx.identity,ctx.signal);if(!snapshot.export)throw new Error('QUERY_DENIED');
    const plan=leasePlanSchema.parse({source:p.leaseSource,from:p.from,to:p.to,mode:p.templateId==='lease-representatives'?'details':'aggregate',groupBy:p.templateId==='lease-representatives'?'total':'industry',...(p.buildingIds.length?{buildingIds:p.buildingIds}:{}),...(p.submarkets.length?{submarkets:p.submarkets}:{}),...(p.templateId==='lease-representatives'?{fields:['building','industry','period','precision','area']}:{}),sort:p.templateId==='lease-representatives'||p.measure==='area'?'area':'count',direction:p.direction});
    authorizeLeasePlan(plan,snapshot);plans.push(plan);results.push(resultViewSchema.parse(buildLeaseResult(snapshot,plan)));
    binding={domain:'lease',permissionRevision:snapshot.permission_revision,policyVersion:'lease-research/1'};
    const fresh=await loadLeaseSnapshot(ctx.client,ctx.identity,ctx.signal);if(!fresh.export||fresh.permission_revision!==binding.permissionRevision)throw new Error('QUERY_DENIED');
  }else {
    const authority=await loadDataAuthority(ctx.client,ctx.identity,ctx.signal);if(!authority.grants.includes('export:internal'))throw new Error('QUERY_DENIED');
    if (compareOutline) {
      const { previous, priorYear } = comparisonQuarters(p.period);
      const scope = { inventory: p.inventory, buildingIds: p.buildingIds };
      // Fetch the three periods from one DB snapshot so current values cannot drift between comparisons.
      const capture = parseQueryPlan({ operation: 'trend', scope, metric: 'rent', metrics: ['rent', 'vacancy'],
        mode: 'per_period', start: priorYear, end: p.period });
      const snapshots = await readQuerySnapshots(ctx.client, ctx.identity, authority, capture, ctx.signal);
      plans.push(capture);
      for (const period of [p.period, previous, priorYear]) {
        const plan = parseQueryPlan({ operation: 'list', scope, period, fields: p.fields });
        const snapshot = snapshots.find(s => s.period && quarterLabel(s.period) === quarterLabel(period));
        if (!snapshot) throw new Error('PITCH_OUTLINE_DATA_CHANGED');
        results.push(resultViewSchema.parse(executeQueryPlan(plan, [snapshot])));
      }
    } else for(const plan of quarterPlans(p)){
      plans.push(plan);const snapshots=await readQuerySnapshots(ctx.client,ctx.identity,authority,plan,ctx.signal);
      let result=resultViewSchema.parse(executeQueryPlan(plan,snapshots));
      if(p.templateId==='vacancy-comparison'&&plan.operation==='list') {
        const snapshot=snapshots[0];
        result={...result,table:{...result.table,columns:[...result.table.columns,{key:'vacancyRatio',label:'空置率',unit:'ratio'}],rows:result.table.rows.map(row=>{
          const fact=snapshot.rows.find(f=>f.id===row.entityId)!;
          const computed=aggregateQuarter({...snapshot,rows:[fact],expectedCount:1},'vacancy');
          const cell=computed.value?{kind:'number' as const,value:computed.value,sourceIds:computed.contributions.flatMap(c=>c.sourceIds)}:{kind:'unknown' as const,state:'invalid' as const,reason:computed.excluded[0]?.reason??'missing',sourceIds:computed.excluded.flatMap(c=>c.sourceIds)};
          return {...row,cells:{...row.cells,vacancyRatio:cell}};
        })}};
      }
      results.push(resultViewSchema.parse(result));
    }
    binding={domain:'quarter',permissionRevision:authority.permissionRevision,policyVersion:authority.policyVersion};
    const fresh=await loadDataAuthority(ctx.client,ctx.identity,ctx.signal);if(fresh.permissionRevision!==binding.permissionRevision||!fresh.grants.includes('export:internal'))throw new Error('QUERY_DENIED');
  }
  const core = compareOutline ? results.slice(0, 1) : results;
  const content=core.map((r,i)=>resultContent(r,p,language,asOf,i));
  // Method, denominators, unknowns and dedup/period caveats survive as native text continuation pages.
  for(const [i,r]of core.entries()) {
    const base=content[i];const notes=[...resultSummary(r),...r.limitations];
    if(notes.length)content.push({...base,title:base.title+' · '+(language==='en'?'Method and coverage':'口径与覆盖'),subtitle:undefined,blocks:notes.flatMap(s=>(s.match(/[\s\S]{1,3900}/g)??[]).map(text=>({kind:'paragraph' as const,text,sourceIds:base.sources.map(v=>v.id)})))});
  }
  if (compareOutline) {
    const baseline = comparisonQuarters(p.period);
    const sources = [p.period, baseline.previous, baseline.priorYear].map((period, i) => ({
      id: randomUUID(), kind: 'record' as const,
      label: quarterLabel(period) + (language === 'en' ? ' · Official database' : ' · 已授权正式数据库'),
      recordId: results[i].resultId, version: results[i].dataVersion, locator: `结果 ${results[i].resultId}`,
      dataAsOf: quarterDate(period.year, period.quarter),
    }));
    const sourceIds = sources.map(source => source.id);
    for (const { metric, columns, rows, note } of quarterComparisons(results, p.period, p.buildingIds, language))
      content.push(slideContentSchema.parse({
        ...content[0], title: metric,
        subtitle: `${metric} · ${language === 'en' ? 'QoQ / YoY' : '环比 / 同比'}`, sources,
        blocks: [{ kind: 'table', columns, rows, sourceIds }, { kind: 'paragraph', text: note, sourceIds }],
      }));
  }
  return {adapter:'pitch-data/1',binding,parameters:p,plans,capturedAt:new Date().toISOString(),dataAsOf:asOf,dataVersion:hash(results.map(r=>r.dataVersion)),results,content};
}

export { loadUnifiedPitchContext, loadPitchDemoContext } from "./unified-context";
export { requestFromProposalBrief } from "./unified-context-protocol";
export type { PitchDemo, UnifiedPitchContext, UnifiedPitchRequest } from "./unified-context-protocol";
