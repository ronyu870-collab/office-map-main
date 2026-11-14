import {z} from 'zod';
import {formatExact} from '../format';
import type {FutureAnalysis,FutureView} from './view';

export const futureAnswerSchema=z.strictObject({version:z.literal('future-answer/2'),paragraphs:z.array(z.string().min(1).max(2000)).min(1).max(8)});
/** Generate once from the same analysis, then archive the exact user-facing text. */
export function buildFutureAnswer(a:FutureAnalysis,view:FutureView,selectedCount:number){
 const c=a.catalog,p=a.progress;
 const scope=`当前获权且明确未入市的未来供应记录 ${c.records} 条；待核实 ${c.pending} 条、分类未知 ${c.statusUnknown} 条，未关联楼宇 ${c.unlinkedIdentities} 条。记录数不等于已确认的不同楼宇数。`;
 const precision=`预计季度明确 ${c.knownLaunchQuarter} 条，仅明确半年 ${c.launchHalfYear} 条、年份 ${c.launchYearOnly} 条；年份未知 ${c.launchUnknown} 条、时间无效 ${c.launchInvalid} 条。`;
 let paragraphs:string[];
 if(!p)paragraphs=view==='launch_summary'?[precision,scope]:[scope,precision,`总面积有效 ${c.knownArea} 条、缺失 ${c.missingArea} 条、无效 ${c.invalidArea} 条；原字段不自动等于办公或可租面积。`];
 else if(['quality','missing_fields','anomalies'].includes(view)){
  const evaluated=a.rows.filter(r=>r.quality!==null),complete=evaluated.filter(r=>r.quality!.requiredComplete).length,missing=evaluated.filter(r=>r.quality!.missingRequired.length>0).length;
  paragraphs=[`${view==='quality'?'最新提交可核查':view==='missing_fields'?`缺项或无法检查的记录 ${selectedCount} 条。最新提交可核查`:`本次规则发现需复核记录 ${selectedCount} 条。最新提交可核查`} ${evaluated.length} 条，其中五项输入齐全 ${complete} 条、缺项 ${missing} 条。`,
   `另有 ${c.records-p.submittedSupplies} 条无该季提交，${p.latestUnresolvedSupplies} 条无法确认最新记录；这些记录的质量未知。字段齐全不代表数值有效或已审定。`,scope];
 }else if(view==='people'||view==='missing_people')paragraphs=[`人员任务 ${p.assignmentPairs} 项，本人已提交 ${p.submittedOwnerPairs} 项、未提交 ${p.missingOwnerPairs} 项${view==='missing_people'?`；有未完成任务的负责人 ${selectedCount} 人`:''}。`,
  `人员任务只认本人提交，不能用其他人的提交代替；未知提交人记录 ${p.unknownSubmitterRows} 条，不猜归属。`,scope];
 else{
  const coverage=p.coverage?formatExact({exact:p.coverage,numeric:0},'ratio')+'%':'未知（没有已分配任务）';
  const prefix=view==='missing'?`无该季提交的记录 ${selectedCount} 条。`:view==='unassigned'?`该季未分配的记录 ${selectedCount} 条。`:'';
  paragraphs=[`${prefix}该季已分配 ${p.assignedSupplies} 条记录，其中有提交 ${p.assignedSubmittedSupplies} 条、未提交 ${p.missingAssignedSupplies} 条；提交覆盖率 ${coverage}。`,
   '记录覆盖按该季任一人员提交计，不等于本人已完成任务；提交不代表完整、有效或审定。',scope];
 }
 if(!selectedCount)paragraphs.push('本次授权范围没有符合该明细条件的记录，不代表现实市场没有。');
 return futureAnswerSchema.parse({version:'future-answer/2',paragraphs});
}
