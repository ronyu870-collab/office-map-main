import type {ChartPoint,ResultChart} from '../charts';
import {resultScopeText,resultSummary,type QueryResultView} from '../presentation';
import {futureAnalysisSchema,futureLaunchText} from './view';
import {futureClassificationText} from './supply';

export const intervalLegend='实心表示已明确到季度；描边表示仅明确半年或年份。范围不代表持续供给、均匀分配或实际入市日期。';
const ordinal=(q:{year:number;quarter:number})=>q.year*4+q.quarter-1;
export const intervalQuarterLabel=(n:number)=>`${Math.floor(n/4)}Q${n%4+1}`;

/** Read only the archived launch-schedule result, including its original table bindings. */
export function buildFutureTimeline(result:QueryResultView):ResultChart{
  if(result.operation!=='future_observation'||result.parameters.view!=='launch_schedule'||result.table.id!=='future_launch_intervals')throw new Error('CHART_LAUNCH_SCHEDULE_REQUIRED');
  const a=futureAnalysisSchema.parse(result.analysis),byId=new Map(a.rows.map(r=>[r.futureId,r]));
  if(result.table.rows.length!==a.rows.length||new Set(result.table.rows.map(r=>r.entityId)).size!==a.rows.length)throw new Error('CHART_INTERVAL_TABLE_MISMATCH');
  const names=new Map<string,number>();a.rows.forEach(r=>names.set(r.name,(names.get(r.name)??0)+1));
  const points:ChartPoint[]=result.table.rows.map((row,index)=>{
    const r=byId.get(row.entityId);if(!r)throw new Error('CHART_INTERVAL_TABLE_MISMATCH');
    const known=r.launch.start!==null&&r.launch.end!==null,cell=row.cells.launch;
    if(row.cells.name?.kind!=='text'||row.cells.name.value!==r.name||cell?.kind!=='text'||cell.value!==futureLaunchText(r)
      ||row.cells.status?.kind!=='text'||row.cells.status.value!==futureClassificationText(r.classification)
      ||![r.fieldSources.launch_year,r.fieldSources.launch_quarter].every(id=>cell.sourceIds.includes(id)))throw new Error('CHART_INTERVAL_TABLE_MISMATCH');
    for(const key of ['start','end'] as const){const q=r.launch[key],c=row.cells[key];
      if(!c||(q?(c.kind!=='text'||c.value!==intervalQuarterLabel(ordinal(q))):c.kind!=='unknown'))throw new Error('CHART_INTERVAL_TABLE_MISMATCH');
    }
    const sourceIds=[...new Set([...cell.sourceIds,r.fieldSources.name,r.fieldSources.status])],binding={entityId:row.entityId,key:'launch',sourceIds};
    return {label:r.name+((names.get(r.name)??0)>1?`（记录 ${index+1}）`:''),x:known?ordinal(r.launch.start!):null,y:known?ordinal(r.launch.end!):null,
      xText:r.name,yText:`${cell.value} · ${r.classification==='future_record'?'未来记录':futureClassificationText(r.classification)}`,
      xCell:binding,yCell:binding,state:known?'valid':'unknown',intervalPrecision:r.launch.state};
  });
  const renderedCount=points.filter(p=>p.state==='valid').length;
  const chart:ResultChart={version:'result-chart/1',resultId:result.resultId,tableId:result.table.id,request:{kind:'launch_intervals'},kind:'interval',
    title:resultScopeText(result),xLabel:'预计入市季度',yLabel:'预计时间范围',xUnit:'quarter',yUnit:'quarter',points,
    renderedCount,unknownCount:points.length-renderedCount,connectNulls:false,zeroBaseline:false,
    summary:resultSummary(result),limitations:[...result.limitations,intervalLegend,'所有分页使用全部获权记录的同一时间刻度；同名记录分开显示，未知不放在时间轴零点。']};
  intervalGeometry(chart);return chart;
}

/** Quarter windows use their full slot; no artificial minimum width or epoch-zero axis. */
export function intervalGeometry(chart:ResultChart){
  if(chart.kind!=='interval')throw new Error('CHART_INTERVAL_REQUIRED');
  const valid=chart.points.filter(p=>p.state==='valid');
  for(const p of valid){
    const length=p.intervalPrecision==='quarter'?1:p.intervalPrecision==='half_year'?2:p.intervalPrecision==='year'?4:0;
    if(typeof p.x!=='number'||p.y===null||!Number.isInteger(p.x)||!Number.isInteger(p.y)||p.x<1900*4||p.y>2200*4+3||p.y-p.x+1!==length)throw new Error('CHART_INTERVAL_RANGE_INVALID');
  }
  if(!valid.length)return {empty:true,min:0,maxExclusive:0,ticks:[] as {value:number;label:string;position:number}[],position:()=>0,width:()=>0};
  const min=Math.min(...valid.map(p=>p.x as number)),maxExclusive=Math.max(...valid.map(p=>p.y!))+1,span=maxExclusive-min;
  const step=Math.max(1,Math.ceil(span/6)),values=[min];for(let n=min+step;n<maxExclusive;n+=step)values.push(n);
  if(values.at(-1)!==maxExclusive-1&&maxExclusive-1-values.at(-1)!>=step/2)values.push(maxExclusive-1);
  const position=(n:number)=>(n-min)/span*100;
  return {empty:false,min,maxExclusive,ticks:values.map(value=>({value,label:intervalQuarterLabel(value),position:position(value)})),position,
    width:(p:ChartPoint)=>p.state==='valid'?(p.y!-(p.x as number)+1)/span*100:0};
}
