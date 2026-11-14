import { Decimal } from '../decimal';
import { quarterKey } from '../contracts';
import { quarterRange } from '../plan';
import type { ResultCell, ResultTable } from '../result';
import type { LeaseAnalysis } from './result';
import { isLeaseGroup, leaseGroupLabels, leaseSourceLabel, type LeaseSelection } from './view';

type Row=LeaseAnalysis['rows'][number];
const out=(n:Decimal)=>({exact:n.exact(),numeric:n.toNumber()});
const refs=(rows:readonly Row[],fields:readonly string[])=>[...new Set(rows.flatMap(r=>fields.map(f=>r.fieldSources[f]).filter(Boolean)))];
const text=(value:string,sourceIds:readonly string[]):ResultCell=>({kind:'text',value,sourceIds});
const num=(value:number,sourceIds:readonly string[]):ResultCell=>({kind:'number',value:out(Decimal.parse(value)!),sourceIds});
const amount=(value:Decimal|null,sourceIds:readonly string[],reason='no_valid_sample'):ResultCell=>value===null?{kind:'unknown',state:'missing',reason,sourceIds}:{kind:'number',value:out(value),sourceIds};
function summarize(rows:readonly Row[]){
 let sum=Decimal.zero(),valid=0,missing=0,invalid=0,missingNames=0;const names=new Set<string>();
 for(const r of rows){
  const a=r.numbers.area_sqm;if(!a)throw new Error('LEASE_VIEW_FIELD_REQUIRED');
  if(a.state==='valid'){valid++;sum=sum.add(Decimal.fraction(BigInt(a.value!.exact.numerator),BigInt(a.value!.exact.denominator)));}else if(a.state==='invalid')invalid++;else missing++;
  const name=r.company?.trim().toLowerCase();if(name)names.add(name);else missingNames++;
 }
 return {records:rows.length,names:names.size,missingNames,valid,missing,invalid,sum:valid?sum:null};
}
const numericColumns=[{key:'count',label:'原始记录数',unit:'record_count'},{key:'names',label:'不同记录企业名称数',unit:'recorded_name_count'},
 {key:'missingNames',label:'企业名称缺失记录',unit:'record_count'},{key:'valid',label:'面积有效记录',unit:'record_count'},
 {key:'missing',label:'面积缺失记录',unit:'record_count'},{key:'invalid',label:'面积无效记录',unit:'record_count'},{key:'area',label:'已知成交面积合计',unit:'m2'}];

/** All groups come from one authorized immutable snapshot, never a second query.
 * Source/record count is not a deduplicated legal entity or business-deal count. */
export function buildLeaseAnalytics(a:LeaseAnalysis,s:LeaseSelection){
 if(!isLeaseGroup(s.view)&&s.view!=='quarter_trend')throw new Error('LEASE_ANALYTICS_VIEW_REQUIRED');
 const trend=s.view==='quarter_trend',dimension=isLeaseGroup(s.view)?s.view:null;
 const periods=trend?quarterRange(s.range!.start,s.range!.end):[];
 const tableRows:ResultTable['rows'][number][]=[];
 const table:ResultTable={id:trend?'lease_quarter_trend':'lease_group_summary',columns:[{key:'name',label:trend?'记录来源':`${leaseGroupLabels[dimension!]}（原记录）`,unit:null},
  ...(trend?[{key:'period',label:'成交季度',unit:null}]:[{key:'source',label:'记录来源',unit:null},{key:'categoryState',label:'分类状态',unit:null}]),...numericColumns,
  ...(!trend?[{key:'recordShare',label:'同来源记录数占比',unit:'ratio'},{key:'areaShare',label:'同来源已知面积占比',unit:'ratio'}]:[])],rows:tableRows};
 const details:{source:'live'|'history';records:number;distinctRecordedNames:number;missingNames:number;validArea:number;missingArea:number;invalidArea:number;knownArea:ReturnType<typeof out>|null;unknownCategoryRecords:number;groups:number}[]=[];
 let referenceCount=0;
 for(const summary of a.summaries){
  const rows=a.rows.filter(r=>r.source===summary.source),total=summarize(rows);
  const categoryField=dimension==='submarket'?'sub_market':dimension;
  const basis=refs(rows,['company',...(categoryField?[categoryField]:[])]),areaBasis=refs(rows,['company','area_sqm',...(categoryField?[categoryField]:[])]);
  const groups=new Map<string,{value:string|null;rows:Row[]}>();
  if(trend)for(const p of periods)groups.set(quarterKey(p),{value:quarterKey(p),rows:[]});
  for(const r of rows){
   const value=trend?`${r.period.start!.slice(0,4)}-Q${Math.ceil(Number(r.period.start!.slice(5,7))/3)}`:(dimension==='submarket'?r.submarket:r.values[dimension!])?.trim()||null;
   const key=trend?value!:JSON.stringify(value);
   if(trend&&!groups.has(key))throw new Error('LEASE_TREND_PERIOD_MISMATCH');
   if(!groups.has(key))groups.set(key,{value,rows:[]});
   groups.get(key)!.rows.push(r);
   if(groups.size>100)throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  }
  const ordered=trend?[...groups]:[...groups].sort(([,x],[,y])=>x.value===null?1:y.value===null?-1:x.value.localeCompare(y.value,'zh-CN'));
  for(const [key,group]of ordered){
   const t=summarize(group.rows),identityRefs=refs(group.rows,['company',...(categoryField?[categoryField]:[])]),areaRefs=refs(group.rows,['area_sqm',...(categoryField?[categoryField]:[])]);
   const periodRefs=trend?refs(group.rows,['transaction_date','transaction_year','transaction_quarter']):[];
   const cells:Record<string,ResultCell>={name:text(trend?leaseSourceLabel[summary.source]:group.value??`未记录${leaseGroupLabels[dimension!]}`,identityRefs),
    ...(trend?{period:text(group.value!,periodRefs)}:{source:text(leaseSourceLabel[summary.source],identityRefs),categoryState:text(group.value===null?'未记录':'已记录',identityRefs)}),
    count:num(t.records,identityRefs),names:num(t.names,refs(group.rows,['company'])),missingNames:num(t.missingNames,refs(group.rows,['company'])),
    valid:num(t.valid,areaRefs),missing:num(t.missing,areaRefs),invalid:num(t.invalid,areaRefs),area:amount(t.sum,areaRefs),
    ...(!trend?{recordShare:amount(total.records?Decimal.parse(t.records)!.divide(Decimal.parse(total.records)!):null,basis),
     areaShare:amount(t.sum&&total.sum&&total.sum.compare(Decimal.zero())>0?t.sum.divide(total.sum):null,areaBasis,'no_positive_area_denominator')}:{}),
   };
   referenceCount+=Object.values(cells).reduce((n,c)=>n+c.sourceIds.length,0);
   // Refuse an oversized synchronous artifact instead of truncating groups or
   // quietly dropping denominator provenance. Background jobs remain separate.
   if(referenceCount>100000)throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
   tableRows.push({entityId:trend?`${summary.source}/${key}`:JSON.stringify([summary.source,dimension,group.value]),cells});
  }
  details.push({source:summary.source,records:total.records,distinctRecordedNames:total.names,missingNames:total.missingNames,validArea:total.valid,missingArea:total.missing,invalidArea:total.invalid,knownArea:total.sum?out(total.sum):null,unknownCategoryRecords:trend?0:groups.get('null')?.rows.length??0,groups:groups.size});
 }
 const paragraphs=[trend?'趋势按原成交日期或明确季度分配，年份记录不拆分到季度；连续季度保留，零条是获权数据库的记录数，不证明现实市场零成交。面积没有有效记录时保持未知并断线。':
  `按原记录${leaseGroupLabels[dimension!]}分组，只修剪首尾空白，不做行业归并或模型分类；未记录单列。记录数占比以同来源全部入选记录为分母，已知面积占比以同来源全部有效面积（包括分类未记录项）为分母，分母为零或组内面积全缺失时占比未知。`,
  '不同记录企业名称数只按修剪首尾空白并忽略大小写的原名称计数，不代表不同法人或真实企业数；同一名称可在多组/多季出现，各组名称数不能相加为整体企业数。',
  ...details.map(d=>`${leaseSourceLabel[d.source]}：${d.records} 条记录、${d.distinctRecordedNames} 个不同记录名称、名称缺失 ${d.missingNames} 条${trend?'':`、分类未记录 ${d.unknownCategoryRecords} 条`}。统计只代表本次获权数据库记录，不能称全市场需求或净吸纳量。`)];
 return {table,details:{version:'lease-analytics/1',view:s.view,sourceTotals:details},paragraphs};
}
