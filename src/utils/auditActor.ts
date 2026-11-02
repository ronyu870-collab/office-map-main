export interface AuditActor {
  user_id?: string | null;
  user_name?: string | null;
  actor_kind?: string | null;
  actor_name?: string | null;
}

const readable = (value?: string | null) => value?.trim() && !/[\u0000-\u001f\ufffd]/.test(value) ? value.trim() : '';

/** Preserve the raw identity; a tool name is never evidence of a human operator. */
export function displayAuditActor(log: AuditActor): string {
  if (log.actor_kind === 'unknown') return '身份待核验';
  if (readable(log.actor_name)) return readable(log.actor_name);
  // Existing rows and application-first rollout remain readable.
  if (log.user_id === 'codex') return 'Codex（工具执行）';
  if (log.user_id === 'system') return '系统任务';
  if (readable(log.user_name) && log.user_name !== log.user_id) return readable(log.user_name);
  return '身份待核验';
}

export function isUnresolvedAuditActor(log: AuditActor): boolean {
  return displayAuditActor(log) === '身份待核验';
}
