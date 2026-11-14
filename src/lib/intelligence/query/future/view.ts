import {z} from 'zod';
import {quarterSchema} from '../contracts';
import {submissionQualitySchema} from '../submissions/view';
import {FUTURE_POLICY,futureLaunchRangeSchema} from './contracts';

export const futureViewSchema=z.enum(['catalog','launch_summary','launch_schedule','area_summary','summary','buildings','missing','unassigned','people','missing_people','quality','missing_fields','anomalies']);
export type FutureView=z.infer<typeof futureViewSchema>;
export const futureModeForView=(view:FutureView)=>['catalog','launch_summary','launch_schedule','area_summary'].includes(view)?'catalog' as const:['quality','missing_fields','anomalies'].includes(view)?'quality' as const:'progress' as const;
export const futureSelectionSchema=z.strictObject({view:futureViewSchema,period:quarterSchema.nullable(),launchRange:futureLaunchRangeSchema.optional(),submarkets:z.array(z.string().trim().min(1).max(80)).min(1).max(30).optional(),futureIds:z.array(z.uuid()).min(1).max(500).optional()})
  .refine(s=>futureModeForView(s.view)!=='catalog'||s.period===null,{message:'Catalog period must be null'}).refine(s=>!s.launchRange||futureModeForView(s.view)==='catalog',{message:'Launch range applies to catalog views only'});
export type FutureSelection=z.infer<typeof futureSelectionSchema>;
const count=z.number().int().nonnegative(),ids=z.array(z.string()).max(200000),nullableText=z.string().nullable();
const number=z.object({numeric:z.number().finite(),exact:z.object({numerator:z.string().regex(/^-?\d{1,400}$/),denominator:z.string().regex(/^[1-9]\d{0,399}$/)})});
export const futureAnalysisSchema=z.object({version:z.literal(FUTURE_POLICY),snapshotId:z.uuid(),requestId:z.uuid(),readAt:z.string(),dataVersion:z.string(),
  mode:z.enum(['catalog','progress','quality']),period:quarterSchema.nullable(),configuredPeriod:quarterSchema.nullable(),periodBasis:z.enum(['none','configured','explicit']),
  catalog:z.object({records:count,futureRecords:count,pending:count,statusUnknown:count,unlinkedIdentities:count,knownArea:count,missingArea:count,invalidArea:count,
    knownLaunchQuarter:count,launchHalfYear:count,launchYearOnly:count,launchUnknown:count,launchInvalid:count}),
  progress:z.object({assignedSupplies:count,assignedSubmittedSupplies:count,missingAssignedSupplies:count,unassignedSupplies:count,submittedSupplies:count,unassignedSubmittedSupplies:count,
    assignmentPairs:count,submittedOwnerPairs:count,missingOwnerPairs:count,duplicateAssignments:count,rawSubmissions:count,repeatSubmissionRows:count,unknownSubmitterRows:count,latestUnresolvedSupplies:count,
    dueDefinite:count,duePossible:count,dueUnknown:count,dueOutside:count,coverage:z.object({numerator:z.string(),denominator:z.string()}).nullable()}).nullable(),
  rows:z.array(z.object({futureId:z.uuid(),buildingId:z.uuid().nullable(),name:z.string(),submarket:nullableText,grade:nullableText,status:nullableText,
    classification:z.enum(['future_record','pending','status_unknown']),launch:z.object({state:z.enum(['unknown','invalid','quarter','half_year','year']),reason:nullableText,start:quarterSchema.nullable(),end:quarterSchema.nullable()}),
    due:z.enum(['not_requested','unknown','outside','definite','possible']),completionYear:z.number().int().nullable(),
    area:z.object({state:z.enum(['missing','invalid','valid']),value:number.nullable(),sourceIds:ids}),location:z.object({state:z.enum(['unknown','invalid','valid']),lng:z.number().nullable(),lat:z.number().nullable(),sourceIds:ids}),
    assigned:z.boolean(),assigneeIds:ids,submitted:z.boolean(),rawSubmissionCount:count,latestUnresolved:z.boolean(),latestSubmissionId:z.uuid().nullable(),
    latestSubmittedBy:z.object({userId:z.uuid().nullable(),userName:z.string(),createdAt:z.string().nullable()}).nullable(),quality:submissionQualitySchema.nullable(),sourceIds:ids,fieldSources:z.record(z.string(),z.string())})).max(20000),
  people:z.array(z.object({userId:z.uuid(),names:z.array(z.string()),assignedIds:ids,submittedIds:ids,missingIds:ids,sourceIds:ids})).max(100000),settingsSourceIds:ids,limitations:z.array(z.string()),
});
export type FutureAnalysis=z.infer<typeof futureAnalysisSchema>;
export function futureLaunchText(r:FutureAnalysis['rows'][number]){
  const l=r.launch;if(!l.start||!l.end)return l.state==='invalid'?'未知：预计时间无效':'未知：未记录预计年份';
  return l.state==='quarter'?`${l.start.year}Q${l.start.quarter}`:l.state==='half_year'?`${l.start.year}年${l.start.quarter===1?'上':'下'}半年（季度未定）`:`${l.start.year}年（季度未定）`;
}
