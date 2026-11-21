'use client';
import { useEffect,useState } from 'react';
import { supabase } from '@/src/services/supabaseClient';
import { getAuditQueueHealth } from '@/src/utils/audit';
interface Health { storage_history?:Array<{day:string;bytes:number;estimated_rows:number}>; pending_sample?:Array<{id:string;action_type:string;target_id?:string;created_at:string}>;auth?:{failed_logins:number;inspected:number}|null;repeated_operations?:number;permission_changes?:number;window:string;summary:{inspected:number;failures:number;unknown_actors:number;denied:number;deletes:number;exports:number;last_write:string|null;lag_p95_ms:number|null};pending_operations:number;storage_bytes:number;estimated_rows:number;retention:{ordinary_days:number;automatic_cleanup:boolean} }
export function AuditHealthPanel(){
 const [health,setHealth]=useState<Health|null>(null),[error,setError]=useState(''),[nonce,setNonce]=useState(0),[days,setDays]=useState(90),[saving,setSaving]=useState(false);
 const [local,setLocal]=useState<ReturnType<typeof getAuditQueueHealth>|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  void supabase.rpc('admin_audit_health').abortSignal(controller.signal).then(({data,error})=>{
   if(controller.signal.aborted)return;
   if(error||!data){setError('审计健康信息暂时无法读取。');setHealth(null);return;}
   setHealth(data as Health);setDays(data.retention.ordinary_days);setError('');setLocal(getAuditQueueHealth());
  },()=>{if(!controller.signal.aborted){setError('审计健康信息暂时无法读取。');setHealth(null);}});return()=>controller.abort();
 },[nonce]);
 const save=async()=>{setSaving(true);try{const result=await supabase.rpc('admin_set_audit_retention',{p_days:days});if(result.error)throw result.error;setNonce(n=>n+1);}catch{setError('保留策略未保存，请检查权限后重试。');}finally{setSaving(false);}};
 return <div className="min-h-0 flex-1 overflow-auto p-5 text-[13px] text-zinc-700">
  <div className="flex items-center gap-3"><h3 className="font-medium">审计健康</h3><button onClick={()=>setNonce(n=>n+1)} className="min-h-11 rounded border px-3">刷新指标</button></div>
  {error&&<p role="alert" className="mt-3 text-red-700">{error}</p>}
  {!health&&!error&&<p role="status">正在读取…</p>}
  {health&&<><p className="my-3">检查近 24 小时最新 {health.summary.inspected} 条（最多 1,000 条）。规则提示供管理员复核。</p>
   <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y py-4 sm:grid-cols-4">{Object.entries({最近写入:health.summary.last_write?new Date(health.summary.last_write).toLocaleString('zh-CN'):'范围内无记录',记录延迟P95:health.summary.lag_p95_ms==null?'—':`${Math.round(health.summary.lag_p95_ms)}ms`,存储大小:`${(health.storage_bytes/1048576).toFixed(1)} MiB`,估算行数:health.estimated_rows,错误记录:health.summary.failures,身份待核验:health.summary.unknown_actors,权限拒绝:health.summary.denied,超时未确认关键操作:health.pending_operations}).map(([name,value])=><div key={name}><dt className="text-zinc-500">{name}</dt><dd className="mt-1">{value}</dd></div>)}</dl>
   <p className="my-3 text-zinc-500">{health.storage_history&&health.storage_history.length>1?`已观察 ${health.storage_history[0].day} 至 ${health.storage_history.at(-1)!.day}，存储变化 ${((health.storage_history.at(-1)!.bytes-health.storage_history[0].bytes)/1048576).toFixed(2)} MiB。`:'存储趋势尚不足两个日期样本。'}仅管理员访问时按 UTC 日采样，最多显示最近 30 个样本。</p>
   <ul className="my-4 space-y-2">{health.auth&&health.auth.failed_logins>=10&&<li>近 15 分钟 Auth 样本出现 {health.auth.failed_logins} 次登录失败，请核查来源。</li>}{Boolean(health.repeated_operations)&&<li>发现同一关联操作的重复可信记录，请复核来源与幂等。</li>}{Boolean(health.permission_changes)&&<li>当前样本存在 {health.permission_changes} 次权限变更，请结合执行者与授权工单复核。</li>}{health.pending_operations>0&&<li>存在超过 5 分钟未确认的关键操作，请结合业务结果核查，禁止直接重放业务。</li>}{health.summary.denied>=10&&<li>当前样本权限拒绝达到 10 次，请复核访问范围。</li>}{health.summary.deletes>=10&&<li>当前样本删除事件达到 10 次，请复核批量维护记录。</li>}{health.summary.exports>=20&&<li>当前样本导出达到 20 次，请复核敏感数据范围。</li>}{health.summary.unknown_actors>0&&<li>存在未识别执行者；历史身份缺失不自动推断为系统操作。</li>}</ul>
   <details className="border-t py-4"><summary>待核查关键操作（最多 20 条）</summary><ul className="mt-3 space-y-2">{health.pending_sample?.map(item=><li key={item.id} className="break-all">{item.action_type} · {item.target_id||'未指定对象'} · {new Date(item.created_at).toLocaleString('zh-CN')}<br/>凭据 {item.id}</li>)}</ul></details><details className="border-t py-4"><summary>当前浏览器辅助队列</summary><p className="my-2">仅本浏览器当前会话诊断，不能代表全站队列或关键事件完整性。</p><pre className="overflow-auto">{JSON.stringify(local,null,2)}</pre></details>
   <div className="border-t py-4"><label className="flex flex-wrap items-center gap-3">普通事件建议保留天数<input aria-label="普通事件保留天数" type="number" min={30} max={3650} value={days} onChange={e=>setDays(Number(e.target.value))} className="w-24 rounded border p-2"/><button disabled={saving||days<30||days>3650} onClick={()=>void save()} className="min-h-11 rounded border px-3">{saving?'正在保存…':'保存策略'}</button></label><p className="mt-2">自动清理关闭。此策略仅供归档规划；执行删除前仍须审批、备份和核对关键安全记录。</p></div>
  </>}
 </div>;
}
