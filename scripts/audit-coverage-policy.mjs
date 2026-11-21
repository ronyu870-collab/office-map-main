const SERVER_AUDIT_CALL = /\b(?:withCriticalAudit|writeAuditBestEffort|writeAuditStackingSpace|writeAuditStackingExport)\s*\(/gi;
export const RELIABLE_ROUTES = new Map([
  ...['admin/create-user','admin/reset-password','admin/transfer-submission','admin/users','auth/complete-password-change','oss','map/submarket','admin/audit/export','lease-submission/export','audit-events/critical'].map(route=>[`src/app/api/${route}/route.ts`,['withCriticalAudit(']]),
  ['src/app/api/admin/impersonate/route.ts',[".from('audit_logs')","if (insertError)"]],
  ['src/app/api/communication/route.ts',[".rpc('post_market_message'"]],
  ['src/app/api/stacking-plan/[buildingId]/route.ts',[".rpc('stacking_plan_space_save'",".rpc('stacking_plan_source_attach'",".from('stacking_plan_export_events')"]],
]);
export function unawaitedServerAuditCalls(text) {
  const violations = [];
  SERVER_AUDIT_CALL.lastIndex = 0;
  for (const match of text.matchAll(SERVER_AUDIT_CALL)) {
    const index = match.index ?? 0;
    const prefix = text.slice(Math.max(0, index - 80), index);
    if (/(?:async\s+)?function\s+$/.test(prefix)) continue;
    if (/\b(?:await|return)\s+$/.test(prefix)) continue;
    violations.push(match[0].replace(/\s*\($/, ''));
  }
  return violations;
}

export function reliableSourceGaps(path,text){return (RELIABLE_ROUTES.get(path)||[]).filter(marker=>!text.includes(marker));}
