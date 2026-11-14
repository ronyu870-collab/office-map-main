import {createHash} from 'node:crypto';
import {latestRows} from '@/src/lib/quarterly/latestRows';
import type {Quarter,SourceRef} from '../contracts';
import {Decimal} from '../decimal';
import {inspectSubmission} from '../submissions/analyze';
import {submissionFields,submissionFieldKeys} from '../submissions/contracts';
import {FUTURE_POLICY,validateFutureSnapshot} from './contracts';

/** Half-years and year-only values remain ranges; completion year is never a fallback. */
export function futureLaunchInterval(year:string|null,quarter:string|null){
  const y=year?.trim(),q=quarter?.trim();
  if(!y)return {state:'unknown' as const,reason:'launch_year_missing',start:null,end:null};
  if(!/^\d{4}$/.test(y)||Number(y)<1900||Number(y)>2200)return {state:'invalid' as const,reason:'launch_year_invalid',start:null,end:null};
  const bounds:Record<string,[number,number]>={Q1:[1,1],Q2:[2,2],Q3:[3,3],Q4:[4,4],H1:[1,2],H2:[3,4]};
  if(q&&!bounds[q])return {state:'invalid' as const,reason:'launch_quarter_invalid',start:null,end:null};
  const [first,last]=q?bounds[q]:[1,4];
  return {state:first===last?'quarter' as const:q?'half_year' as const:'year' as const,reason:null,start:{year:Number(y),quarter:first},end:{year:Number(y),quarter:last}};
}
export function futureDueInQuarter(interval:ReturnType<typeof futureLaunchInterval>,period:Quarter|null){
  if(!period)return 'not_requested' as const;if(!interval.start||!interval.end)return 'unknown' as const;
  const key=(q:Quarter)=>q.year*4+q.quarter,v=key(period),first=key(interval.start),last=key(interval.end);
  return v<first||v>last?'outside' as const:first===last?'definite' as const:'possible' as const;
}
const sourceId=(table:string,id:string,field:string,version:string)=>`${table}/${id}/${field}/${version}`;
const freeze=<T,>(v:T):T=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export function analyzeFutureSnapshot(input:unknown){
  const s=validateFutureSnapshot(input),sources=new Map<string,SourceRef>();
  const add=(table:string,r:{id:string;version:string},entityId:string,field:string,rawValue:unknown,time:string|null,unit='text',period:Quarter|null=null)=>{
    const id=sourceId(table,r.id,field,r.version),source:SourceRef={id,table,recordId:r.id,entityId,field,recordVersion:r.version,rawValue,unit,period,recordedAt:time,businessAsOf:null,verification:'database_only',original:null};
    if(sources.has(id)&&JSON.stringify(sources.get(id))!==JSON.stringify(source))throw new Error('SOURCE_ID_COLLISION');
    if(!sources.has(id)&&sources.size>=200000)throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');sources.set(id,source);return id;
  };
  const grouped=new Map(s.supplies.map(f=>[f.id,{assignments:[] as typeof s.assignments,submissions:[] as typeof s.submissions}]));
  s.assignments.forEach(r=>grouped.get(r.future_supply_id)!.assignments.push(r));s.submissions.forEach(r=>grouped.get(r.future_supply_id)!.submissions.push(r));
  const people=new Map<string,{userId:string;names:string[];assignedIds:string[];submittedIds:string[];missingIds:string[];sourceIds:string[]}>();
  let duplicateAssignments=0;
  const rows=s.supplies.map(f=>{
    const refs:Record<string,string>={};for(const field of ['building_id','name','submarket','grade','launch_year','launch_quarter','total_area','location_lng','location_lat','status','completion_year','is_entered_market'] as const)
      refs[field]=add('future_supplies',f,f.id,field,f[field],f.created_at,field==='total_area'?'m2':field.startsWith('location_')?'degree':field==='completion_year'?'year':field==='is_entered_market'?'boolean':'text');
    const area=Decimal.parse(f.total_area),areaState=f.total_area===null||f.total_area.trim()===''?'missing':!area||area.compare(Decimal.zero())<=0?'invalid':'valid';
    const lng=Decimal.parse(f.location_lng),lat=Decimal.parse(f.location_lat);
    const locationState=!lng||!lat?'unknown':lng.compare(Decimal.parse('-180')!)<0||lng.compare(Decimal.parse('180')!)>0||lat.compare(Decimal.parse('-90')!)<0||lat.compare(Decimal.parse('90')!)>0||lng.compare(Decimal.zero())===0&&lat.compare(Decimal.zero())===0?'invalid':'valid';
    const launch=futureLaunchInterval(f.launch_year,f.launch_quarter),group=grouped.get(f.id)!,pairs=new Map<string,typeof s.assignments>(),taskSources:string[]=[];
    for(const a of group.assignments){
      for(const field of ['future_supply_id','user_id','user_name','record_year','record_quarter','created_at'] as const)taskSources.push(add('future_supply_assignments',a,f.id,field,a[field],a.created_at,'text',s.period));
      const prior=pairs.get(a.user_id)??[];if(prior.length)duplicateAssignments++;pairs.set(a.user_id,[...prior,a]);
    }
    for(const r of group.submissions){
      for(const field of ['future_supply_id','user_id','user_name','record_year','record_quarter','created_at','updated_at'] as const)taskSources.push(add('future_supply_submissions',r,f.id,field,r[field],r.created_at,'text',s.period));
      if(s.mode==='quality')for(const field of submissionFieldKeys)taskSources.push(add('future_supply_submissions',r,f.id,field,r.values[field],r.created_at,submissionFields[field].unit,s.period));
    }
    for(const [userId,assignments] of pairs){
      const p=people.get(userId)??{userId,names:[],assignedIds:[],submittedIds:[],missingIds:[],sourceIds:[]};
      p.names=[...new Set([...p.names,...assignments.flatMap(a=>a.user_name?[a.user_name]:[])])];p.assignedIds.push(f.id);
      (group.submissions.some(r=>r.user_id===userId)?p.submittedIds:p.missingIds).push(f.id);
      p.sourceIds.push(refs.name,...assignments.map(a=>sourceId('future_supply_assignments',a.id,'user_id',a.version)),...group.submissions.filter(r=>r.user_id===userId).map(r=>sourceId('future_supply_submissions',r.id,'user_id',r.version)));people.set(userId,p);
    }
    const latestUnresolved=group.submissions.some(r=>r.created_at===null);
    // Shared selector's legacy building_id key is an adapter key here, not a canonical building mapping.
    const latest=latestUnresolved?null:latestRows(group.submissions.map(r=>({...r,building_id:r.future_supply_id,created_at:r.created_at!})))[0]??null;
    return {futureId:f.id,buildingId:f.building_id,name:f.name,submarket:f.submarket,grade:f.grade,status:f.status,
      classification:f.status==='future'?'future_record':f.status==='pending'?'pending':'status_unknown',
      launch,due:futureDueInQuarter(launch,s.period),completionYear:f.completion_year,
      area:{state:areaState,value:areaState==='valid'?{exact:area!.exact(),numeric:area!.toNumber()}:null,sourceIds:[refs.total_area]},
      location:{state:locationState,lng:locationState==='valid'?lng!.toNumber():null,lat:locationState==='valid'?lat!.toNumber():null,sourceIds:[refs.location_lng,refs.location_lat]},
      assigned:pairs.size>0,assigneeIds:[...pairs.keys()].sort(),submitted:group.submissions.length>0,rawSubmissionCount:group.submissions.length,
      latestUnresolved,latestSubmissionId:latest?.id??null,latestSubmittedBy:latest?{userId:latest.user_id,userName:latest.user_name,createdAt:latest.created_at}:null,
      quality:s.mode==='quality'&&latest?inspectSubmission(latest,'future_supply_submissions'):null,sourceIds:[...Object.values(refs),...taskSources],fieldSources:refs};
  });
  const count=(f:(r:typeof rows[number])=>boolean)=>rows.filter(f).length,owners=[...people.values()].sort((a,b)=>a.userId.localeCompare(b.userId));
  const assigned=count(r=>r.assigned),submitted=count(r=>r.assigned&&r.submitted);
  const settingsSourceIds=s.settings.map(r=>add('app_settings',{id:r.key,version:r.version},'','value',r.value,r.updatedAt));
  return freeze({version:FUTURE_POLICY,snapshotId:s.snapshotId,requestId:s.requestId,readAt:s.readAt,dataVersion:createHash('sha256').update(JSON.stringify(s)).digest('hex'),
    mode:s.mode,period:s.period,configuredPeriod:s.configuredPeriod,periodBasis:s.periodBasis,
    catalog:{records:rows.length,futureRecords:count(r=>r.classification==='future_record'),pending:count(r=>r.classification==='pending'),statusUnknown:count(r=>r.classification==='status_unknown'),
      unlinkedIdentities:count(r=>r.buildingId===null),knownArea:count(r=>r.area.state==='valid'),missingArea:count(r=>r.area.state==='missing'),invalidArea:count(r=>r.area.state==='invalid'),
      knownLaunchQuarter:count(r=>r.launch.state==='quarter'),launchHalfYear:count(r=>r.launch.state==='half_year'),launchYearOnly:count(r=>r.launch.state==='year'),launchUnknown:count(r=>r.launch.state==='unknown'),launchInvalid:count(r=>r.launch.state==='invalid')},
    progress:s.mode==='catalog'?null:{assignedSupplies:assigned,assignedSubmittedSupplies:submitted,missingAssignedSupplies:assigned-submitted,unassignedSupplies:rows.length-assigned,
      submittedSupplies:count(r=>r.submitted),unassignedSubmittedSupplies:count(r=>!r.assigned&&r.submitted),assignmentPairs:owners.reduce((n,p)=>n+p.assignedIds.length,0),
      submittedOwnerPairs:owners.reduce((n,p)=>n+p.submittedIds.length,0),missingOwnerPairs:owners.reduce((n,p)=>n+p.missingIds.length,0),duplicateAssignments,
      rawSubmissions:s.submissions.length,repeatSubmissionRows:s.submissions.length-count(r=>r.submitted),unknownSubmitterRows:s.submissions.filter(r=>r.user_id===null).length,
      latestUnresolvedSupplies:count(r=>r.latestUnresolved),dueDefinite:count(r=>r.due==='definite'),duePossible:count(r=>r.due==='possible'),dueUnknown:count(r=>r.due==='unknown'),dueOutside:count(r=>r.due==='outside'),
      coverage:assigned?{numerator:String(submitted),denominator:String(assigned)}:null},
    rows,people:owners,sources:[...sources.values()],settingsSourceIds,
    limitations:['对象是获权未来供应记录，以future_supplies.id区分；同名不合并，未关联楼宇时不猜身份。',
      '仅包含明确尚未入市的记录；已入市、入市状态未知，以及关联楼宇已转存量、停用或合并的记录不在本次候选。待核实与未知状态不冒充已核实未来供应。',
      '预计入市年/季、竣工年与实际入市是不同事实。半年或年范围不拆成确定季度，过期预计日期不代表已经入市。',
      '总面积是未来供应记录原字段，不自动等于办公或可租面积；同名和未关联记录可能需要身份复核，不将记录数称为已确认不同楼宇数。',
      '坐标有效仅指经纬度数值范围检查通过，不证明坐标系、地址或地图位置已经核实。',
      ...(s.mode==='catalog'?[]:['分配使用所查季度当前保存的任务记录，不是当时冻结的历史快照；不限定预计当季入市，可能包含跨季任务。',
        '楼宇覆盖按该季度任一提交计，人员任务只认本人提交；未知提交人不猜归属，未分配与缺报分开。',
        '提交不代表完整、有效或已审定；最新整条按created_at微秒及id选择，缺提交时间不猜最新，不跨期或跨来源补值。']),
      ...(s.mode==='quality'?['质量检查复用五项必填与八字段规则；原百分数字段0.5为0.5%，异常只提示复核，不改写原值。']:[]),
      '来源仅为数据库记录，未关联原件；配置、目录和当季分配/提交在同一完整授权快照读取。']});
}
