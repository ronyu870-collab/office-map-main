import {createHash,randomUUID} from 'node:crypto';
import type {SourceRef} from '../contracts';
import type {QueryResult,ResultCell,ResultTable} from '../result';
import {FIELD_REGISTRY_VERSION} from '../registry';
import {Decimal} from '../decimal';
import {submissionFieldKeys,submissionFields} from '../submissions/contracts';
import {submissionIssueText} from '../submissions/view';
import {analyzeFutureSnapshot} from './analyze';
import {normalizeFutureRead,type FutureAuthority} from './reader';
import {futureAnalysisSchema,futureSelectionSchema,futureModeForView,futureLaunchText,type FutureAnalysis,type FutureSelection,type FutureView} from './view';
const text=(value:string,sourceIds:readonly string[]):ResultCell=>({kind:'text',value,sourceIds});
const count=(value:number,sourceIds:readonly string[]):ResultCell=>({kind:'number',value:{numeric:value,exact:{numerator:String(value),denominator:'1'}},sourceIds});
const freeze=<T,>(v:T):T=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};

/** All views are projections of one previously authorized immutable analysis. */
export function futureResultTable(a:FutureAnalysis,sources:readonly SourceRef[],view:FutureView):ResultTable {
  if(futureModeForView(view)==='quality'&&a.mode!=='quality'||futureModeForView(view)!=='catalog'&&a.mode==='catalog')throw new Error('FUTURE_VIEW_NOT_READ');
  if(view==='launch_summary'){
    const groups=[['quarter','预计季度明确'],['half_year','仅明确半年'],['year','仅明确年份'],['unknown','预计年份未知'],['invalid','预计时间无效']] as const;
    return {id:'future_launch_precision',columns:[{key:'name',label:'预计入市时间精度',unit:null},{key:'count',label:'记录数',unit:'record_count'}],rows:groups.map(([state,label])=>{
      const members=a.rows.filter(r=>r.launch.state===state),refs=members.flatMap(r=>[r.fieldSources.launch_year,r.fieldSources.launch_quarter]);
      return {entityId:`future-launch-${state}`,cells:{name:text(label,refs),count:count(members.length,refs)}};})};
  }
  if(view==='summary')return {id:'future_task_coverage',columns:[{key:'name',label:'季度任务状态',unit:null},{key:'count',label:'记录数',unit:'record_count'}],
    rows:[{assigned:true,submitted:true,label:'已分配 · 有提交'},{assigned:true,submitted:false,label:'已分配 · 未提交'},
      {assigned:false,submitted:true,label:'未分配 · 有提交'},{assigned:false,submitted:false,label:'未分配 · 未提交'}].map((v,i)=>{
        const members=a.rows.filter(r=>r.assigned===v.assigned&&r.submitted===v.submitted),refs=members.flatMap(r=>r.sourceIds);
        return {entityId:`future-task-${i}`,cells:{name:text(v.label,refs),count:count(members.length,refs)}};})};
  if(view==='people'||view==='missing_people'){
    const label=(p:FutureAnalysis['people'][number])=>p.names.join(' / ')||'记录姓名未知';const names=new Map<string,number>();
    for(const p of a.people)names.set(label(p),(names.get(label(p))??0)+1);
    return {id:'future_task_people',columns:[{key:'name',label:'负责人（记录姓名）',unit:null},{key:'account',label:'账号标识',unit:null},
      {key:'assigned',label:'该季分配任务',unit:'task_count'},{key:'submitted',label:'本人已提交',unit:'task_count'},{key:'missing',label:'本人未提交',unit:'task_count'}],
      rows:a.people.filter(p=>view==='people'||p.missingIds.length>0).map(p=>({entityId:p.userId,cells:{name:text((names.get(label(p))??0)>1?`${label(p)}（${p.userId}）`:label(p),p.sourceIds),account:text(p.userId,p.sourceIds),
        assigned:count(p.assignedIds.length,p.sourceIds),submitted:count(p.submittedIds.length,p.sourceIds),missing:count(p.missingIds.length,p.sourceIds)}}))};
  }
  const quality=futureModeForView(view)==='quality',catalog=view==='catalog';
  const raw=new Map<string,Map<string,SourceRef>>();
  for(const s of sources)if(s.table==='future_supply_submissions'){if(!raw.has(s.recordId))raw.set(s.recordId,new Map());raw.get(s.recordId)!.set(s.field,s);}
  const selected=a.rows.filter(r=>view==='missing'?!r.submitted:view==='unassigned'?!r.assigned:view==='missing_fields'?!r.quality||r.quality.missingRequired.length>0
    :view==='anomalies'?r.latestUnresolved||r.quality?.issues.some(i=>i.kind==='invalid'||i.kind==='inconsistent'):true);
  const columns:ResultTable['columns']=[{key:'name',label:'未来供应记录',unit:null},{key:'status',label:'核验分类',unit:null},{key:'launch',label:'预计入市时间',unit:null},
    ...(catalog?[{key:'submarket',label:'子市场',unit:null},{key:'grade',label:'等级',unit:null},{key:'area',label:'记录总面积',unit:'m2'},{key:'identity',label:'楼宇关联',unit:null}]
      :[{key:'assignment',label:'该季分配',unit:null},{key:'submission',label:'该季提交',unit:null},
        ...(quality?[{key:'complete',label:'五项输入齐全',unit:null},{key:'issues',label:'核查事项',unit:null},...submissionFieldKeys.map(k=>({key:k,label:submissionFields[k].label,unit:submissionFields[k].unit}))]
          :[{key:'records',label:'原始提交数',unit:'record_count'},{key:'latest',label:'最新提交时间',unit:null}])])];
  return {id:catalog?'future_catalog':quality?'future_task_quality':'future_task_records',columns,rows:selected.map(r=>{
    const cells:Record<string,ResultCell>={name:text(r.name,[r.fieldSources.name]),status:text(r.classification==='pending'?'待核实':r.classification==='future_record'?'未来记录（数据库分类）':'分类未知',[r.fieldSources.status]),
      launch:text(futureLaunchText(r),[r.fieldSources.launch_year,r.fieldSources.launch_quarter])};
    if(catalog){cells.submarket=r.submarket?text(r.submarket,[r.fieldSources.submarket]):{kind:'unknown',state:'missing',reason:'submarket_missing',sourceIds:[r.fieldSources.submarket]};
      cells.grade=r.grade?text(r.grade,[r.fieldSources.grade]):{kind:'unknown',state:'missing',reason:'grade_missing',sourceIds:[r.fieldSources.grade]};
      cells.area=r.area.value?{kind:'number',value:r.area.value,sourceIds:r.area.sourceIds}:{kind:'unknown',state:r.area.state==='invalid'?'invalid':'missing',reason:'future_area_unavailable',sourceIds:r.area.sourceIds};
      cells.identity=text(r.buildingId?'已关联楼宇':'未关联，不按同名猜测',[r.fieldSources.building_id]);
    }else{cells.assignment=text(r.assigned?`已分配 ${r.assigneeIds.length} 人`:'该季未分配',r.sourceIds);cells.submission=text(r.submitted?'有提交（不代表已审定）':'无该季提交',r.sourceIds);
      if(quality){cells.complete=text(r.quality?(r.quality.requiredComplete?'是（不代表有效）':'否'):r.latestUnresolved?'无法确定最新记录':'未知：尚无提交',r.sourceIds);
        cells.issues=text(r.quality?(r.quality.issues.map(submissionIssueText).join('；')||'本次规则未发现问题，不等于已审定'):r.latestUnresolved?'提交时间缺失，无法确定最新记录':'无该季提交，无法检查字段',r.sourceIds);
        for(const field of submissionFieldKeys){const s=r.latestSubmissionId?raw.get(r.latestSubmissionId)?.get(field):undefined,refs=s?[s.id]:r.sourceIds,n=s?Decimal.parse(s.rawValue):null;
          cells[field]=n?{kind:'number',value:{numeric:n.toNumber(),exact:n.exact()},sourceIds:refs}:{kind:'unknown',state:r.latestUnresolved?'unverified':s?.rawValue!==null&&s?.rawValue!==undefined?'invalid':'missing',reason:r.latestUnresolved?'latest_submission_unresolved':s?'missing_or_invalid_submission_value':'no_submission_in_period',sourceIds:refs};}
      }else{cells.records=count(r.rawSubmissionCount,r.sourceIds);cells.latest=text(r.latestSubmittedBy?.createdAt??(r.latestUnresolved?'未知：无法确定最新记录':'无该季提交'),r.sourceIds);}
    }return {entityId:r.futureId,cells};})};
}

/** Internal result builder; caller must execute durable audit and final source checks. */
export function buildFutureResult(raw:unknown,input:FutureSelection,authority:FutureAuthority,requestId:string):QueryResult {
  const selection=futureSelectionSchema.parse(input),mode=futureModeForView(selection.view),read={mode,period:selection.period,submarkets:selection.submarkets,futureIds:selection.futureIds};
  const snapshot=normalizeFutureRead(raw,read,authority,requestId),observed=analyzeFutureSnapshot(snapshot),analysis=futureAnalysisSchema.parse(observed);
  const scope={inventory:'future',inventoryTime:'current_not_entered_future_records',assignmentsTime:'selected_quarter_current_records',
    ...(selection.submarkets?{submarkets:selection.submarkets}:{}),...(selection.futureIds?{futureIds:selection.futureIds}:{}),readAt:observed.readAt};
  return freeze({resultId:randomUUID(),createdAt:new Date().toISOString(),snapshotId:observed.snapshotId,dataVersion:observed.dataVersion,
    scopeFingerprint:createHash('sha256').update(JSON.stringify([authority.actorId,authority.effectiveUserId,authority.permissionRevision,scope])).digest('hex'),registryVersion:FIELD_REGISTRY_VERSION,
    operation:'future_observation',parameters:{view:selection.view,mode,period:observed.period,configuredPeriod:observed.configuredPeriod,periodBasis:observed.periodBasis,futurePolicy:observed.version,scope},
    analysis,table:futureResultTable(analysis,observed.sources,selection.view),sources:observed.sources,limitations:observed.limitations});
}
