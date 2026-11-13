import { createHash, randomUUID } from 'node:crypto';
import type { QueryPlan } from '../plan';
import type { SourceRef } from '../contracts';
import type { QueryResult, ResultCell, ResultTable } from '../result';
import type { DataAuthority } from '../serverAuthority';
import { FIELD_REGISTRY_VERSION } from '../registry';
import { Decimal } from '../decimal';
import { analyzeSubmissionSnapshot } from './analyze';
import { submissionFields, submissionFieldKeys } from './contracts';
import { isSubmissionQualityView, submissionAnalysisSchema, submissionIssueText, type SubmissionAnalysis, type SubmissionView } from './view';
import { authorizeSubmissionRead } from './reader';

const text = (value: string, sourceIds: readonly string[]): ResultCell => ({kind:'text',value,sourceIds});
const number = (value: number, sourceIds: readonly string[]): ResultCell => ({kind:'number',value:{numeric:value,exact:{numerator:String(value),denominator:'1'}},sourceIds});
const freeze = <T,>(v:T):T => {if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};

/** Primary view and workbook detail sheets reuse the same analysis and immutable sources. */
export function submissionResultTable(a:SubmissionAnalysis,sources:readonly SourceRef[],view:SubmissionView):ResultTable {
  if(view==='summary'){
    const categories=[{label:'已分配 · 有提交',assigned:true,submitted:true},{label:'已分配 · 未提交',assigned:true,submitted:false},
      {label:'未分配 · 有提交',assigned:false,submitted:true},{label:'未分配 · 未提交',assigned:false,submitted:false}];
    return {id:'submission_coverage',columns:[{key:'name',label:'楼宇状态',unit:null},{key:'count',label:'楼宇数量',unit:'building_count'}],
      rows:categories.map((c,i)=>{const members=a.rows.filter(r=>r.assigned===c.assigned&&r.submitted===c.submitted),refs=members.flatMap(r=>r.sourceIds);
        return {entityId:`submission-status-${i}`,cells:{name:text(c.label,refs),count:number(members.length,refs)}};})};
  }
  if(view==='people'||view==='missing_people'){
    const label=(p:SubmissionAnalysis['people'][number])=>p.names.filter(Boolean).join(' / ')||'记录姓名未知';
    const names=new Map<string,number>();for(const p of a.people)names.set(label(p),(names.get(label(p))??0)+1);
    return {id:'submission_people',columns:[{key:'name',label:'负责人（记录姓名）',unit:null},{key:'account',label:'账号标识',unit:null},
      {key:'assigned',label:'当前分配',unit:'building_count'},{key:'submitted',label:'本人已提交',unit:'building_count'},{key:'missing',label:'本人未提交',unit:'building_count'}],
      rows:a.people.filter(p=>view==='people'||p.missingBuildingIds.length>0).map(p=>({entityId:p.userId,cells:{
        name:text((names.get(label(p))??0)>1?`${label(p)}（${p.userId}）`:label(p),p.sourceIds),account:text(p.userId,p.sourceIds),
        assigned:number(p.assignedBuildingIds.length,p.sourceIds),submitted:number(p.submittedBuildingIds.length,p.sourceIds),missing:number(p.missingBuildingIds.length,p.sourceIds),
      }}))};
  }
  const qualityView=['quality','missing_fields','anomalies'].includes(view);
  const sourceByRecord=new Map<string,Map<string,SourceRef>>();
  for(const source of sources)if(source.table==='quarterly_submissions'){
    if(!sourceByRecord.has(source.recordId))sourceByRecord.set(source.recordId,new Map());sourceByRecord.get(source.recordId)!.set(source.field,source);
  }
  const selected=a.rows.filter(r=>view==='missing'?!r.submitted:view==='unassigned'?!r.assigned
    :view==='missing_fields'?!r.quality||r.quality.missingRequired.length>0
    :view==='anomalies'?r.latestUnresolved||r.quality?.issues.some(i=>i.kind==='invalid'||i.kind==='inconsistent'):true);
  const columns:ResultTable['columns']=[{key:'name',label:'楼宇',unit:null},{key:'assignment',label:'当前分配',unit:null},{key:'submission',label:'该季提交',unit:null},
    ...(qualityView?[{key:'complete',label:'五项输入齐全',unit:null},{key:'issues',label:'核查事项',unit:null},
      ...submissionFieldKeys.map(key=>({key,label:submissionFields[key].label,unit:submissionFields[key].unit}))]
      :[{key:'records',label:'原始提交数',unit:'record_count'},{key:'latest',label:'最新提交时间',unit:null}])];
  return {id:qualityView?'submission_quality':'submission_buildings',columns,rows:selected.map(r=>{
    const cells:Record<string,ResultCell>={name:text(r.name,r.sourceIds),assignment:text(r.assigned?`已分配 ${r.assigneeIds.length} 人`:'未分配',r.sourceIds),
      submission:text(r.submitted?'有提交（不代表已审定）':'无该季提交',r.sourceIds)};
    if(qualityView){
      cells.complete=text(r.quality?(r.quality.requiredComplete?'是（不代表有效）':'否'):r.latestUnresolved?'无法确定最新记录':'未知：尚无提交',r.sourceIds);
      cells.issues=text(r.quality?(r.quality.issues.map(submissionIssueText).join('；')||'本次规则未发现问题，不等于已审定'):r.latestUnresolved?'提交时间缺失，无法确定最新记录':'无该季提交，无法检查字段',
        [...new Set([...r.sourceIds,...(r.quality?.issues.flatMap(i=>i.sourceIds)??[])])]);
      for(const field of submissionFieldKeys){
        const source=r.latestSubmissionId?sourceByRecord.get(r.latestSubmissionId)?.get(field):undefined;
        const refs=source?[source.id]:r.sourceIds;
        const parsed=source?Decimal.parse(source.rawValue):null;
        cells[field]=parsed?{kind:'number',value:{exact:parsed.exact(),numeric:parsed.toNumber()},sourceIds:refs}
          :{kind:'unknown',state:source?.rawValue!==null&&source?.rawValue!==undefined?'invalid':r.latestUnresolved?'unverified':'missing',
            reason:r.latestUnresolved?'latest_submission_unresolved':source?'missing_or_invalid_submission_value':'no_submission_in_period',sourceIds:refs};
      }
    }else{
      cells.records=number(r.rawSubmissionCount,r.sourceIds);
      cells.latest=text(r.latestSubmittedBy?.createdAt??(r.latestUnresolved?'未知：无法确定最新记录':'无该季提交'),r.sourceIds);
    }
    return {entityId:r.buildingId,cells};
  })};
}

export function buildSubmissionResult(raw:unknown,plan:Extract<QueryPlan,{operation:'submission_progress'}>,authority:DataAuthority):QueryResult {
  authorizeSubmissionRead({period:plan.period,quality:isSubmissionQualityView(plan.view),submarkets:plan.scope.submarkets,buildingIds:plan.scope.buildingIds},authority);
  const observed=analyzeSubmissionSnapshot(raw),analysis=submissionAnalysisSchema.parse(observed);
  if(Boolean(observed.quality)!==isSubmissionQualityView(plan.view) || observed.periodBasis!==(plan.period?'explicit':'configured')
    || plan.period && (observed.period.year!==plan.period.year||observed.period.quarter!==plan.period.quarter)
    || observed.rows.some(r=>!authority.allBuildings&&!authority.buildingIds.includes(r.buildingId)
      || !authority.allSubmarkets&&!authority.submarkets.includes(r.submarket??'')
      || plan.scope.submarkets&&!plan.scope.submarkets.includes(r.submarket??'') || plan.scope.buildingIds&&!plan.scope.buildingIds.includes(r.buildingId)))throw new Error('SUBMISSION_SCOPE_MISMATCH');
  const scope={...plan.scope,inventory:'tracked',inventoryTime:'current_active_tracked_stock',assignmentsTime:'current',readAt:observed.readAt};
  const result:QueryResult={resultId:randomUUID(),createdAt:new Date().toISOString(),snapshotId:observed.snapshotId,dataVersion:observed.dataVersion,
    scopeFingerprint:createHash('sha256').update(JSON.stringify([authority.actorId,authority.effectiveUserId,authority.permissionRevision,scope])).digest('hex'),
    registryVersion:FIELD_REGISTRY_VERSION,operation:'submission_progress',parameters:{view:plan.view,period:observed.period,
      periodBasis:observed.periodBasis,configuredPeriod:observed.configuredPeriod,submissionPolicy:observed.version,scope},
    table:submissionResultTable(analysis,observed.sources,plan.view),analysis,sources:observed.sources,limitations:observed.limitations};
  return freeze(result);
}
