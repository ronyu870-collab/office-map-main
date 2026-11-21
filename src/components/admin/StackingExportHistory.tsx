'use client';
import {useEffect,useRef,useState} from 'react';
import {getSessionFast} from '@/src/services/Auth';
import {withImpersonationHeaders} from '@/src/services/impersonationHeaders';
type Row={id:number|string;actor_id:string;export_format:string;recorded_at:string};
/** Historical dedicated evidence is queried in place, never copied/backfilled as new events. */
export function StackingExportHistory(){
 const [building,setBuilding]=useState('');const [rows,setRows]=useState<Row[]>([]);const [next,setNext]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const active=useRef<AbortController|null>(null);const [owner,setOwner]=useState<string|null>(null);
 useEffect(()=>()=>active.current?.abort(),[]);
 const load=async(before?:string)=>{
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(building)){setError('请输入完整楼宇 ID');return;}
  active.current?.abort();const controller=new AbortController();active.current=controller;setBusy(true);setError('');
  try{
   const session=await getSessionFast();if(!session?.session.access_token)throw new Error('请重新登录');
   const response=await fetch(`/api/stacking-plan/${building}?export_history=1${before?'&before='+encodeURIComponent(before):''}`,{headers:withImpersonationHeaders({Authorization:`Bearer ${session.session.access_token}`}),signal:controller.signal,cache:'no-store'});
   const body=await response.json();if(!response.ok)throw new Error(body.error || '查询失败');if(controller.signal.aborted)return;
   setOwner(building);setRows(body.records);setNext(body.has_next);
  }catch(cause){if(!controller.signal.aborted){setRows([]);setNext(false);setError(cause instanceof Error?cause.message:'查询失败');}}
  finally{if(!controller.signal.aborted)setBusy(false);}
 };
 return <details className="border-b px-5 py-2 text-[13px]"><summary className="cursor-pointer">历史 Stacking Plan 导出凭据</summary>
  <p className="my-2 text-zinc-500">查询原专表中的历史导出授权。新导出与原件下载已进入上方统一分类；凭据不证明文件落盘。</p>
  <form className="flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();void load();}}><input aria-label="历史导出楼宇 ID" value={building} onChange={event=>{active.current?.abort();setBusy(false);setBuilding(event.target.value);setOwner(null);setRows([]);setNext(false);}} className="min-w-64 rounded border px-2 py-1" placeholder="完整楼宇 ID"/><button disabled={busy} className="rounded border px-3 py-1">{busy?'查询中…':'查询历史导出'}</button></form>
  {error?<p role="alert">{error}</p>:null}
  {owner===building&&!busy&&!error&&!rows.length?<p className="my-2 text-zinc-500">未查到历史导出记录。</p>:null}
  {rows.length?<div className="mt-2 max-h-48 overflow-auto"><table className="w-full text-left"><thead><tr><th>时间</th><th>操作者 ID</th><th>格式</th><th>原记录 ID</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.recorded_at}</td><td>{row.actor_id}</td><td>{row.export_format}</td><td>{row.id}</td></tr>)}</tbody></table></div>:null}
  {owner===building&&next?<button disabled={busy} onClick={()=>void load(String(rows.at(-1)?.id))} className="my-2 rounded border px-3 py-1">下一页</button>:null}
 </details>;
}
