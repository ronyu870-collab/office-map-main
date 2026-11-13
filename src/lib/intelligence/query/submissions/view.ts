import { z } from 'zod';
import { quarterSchema } from '../contracts';
import { SUBMISSION_POLICY, submissionFields } from './contracts';

export const submissionViewSchema = z.enum(['summary','buildings','missing','unassigned','people','missing_people','quality','missing_fields','anomalies']);
export type SubmissionView = z.infer<typeof submissionViewSchema>;
export const isSubmissionQualityView = (view: SubmissionView) => ['quality','missing_fields','anomalies'].includes(view);
const count = z.number().int().nonnegative();
const ids = z.array(z.string()).max(200000);
const fields = z.array(z.enum(['total_area','vacant_area','vacancy_rate','asking_rent','management_fee','face_rent','rent_free_period','net_effective_rent']));
export const submissionIssueSchema = z.object({kind:z.enum(['missing','invalid','inconsistent','unavailable']),code:z.string(),fields,sourceIds:ids});
const quality = z.object({requiredComplete:z.boolean(),missingRequired:fields,rentEligible:z.boolean(),vacancyEligible:z.boolean(),issues:z.array(submissionIssueSchema)});
export const submissionAnalysisSchema = z.object({
  version:z.literal(SUBMISSION_POLICY),snapshotId:z.uuid(),readAt:z.string(),requestId:z.uuid(),dataVersion:z.string(),
  period:quarterSchema,configuredPeriod:quarterSchema.nullable(),periodBasis:z.enum(['explicit','configured']),
  counts:z.object({catalogBuildings:count,assignedBuildings:count,unassignedBuildings:count,submittedBuildings:count,assignedSubmittedBuildings:count,
    missingAssignedBuildings:count,unassignedSubmittedBuildings:count,assignmentPairs:count,submittedOwnerPairs:count,missingOwnerPairs:count,
    duplicateAssignmentRows:count,invalidAssignmentRows:count,rawSubmissions:count,repeatSubmissionRows:count,latestUnresolvedBuildings:count}),
  submittedCoverage:z.object({numerator:z.string(),denominator:z.string()}).nullable(),
  quality:z.object({evaluatedBuildings:count,requiredCompleteBuildings:count,missingRequiredBuildings:count,flaggedBuildings:count,rentEligibleBuildings:count,vacancyEligibleBuildings:count}).nullable(),
  rows:z.array(z.object({buildingId:z.uuid(),name:z.string(),submarket:z.string().nullable(),grade:z.string().nullable(),assigned:z.boolean(),assigneeIds:ids,
    submitted:z.boolean(),rawSubmissionCount:count,latestUnresolved:z.boolean(),latestSubmissionId:z.string().nullable(),
    latestSubmittedBy:z.object({userId:z.string(),userName:z.string(),createdAt:z.string().nullable()}).nullable(),quality:quality.nullable(),sourceIds:ids})).max(20000),
  people:z.array(z.object({userId:z.string(),names:z.array(z.string()),assignedBuildingIds:ids,submittedBuildingIds:ids,missingBuildingIds:ids,sourceIds:ids})).max(100000),
  settingsSourceIds:ids,limitations:z.array(z.string()),
});
export type SubmissionAnalysis = z.infer<typeof submissionAnalysisSchema>;
export function submissionIssueText(issue: z.infer<typeof submissionIssueSchema>) {
  const fields = issue.fields.map(f=>submissionFields[f].label).join('、');
  const labels: Record<string,string> = {
    missing_field:'未填写',invalid_range_or_decimal:'数值或范围无效，需核对',vacant_exceeds_total:'空置面积超过总面积',
    stored_percentage_differs_from_areas:'填报百分数与面积重算不一致',net_rent_differs_from_36_month_formula:'净有效租金与36个月公式不一致',
    not_eligible_for_area_weighted_rent:'不可用于面积加权租金',not_eligible_for_area_weighted_vacancy:'不可用于面积加权空置率',
  };
  return `${fields}：${labels[issue.code]??'待核查'}`;
}
