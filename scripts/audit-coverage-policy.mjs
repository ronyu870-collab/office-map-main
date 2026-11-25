const SERVER_AUDIT_CALL = /\b(?:withCriticalAudit|writeAuditBestEffort|writeAuditStackingSpace)\s*\(/gi;
export const RELIABLE_ROUTES = new Map([
  ['src/app/api/intelligence/pitch/library/route.ts',['handleLibraryRequest(', 'pitch_studio_access']],
  ['src/app/api/intelligence/pitch/route.ts',['handlePitchRequest(', 'pitch_studio_access']],
  ...['map/building-photos','map/sales-materials'].map(route=>[`src/app/api/${route}/route.ts`,['withCriticalAudit(']]),
  ...['admin/create-user','admin/reset-password','admin/users','auth/complete-password-change','oss','map/submarket','admin/audit/export','lease-submission/export','audit-events/critical'].map(route=>[`src/app/api/${route}/route.ts`,['withCriticalAudit(']]),
  ['src/app/api/admin/transfer-submission/route.ts',["await client.rpc('transfer_lease_submission_v1'",'if (error)',"'TRANSFER_UNCONFIRMED'"]],
  ['src/app/api/admin/impersonate/route.ts',[".from('audit_logs')","if (insertError)"]],
  ['src/app/api/communication/route.ts',[".rpc('post_market_message'"]],
  ['src/app/api/stacking-plan/[buildingId]/route.ts',[".rpc('stacking_plan_space_save'",".rpc('stacking_plan_source_attach'",'withCriticalAudit(',"action_type:'STACKING_PLAN_EXPORT'","action_type:'STACKING_PLAN_ORIGINAL_DOWNLOAD'"]],
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
