import type {ChartPoint,ResultChart} from '../charts';
import {Decimal} from '../decimal';
import {resultScopeText,resultSummary,type QueryResultView} from '../presentation';
import {futureAnalysisSchema,futureModeForView,futureViewSchema} from './view';
import {mapBaseDescriptor} from './mapBaseDescriptor';

export const mapCaveat='按数据库原坐标展示，位置及坐标系未逐条核实；不按名称推测位置，不据点位判断子市场归属。';
export type MapBase={version:string;source:typeof mapBaseDescriptor.source;lines:{kind:string;name:string;path:number[][]}[];stations:{name:string;center:number[]}[]};
export type MapViewport={cx:number;cy:number;span:number};
const cos40=Math.cos(40*Math.PI/180);
export const projectMap=(lng:number,lat:number)=>({x:lng*cos40,y:-lat});
export const mapBaseNote=`底图为系统留存的高德导出（${mapBaseDescriptor.source.generatedAt.slice(0,10)}），仅作位置参照；行政边界与地铁不代表当前状态，不用于测距或面积计算。`;

/** Coordinates come exclusively from this authorized archive, never geocoding or a latest-data map route. */
export function buildFutureMap(result:QueryResultView):ResultChart{
 if(result.operation!=='future_observation'||futureModeForView(futureViewSchema.parse(result.parameters.view))!=='catalog')throw Error('CHART_FUTURE_CATALOG_REQUIRED');
 const analysis=futureAnalysisSchema.parse(result.analysis);if(analysis.mode!=='catalog')throw Error('CHART_FUTURE_CATALOG_REQUIRED');
 if(analysis.rows.length>5000)throw Error('CHART_SIZE_LIMIT');
 if(analysis.catalog.records!==analysis.rows.length||new Set(analysis.rows.map(r=>r.futureId)).size!==analysis.rows.length)throw Error('CHART_LOCATION_SCOPE_MISMATCH');
 const sources=new Map(result.sources.map(s=>[s.id,s])),names=new Map<string,number>();analysis.rows.forEach(r=>names.set(r.name,(names.get(r.name)??0)+1));
 const points:ChartPoint[]=analysis.rows.map((r,index)=>{
  const field=(key:string)=>{const s=sources.get(r.fieldSources[key]);if(!s||s.table!=='future_supplies'||s.entityId!==r.futureId||s.recordId!==r.futureId||s.field!==key)throw Error('CHART_LOCATION_SOURCE_MISMATCH');return s;};
  if(field('name').rawValue!==r.name)throw Error('CHART_LOCATION_SOURCE_MISMATCH');
  const lngSource=field('location_lng'),latSource=field('location_lat'),lng=Decimal.parse(lngSource.rawValue),lat=Decimal.parse(latSource.rawValue);
  const valid=lng!==null&&lat!==null&&lng.compare(Decimal.parse('-180')!)>=0&&lng.compare(Decimal.parse('180')!)<=0&&lat.compare(Decimal.parse('-90')!)>=0&&lat.compare(Decimal.parse('90')!)<=0&&!(lng.compare(Decimal.zero())===0&&lat.compare(Decimal.zero())===0);
  const state=!lng||!lat?'unknown':valid?'valid':'invalid';
  if(r.location.state!==state||r.location.lng!==(valid?lng!.toNumber():null)||r.location.lat!==(valid?lat!.toNumber():null)
    ||r.location.sourceIds.length!==2||!r.location.sourceIds.includes(lngSource.id)||!r.location.sourceIds.includes(latSource.id))throw Error('CHART_LOCATION_SOURCE_MISMATCH');
  const sourceIds=[r.fieldSources.name,lngSource.id,latSource.id],binding={entityId:r.futureId,key:'location',sourceIds,analysisPath:['rows',index,'location']};
  return {label:r.name+(names.get(r.name)!>1?`（记录 ${index+1}）`:''),x:r.location.lng,y:r.location.lat,
   xText:valid?String(lngSource.rawValue):'未知',yText:valid?`经度 ${lngSource.rawValue}，纬度 ${latSource.rawValue}`:state==='invalid'?'未知：坐标无效':'未知：坐标缺失或不可解析',
   xCell:binding,yCell:binding,state:valid?'valid':'unknown',coordinateState:state};
 });
 const renderedCount=points.filter(p=>p.state==='valid').length;
 return {version:'result-chart/1',kind:'map',request:{kind:'future_locations'},resultId:result.resultId,tableId:result.table.id,title:resultScopeText(result),
  xLabel:'经度',yLabel:'纬度',xUnit:'degree',yUnit:'degree',points,renderedCount,unknownCount:points.length-renderedCount,connectNulls:false,zeroBaseline:false,
  summary:resultSummary(result),limitations:[...result.limitations,mapCaveat,mapBaseNote,'相近点位按当前视图分组，数字为记录数而非楼宇数；每条记录独立保留，地图明细分页不缩小查询范围。'],mapBase:mapBaseDescriptor};
}
export function fitMap(chart:ResultChart,width:number,height:number):MapViewport|null{
 const points=chart.points.filter(p=>p.state==='valid').map(p=>projectMap(p.x as number,p.y!));if(!points.length)return null;
 const xs=points.map(p=>p.x),ys=points.map(p=>p.y),xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
 return {cx:(xmin+xmax)/2,cy:(ymin+ymax)/2,span:Math.max(0.04,(xmax-xmin)*width/Math.max(1,width-64),(ymax-ymin)*width/Math.max(1,height-64))*1.05};
}
export function moveMap(view:MapViewport,dx=0,dy=0,factor=1):MapViewport{
 return {cx:Math.max(-400,Math.min(400,view.cx+dx)),cy:Math.max(-200,Math.min(200,view.cy+dy)),span:Math.max(0.0001,Math.min(1000,view.span*factor))};
}
export function mapGeometry(chart:ResultChart,base:MapBase|null,view:MapViewport,width:number,height:number){
 if(chart.kind!=='map'||![view.cx,view.cy,view.span,width,height].every(Number.isFinite)||view.span<=0||width<=0||height<=0)throw Error('CHART_MAP_VIEW_INVALID');
 const pixel=(lng:number,lat:number)=>{const p=projectMap(lng,lat);return {x:width/2+(p.x-view.cx)/view.span*width,y:height/2+(p.y-view.cy)/view.span*width};};
 const visible=(p:{x:number;y:number},margin=24)=>p.x>=margin&&p.x<=width-margin&&p.y>=margin&&p.y<=height-margin;
 type Group={x:number;y:number;indices:number[]};
 const buckets=new Map<string,Group[]>(),groups:Group[]=[];
 chart.points.forEach((p,i)=>{if(p.state!=='valid')return;const pos=pixel(p.x as number,p.y!);if(!visible(pos))return;
  // Find a nearby anchor, including adjacent grid cells; the anchor remains an actual record coordinate.
  const gx=Math.floor(pos.x/48),gy=Math.floor(pos.y/48);let group:Group|undefined;
  for(let x=gx-1;x<=gx+1&&!group;x++)for(let y=gy-1;y<=gy+1&&!group;y++){group=buckets.get(`${x}:${y}`)?.find(g=>Math.hypot(g.x-pos.x,g.y-pos.y)<48);}
  if(group)group.indices.push(i);else {const key=`${gx}:${gy}`,next={...pos,indices:[i]};groups.push(next);buckets.set(key,[...(buckets.get(key)??[]),next]);}
 });
 const paths=base?.lines.map(line=>({kind:line.kind,d:line.path.map((p,i)=>{const pos=pixel(p[0],p[1]);return `${i?'L':'M'}${pos.x.toFixed(2)},${pos.y.toFixed(2)}`;}).join(' ')}))??[];
 const labels:{x:number;y:number;name:string}[]=[];
 if(view.span<0.8)for(const station of base?.stations??[]){const pos=pixel(station.center[0],station.center[1]);
  if(visible(pos,44)&&pos.x<width-100&&labels.every(l=>Math.abs(l.x-pos.x)>140||Math.abs(l.y-pos.y)>36)&&groups.every(g=>Math.hypot(g.x-pos.x,g.y-pos.y)>60))labels.push({...pos,name:station.name});}
 return {groups:groups,paths,labels};
}
