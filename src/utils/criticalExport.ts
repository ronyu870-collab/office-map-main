import { supabase } from '@/src/services/supabaseClient';
import { withImpersonationHeaders } from '@/src/services/impersonationHeaders';
export type CriticalExportAction = 'EXPORT_DATA'|'EXPORT_BACKUP'|'EXPORT_MAP_DATA'|'EXPORT_BUILDING_COMPARISON'|'EXPORT_LEASE_TRANSACTIONS'|'SALES_MATERIAL_DOWNLOAD';
/** Called only on explicit export, immediately before handing bytes to the browser. */
export async function authorizeCriticalExport(action: CriticalExportAction, scope: string, count: number, format: 'xlsx'|'csv'|'zip'|'json'|'png'|'original' = 'xlsx'): Promise<void> {
  const {data:{session}} = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('登录状态已变化，请重新登录');
  const response = await fetch('/api/audit-events/critical', {method:'POST',cache:'no-store',
    headers:withImpersonationHeaders({'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`}),
    body:JSON.stringify({action,scope,count,format}),signal:AbortSignal.timeout(10000)});
  if (!response.ok || (await response.json()).authorized !== true) throw new Error('导出授权未完成，请重试');
  const current = await supabase.auth.getSession();
  if (current.data.session?.user.id !== session.user.id || current.data.session?.access_token !== session.access_token)
    throw new Error('登录状态已变化，请重新导出');
}
