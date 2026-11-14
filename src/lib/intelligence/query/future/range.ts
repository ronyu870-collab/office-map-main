import {z} from 'zod';
import {futureLaunchRangeSchema,type FutureLaunchRange} from './contracts';
import {futureLaunchText,type FutureAnalysis} from './view';

export const rangeStates=['within','partial','outside','unknown'] as const;
export const rangeStateText={within:'原预计区间完全在范围内',partial:'仅部分相交，不能确定在范围内',outside:'原预计区间在范围外',unknown:'时间未知，无法判断'};
export const rangeSelectionText={within:'完全在范围内',overlap:'已知区间相交（含仅部分相交）',unknown:'时间未知',outside:'范围外'};
const n=z.number().int().nonnegative();
export const futureRangeOverviewSchema=z.strictObject({version:z.literal('future-launch-range/1'),filter:futureLaunchRangeSchema,
  candidateCount:n,selectedCount:n,within:n,partial:n,outside:n,unknown:n,
  members:z.array(z.strictObject({futureId:z.uuid(),name:z.string(),launchText:z.string(),state:z.enum(rangeStates),selected:z.boolean(),sourceIds:z.array(z.string()).min(1)})).max(20000),
}).superRefine((v,ctx)=>{
  if(v.members.length!==v.candidateCount||new Set(v.members.map(m=>m.futureId)).size!==v.members.length
    ||v.members.filter(m=>m.selected).length!==v.selectedCount||rangeStates.some(k=>v.members.filter(m=>m.state===k).length!==v[k])
    ||v.members.some(m=>m.selected!==rangeSelected(m.state,v.filter.selection)))ctx.addIssue({code:'custom',message:'Invalid launch range coverage'});
});
export type FutureRangeOverview=z.infer<typeof futureRangeOverviewSchema>;
function rangeSelected(state:typeof rangeStates[number],selection:FutureLaunchRange['selection']){return selection==='overlap'?state==='within'||state==='partial':state===selection;}
const ordinal=(q:{year:number;quarter:number})=>q.year*4+q.quarter;
export function classifyLaunchRange(launch:FutureAnalysis['rows'][number]['launch'],range:FutureLaunchRange):typeof rangeStates[number]{
  if(!launch.start||!launch.end)return 'unknown';
  const start=ordinal(launch.start),end=ordinal(launch.end),from=ordinal(range.start),to=ordinal(range.end);
  return end<from||start>to?'outside':start>=from&&end<=to?'within':'partial';
}
/** Classify the full authorized snapshot before projection. Uncertainty is never a false match. */
export function projectFutureRange(a:FutureAnalysis,input:FutureLaunchRange){
  if(a.mode!=='catalog'||a.progress!==null)throw new Error('FUTURE_RANGE_CATALOG_ONLY');
  const filter=futureLaunchRangeSchema.parse(input),members=a.rows.map(r=>{
    const state=classifyLaunchRange(r.launch,filter);return {futureId:r.futureId,name:r.name,launchText:futureLaunchText(r),state,selected:rangeSelected(state,filter.selection),
      sourceIds:[r.fieldSources.name,r.fieldSources.launch_year,r.fieldSources.launch_quarter]};
  });
  const overview=futureRangeOverviewSchema.parse({version:'future-launch-range/1',filter,candidateCount:members.length,selectedCount:members.filter(m=>m.selected).length,
    ...Object.fromEntries(rangeStates.map(k=>[k,members.filter(m=>m.state===k).length])),members});
  const ids=new Set(members.filter(m=>m.selected).map(m=>m.futureId)),rows=a.rows.filter(r=>ids.has(r.futureId));
  const count=(f:(r:typeof rows[number])=>boolean)=>rows.filter(f).length;
  const analysis:FutureAnalysis={...a,rows,catalog:{records:rows.length,futureRecords:count(r=>r.classification==='future_record'),pending:count(r=>r.classification==='pending'),statusUnknown:count(r=>r.classification==='status_unknown'),
    unlinkedIdentities:count(r=>r.buildingId===null),knownArea:count(r=>r.area.state==='valid'),missingArea:count(r=>r.area.state==='missing'),invalidArea:count(r=>r.area.state==='invalid'),
    knownLaunchQuarter:count(r=>r.launch.state==='quarter'),launchHalfYear:count(r=>r.launch.state==='half_year'),launchYearOnly:count(r=>r.launch.state==='year'),launchUnknown:count(r=>r.launch.state==='unknown'),launchInvalid:count(r=>r.launch.state==='invalid')}};
  return {analysis,overview};
}
export function futureRangeSummary(v:FutureRangeOverview){
  const q=(x:{year:number;quarter:number})=>`${x.year}Q${x.quarter}`;
  return [`预计入市筛选 ${q(v.filter.start)} 至 ${q(v.filter.end)}，选择“${rangeSelectionText[v.filter.selection]}”：${v.selectedCount} 条。`,
    `筛选前获权候选 ${v.candidateCount} 条：原区间完全在范围内 ${v.within} 条、仅部分相交 ${v.partial} 条、范围外 ${v.outside} 条、时间未知 ${v.unknown} 条。未知未计作范围外；以下统计仅针对所选记录，预计不代表实际入市。`];
}
