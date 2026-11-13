import {z} from 'zod';
import {quarterSchema} from '../contracts';
import {submissionFieldKeys} from '../submissions/contracts';

export const FUTURE_POLICY='future-observation/1';
export const futureReadSchema=z.strictObject({mode:z.enum(['catalog','progress','quality']),period:quarterSchema.nullable(),
  submarkets:z.array(z.string().trim().min(1).max(80)).min(1).max(30).optional(),futureIds:z.array(z.uuid()).min(1).max(500).optional(),
}).refine(r=>r.mode!=='catalog'||r.period===null,{message:'Catalog period must be null; launch schedule is not submission period'});
export type FutureRead=z.infer<typeof futureReadSchema>;
const time=z.iso.datetime({offset:true}),hash=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().nullable();
const record={id:z.uuid(),version:hash};
const assignment={...record,future_supply_id:z.uuid(),user_id:z.uuid(),user_name:text,record_year:z.number().int(),record_quarter:z.number().int(),created_at:time.nullable()};
export const futureSnapshotSchema=z.strictObject({policy:z.literal(FUTURE_POLICY),snapshotId:z.uuid(),databaseSnapshot:z.string().min(1),readAt:time,requestId:z.uuid(),
  mode:z.enum(['catalog','progress','quality']),period:quarterSchema.nullable(),configuredPeriod:quarterSchema.nullable(),periodBasis:z.enum(['none','configured','explicit']),
  inventory:z.literal('current_not_entered_future_records'),assignmentsTime:z.literal('selected_quarter_current_records'),complete:z.literal(true),
  expected:z.strictObject({supplies:z.number().int().min(0).max(20000),assignments:z.number().int().min(0).max(100000),submissions:z.number().int().min(0).max(100000)}),
  settings:z.array(z.strictObject({key:z.enum(['current_submission_year','current_submission_quarter']),value:z.string(),updatedAt:time.nullable(),version:hash})).max(2),
  supplies:z.array(z.strictObject({...record,building_id:z.uuid().nullable(),name:z.string().min(1),submarket:text,grade:text,launch_year:text,launch_quarter:text,total_area:text,
    location_lng:text,location_lat:text,status:text,completion_year:z.number().int().nullable(),is_entered_market:z.literal(false),created_at:time})).max(20000),
  assignments:z.array(z.strictObject(assignment)).max(100000),
  submissions:z.array(z.strictObject({...assignment,user_id:z.uuid().nullable(),user_name:z.string(),updated_at:time.nullable(),values:z.record(z.string(),z.string().nullable())})).max(100000),
});
export type FutureSnapshot=z.infer<typeof futureSnapshotSchema>;
export function validateFutureSnapshot(input:unknown):FutureSnapshot {
  const s=futureSnapshotSchema.parse(input);
  for(const key of ['supplies','assignments','submissions'] as const)if(s[key].length!==s.expected[key]||new Set(s[key].map(r=>r.id)).size!==s[key].length)throw new Error('INCOMPLETE_FUTURE_SNAPSHOT');
  if(new Set(s.settings.map(r=>r.key)).size!==s.settings.length)throw new Error('DUPLICATE_FUTURE_SETTING');
  const y=s.settings.find(r=>r.key==='current_submission_year')?.value,q=s.settings.find(r=>r.key==='current_submission_quarter')?.value;
  const configured=/^\d{4}$/.test(y??'')&&/^[1-4]$/.test(q??'')?quarterSchema.safeParse({year:Number(y),quarter:Number(q)}):null;
  if(JSON.stringify(s.configuredPeriod)!==JSON.stringify(configured?.success?configured.data:null))throw new Error('FUTURE_PERIOD_MISMATCH');
  if(s.mode==='catalog'?(s.period!==null||s.periodBasis!=='none'||s.configuredPeriod!==null||s.settings.length>0||s.assignments.length>0||s.submissions.length>0)
    :s.period===null||s.periodBasis==='none'||s.periodBasis==='configured'&&JSON.stringify(s.period)!==JSON.stringify(s.configuredPeriod))throw new Error('FUTURE_PERIOD_MISMATCH');
  const ids=new Set(s.supplies.map(r=>r.id)),linked=s.supplies.flatMap(r=>r.building_id?[r.building_id]:[]);
  if(new Set(linked).size!==linked.length)throw new Error('DUPLICATE_FUTURE_BUILDING_IDENTITY');
  for(const r of [...s.assignments,...s.submissions])if(!ids.has(r.future_supply_id)||r.record_year!==s.period?.year||r.record_quarter!==s.period?.quarter)throw new Error('FUTURE_SCOPE_MISMATCH');
  for(const r of s.submissions)if(s.mode==='quality'
    ?Object.keys(r.values).length!==submissionFieldKeys.length||submissionFieldKeys.some(k=>!Object.hasOwn(r.values,k))
    :Object.keys(r.values).length>0)throw new Error('FUTURE_FIELD_SCOPE_MISMATCH');
  return s;
}
