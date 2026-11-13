import { z } from 'zod';

// Browser-safe wire contract. Decryption and audit authorization stay on the server.
const stamp = z.iso.datetime({ offset: true });
export const auditEntries = ['query_submission', 'query_result_recovery', 'query_result_artifact', 'query_delivery_report', 'legacy_intake', 'legacy_stream'] as const;
export const auditStates = ['received', 'running', 'succeeded', 'failed', 'denied', 'cancelled', 'unstarted'] as const;
export const auditEntryLabels: Record<typeof auditEntries[number], string> = {
  query_submission: '提问', query_result_recovery: '恢复结果', query_result_artifact: '作图与导出',
  query_delivery_report: '交付回执', legacy_intake: '早期提交', legacy_stream: '早期执行记录',
};
export const auditStateLabels: Record<typeof auditStates[number], string> = {
  received: '已接收', running: '处理中', succeeded: '执行成功', failed: '执行失败', denied: '已拒绝', cancelled: '已取消', unstarted: '未关联执行',
};
export const auditFilterSchema = z.object({
  action: z.literal('list'), from: stamp, to: stamp, actorId: z.uuid().optional(), actorSearch: z.string().trim().min(1).max(120).optional(),
  state: z.enum(auditStates).optional(), entry: z.enum(auditEntries).optional(), keyword: z.string().trim().min(1).max(200).optional(), cursor: z.string().max(3000).optional(),
});
export type AuditFilter = z.infer<typeof auditFilterSchema>;
export type AuditRead = AuditFilter | { action: 'intake' | 'stream'; id: string };
const summary = z.object({ id: z.uuid(), requestId: z.uuid(), kind: z.enum(['intake', 'stream']), at: stamp,
  actorId: z.uuid(), effectiveUserId: z.uuid(), actorName: z.string().max(320).nullable(), actorNameTruncated: z.boolean(), effectiveUserName: z.string().max(320).nullable(), effectiveUserNameTruncated: z.boolean(), entry: z.enum(auditEntries), relatedExecutionState: z.enum(auditStates),
  contentState: z.enum(['available', 'unavailable', 'integrity_unavailable']), excerpt: z.string().max(400).nullable(), truncated: z.boolean(),
});
export const auditListSchema = z.object({ status: z.literal('ready'), accessId: z.uuid(), items: z.array(summary).max(50),
  directoryAsOf: stamp, identitySemantics: z.literal('current_directory_not_historical'),
  scanned: z.number().int().min(0).max(50), unreadable: z.number().int().nonnegative(), nextCursor: z.string().max(3000).nullable(),
  searchComplete: z.boolean(), totalUnreadable: z.number().int().nonnegative(), totalMatches: z.null(), semantics: z.literal('attempts_and_legacy_streams'),
});
export const auditIntakeSchema = z.object({ status: z.literal('ready'), accessId: z.uuid(), record: z.object({
  id: z.uuid(), requestId: z.uuid(), actorId: z.uuid(), effectiveUserId: z.uuid().nullable(), at: stamp, entry: z.enum(auditEntries).nullable(),
  contentState: z.enum(['available', 'unavailable']), document: z.unknown(), meaning: z.literal('submitted_attempt_not_proof_of_execution'),
}).nullable() });
export const auditStreamSchema = z.object({ status: z.literal('ready'), accessId: z.uuid(), record: z.object({
  stream: z.object({ request_id: z.uuid(), actor_id: z.uuid(), effective_user_id: z.uuid(), state: z.enum(auditStates), head_sequence: z.number().int().positive(), head_hash: z.string() }),
  events: z.array(z.object({ id: z.uuid(), sequence: z.number().int().positive(), at: stamp, kind: z.string(), document: z.unknown() })).max(2048),
  generatedArchive: z.unknown(), archiveState: z.enum(['available', 'absent', 'incomplete_or_invalid']),
  delivery: z.literal('inspect_delivery_events_not_proof_of_human_read'), integrity: z.literal('current_database_chain_verified_not_independent_anchor'),
}).nullable() });
export type AuditList = z.infer<typeof auditListSchema>;
export type AuditItem = AuditList['items'][number];
export type AuditIntake = z.infer<typeof auditIntakeSchema>;
export type AuditStream = z.infer<typeof auditStreamSchema>;

export function auditSubmittedText(document: unknown): string | null {
  const parsed = z.object({ content: z.object({ submittedText: z.string().optional(), payload: z.object({ rawRequest: z.string() }).optional() }) }).safeParse(document);
  if (!parsed.success) return null;
  const content = parsed.data.content;
  if (content.submittedText !== undefined) return content.submittedText;
  const raw = content.payload?.rawRequest;
  if (raw === undefined) return null;
  try { const body: unknown = JSON.parse(raw); const question = z.object({ question: z.string() }).safeParse(body); if (question.success) return question.data.question; } catch { /* Invalid submissions remain reviewable text. */ }
  return raw;
}
