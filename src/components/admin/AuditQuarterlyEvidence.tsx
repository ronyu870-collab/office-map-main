'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/src/services/supabaseClient';
interface Evidence {user_id:string;request_id:string;entity_id:string;submission_id:string;record_year:number;record_quarter:number;submitted_at:string}
/** Read the dedicated source on demand, without copying submitted payloads. */
export function AuditQuarterlyEvidence({buildingId}:{buildingId:string}) {
 const [cursor,setCursor]=useState<Evidence|null>(null),[page,setPage]=useState<Evidence[]>([]),[more,setMore]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{
  const controller=new AbortController();
  void supabase.rpc('admin_audit_quarterly_timeline',{p_building_id:buildingId,p_before_at:cursor?.submitted_at??null,p_before_request:cursor?.request_id??null,p_before_user:cursor?.user_id??null}).abortSignal(controller.signal).then(({data,error})=>{
   if(controller.signal.aborted)return;
   setLoading(false);if(error){setError('独立季度证据暂时无法读取');setPage([]);return;}
   const rows=data as Evidence[];setPage(rows.slice(0,50));setMore(rows.length>50);setError('');
  },()=>{if(!controller.signal.aborted){setLoading(false);setError('独立季度证据暂时无法读取');}});
  return()=>controller.abort();
 },[buildingId,cursor]);
 return <details className="shrink-0 border-b px-5 py-3 text-[13px]"><summary>独立季度提交证据{loading?' · 读取中…':` · 本页 ${page.length} 条`}</summary>
  <p className="my-2 text-zinc-500">来自原有提交凭据表，仅展示已确认提交的元数据；历史缺失不代表未提交。</p>
  {error?<p role="alert" className="text-red-700">{error}</p>:<ol className="space-y-2">{page.map(row=><li key={`${row.user_id}:${row.request_id}`} className="break-all">{new Date(row.submitted_at).toLocaleString('zh-CN')} · {row.record_year}Q{row.record_quarter} · 操作人 {row.user_id}<br/>请求 {row.request_id} · 提交 {row.submission_id}</li>)}</ol>}
  <div className="mt-3 flex gap-3">{cursor&&<button className="min-h-11 rounded border px-3" onClick={()=>{setLoading(true);setCursor(null);}}>回到最新</button>}{more&&<button disabled={loading} className="min-h-11 rounded border px-3" onClick={()=>{setLoading(true);setCursor(page.at(-1)!);}}>下一页证据</button>}</div>
 </details>;
}
