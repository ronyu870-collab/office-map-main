'use client';
import * as React from 'react';
import { modelSchema, type RegisteredModel } from '@/src/lib/intelligence/control/config';
import type { Registry } from '@/src/lib/intelligence/control/administrationView';
import type { ControlAction } from './common';
import { labels,time,usd } from './common';
const empty:RegisteredModel={id:'',provider:'deepseek',model:'',name:'',enabled:true,verification:'unverified',verifiedAt:null,tools:false,structured:false,streaming:false,reasoning:null,continuation:false,contextLimit:null,outputLimit:null,inputRate:0,cachedInputRate:null,outputRate:0,currency:'USD',priceSource:'',priceDate:null};
export function ModelCatalog({registry,inherited,act,canEdit,busy,onDirty}:{registry:Registry|null;inherited:RegisteredModel[];act:ControlAction;canEdit:boolean;busy:boolean;onDirty:(dirty:boolean)=>void}){
 const [editing,setEditing]=React.useState(false),[definition,setDefinition]=React.useState(empty),[revision,setRevision]=React.useState<string|null>(null),[reason,setReason]=React.useState(''),[confirmed,setConfirmed]=React.useState(false);
 React.useEffect(()=>{onDirty(editing);return()=>onDirty(false);},[editing,onDirty]);
 const begin=(id?:string)=>{const row=registry?.models.find(m=>m.id===id);setDefinition(row?.definition??empty);setRevision(row?.revision??null);setReason('');setEditing(true);setConfirmed(false);};
 return <section aria-label="模型目录">
  <p>仅支持现有 DeepSeek、OpenAI 适配器。密钥仍保存在服务端。目录维护不会切换生产模型；候选修改会清除协议验证资格。</p>
  {canEdit&&<div className="cc-row"><button disabled={busy} onClick={()=>begin()}>登记候选模型</button>{inherited.filter(m=>!registry?.models.some(r=>r.id===m.id)).map(m=><button disabled={busy} key={m.id} onClick={()=>void act({action:'inherit',modelId:m.id,reason:'显式登记现有部署模型及原费率，不改变生产配置'}).catch(()=>{})}>登记现有 {m.model}</button>)}</div>}
  <div className="cc-table"><table><thead><tr><th>模型</th><th>验证与启用</th><th>能力与限额</th><th>费率（USD / 百万 Token）</th><th>操作</th></tr></thead><tbody>{registry?.models.map(row=><tr key={row.id}><td>{row.definition.name}<br/>{row.definition.provider} · {row.definition.model}<br/>{row.id}</td><td>{labels[row.definition.verification]} · {row.definition.enabled?'已启用':'已停用'}<br/>{time(row.definition.verifiedAt)}</td><td>工具 {row.definition.tools?'支持':'未声明'} · 结构化 {row.definition.structured?'支持':'未声明'} · 流式 {row.definition.streaming?'支持':'未声明'}<br/>上下文 {row.definition.contextLimit??'未知'} / 输出 {row.definition.outputLimit??'未知'}</td><td>输入 {usd(row.definition.inputRate)} / 缓存 {usd(row.definition.cachedInputRate)} / 输出 {usd(row.definition.outputRate)}<br/>{row.definition.priceSource} · {row.definition.priceDate??'价格日期未知'}</td><td>{canEdit&&<button disabled={busy} onClick={()=>begin(row.id)}>编辑 / 批准</button>}</td></tr>)}</tbody></table></div>
  {!registry?.models.length&&<p>目录尚未登记模型。当前服务保持原部署配置；未执行连接探测。</p>}
  {editing&&<fieldset><legend>{revision?'编辑候选':'登记候选'}</legend><div className="cc-grid">
   {(['id','model','name','priceSource','priceDate'] as const).map(k=><label key={k}>{{id:'内部稳定标识',model:'供应商 Model ID',name:'名称',priceSource:'价格来源',priceDate:'价格适用日期（空为未知）'}[k]}<input disabled={k==='id'&&!!revision} value={definition[k]??''} type={k==='priceDate'?'date':'text'} onChange={e=>setDefinition({...definition,[k]:k==='priceDate'&&!e.target.value?null:e.target.value})} /></label>)}
   <label>供应商<select value={definition.provider} onChange={e=>setDefinition({...definition,provider:e.target.value as RegisteredModel['provider']})}><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option></select></label>
   {(['inputRate','cachedInputRate','outputRate','contextLimit','outputLimit'] as const).map(k=><label key={k}>{{inputRate:'输入费率',cachedInputRate:'缓存输入费率（空为未知）',outputRate:'输出费率',contextLimit:'上下文限制（空为未知）',outputLimit:'输出限制（空为未知）'}[k]}<input type="number" min="0" step={k.endsWith('Rate')?'0.001':'1'} value={definition[k]??''} onChange={e=>setDefinition({...definition,[k]:e.target.value===''?null:Number(e.target.value)})} /></label>)}
   <label>推理能力<select value={definition.reasoning===null?'unknown':String(definition.reasoning)} onChange={e=>setDefinition({...definition,reasoning:e.target.value==='unknown'?null:e.target.value==='true'})}><option value="unknown">未知</option><option value="true">支持</option><option value="false">不支持</option></select></label>
  </div><div className="cc-row">{(['enabled','tools','structured','streaming','continuation'] as const).map(k=><label key={k}><input type="checkbox" checked={definition[k]} onChange={e=>setDefinition({...definition,[k]:e.target.checked})} />{{enabled:'启用',tools:'工具调用',structured:'结构化输出',streaming:'流式响应',continuation:'原生续接'}[k]}</label>)}</div>
  <label>变更原因<input value={reason} maxLength={500} onChange={e=>setReason(e.target.value)} /></label>
  <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />已核实填写的能力、限制和费率；批准仅证明固定协议测试，复杂业务验收另计。</label>
  <div className="cc-row"><button disabled={busy||!reason.trim()||!confirmed||!modelSchema.safeParse(definition).success} onClick={()=>{void (async()=>{await act({action:'catalog',definition,expectedRevision:revision,reason});setEditing(false);})().catch(()=>{});}}>保存候选（清除验证）</button>
   {revision&&<button disabled={busy||!confirmed||!reason.trim()||!registry?.models.some(r=>r.id===definition.id&&JSON.stringify(r.definition)===JSON.stringify(definition))} onClick={()=>{void (async()=>{await act({action:'approve',modelId:definition.id,expectedRevision:revision,reason});setEditing(false);})().catch(()=>{});}}>以当前四项协议证据批准</button>}
   <button onClick={()=>setEditing(false)}>取消</button></div></fieldset>}
 </section>;
}
