import { z } from 'zod';
export const auditExportTargetSchema=z.strictObject({kind:z.enum(['intake','stream']),id:z.uuid()});
export const auditExportTargetsSchema=z.array(auditExportTargetSchema).min(1).max(50).refine(v=>new Set(v.map(x=>`${x.kind}:${x.id}`)).size===v.length);
export type AuditExportTarget=z.infer<typeof auditExportTargetSchema>;
export const auditExportDocumentSchema=z.object({
  format:z.literal('audit-export/1'),exportId:z.uuid(),requestedBy:z.uuid(),exportedAt:z.iso.datetime(),
  purpose:z.literal('internal_audit_only'),coverage:z.literal('selected_records_only'),
  targets:auditExportTargetsSchema,
  records:z.array(z.object({target:auditExportTargetSchema,capturedAt:z.iso.datetime({offset:true}),requestId:z.uuid(),
    intake:z.unknown(),execution:z.unknown()})).min(1).max(50),
  limitations:z.array(z.string()),
});
