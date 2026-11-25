'use client';
import * as React from 'react';
import { controlConfigSchema, type ControlConfig, type RegisteredModel } from '@/src/lib/intelligence/control/config';
import { configurationDiff, type ManagementRead } from '@/src/lib/intelligence/control/managementView';
import type { ControlAction } from './common';
import { labels } from './common';

type Props={read:ManagementRead;initial:ControlConfig|null;onDirty:(dirty:boolean)=>void;act:ControlAction;busy:boolean;budgetOnly?:boolean;availableTools?:string[];hardLimits?:{tokens:number;usd:number;outputTokens:number;timeoutMs:number}};
export function defaultConfiguration(model:RegisteredModel,hard?:Props['hardLimits']):ControlConfig{
 const policy={model:model.id,fallback:null,limits:{tokens:60000,usd:.25,outputTokens:1800,timeoutMs:18000,attempts:4,tools:4}};
 if(hard)policy.limits={...policy.limits,...hard,outputTokens:Math.min(hard.outputTokens,model.outputLimit??hard.outputTokens)};
 return controlConfigSchema.parse({protocol:'ai-control-config/1',modes:{quick:policy,professional:policy,deep:policy},purposes:{semantic_intent:null,synthesis:null},budget:{kind:'observe',dailyUsd:1,monthlyUsd:10,testDailyUsd:0,warningPercent:[85],providerLimits:{deepseek:null,openai:null},modelLimits:{}},disabledTools:[]});
}
export function ControlConfiguration({read,initial,onDirty,act,busy,budgetOnly=false,availableTools=[],hardLimits}:Props){
 const first=read.models.find(m=>m.enabled&&m.verification!=='unverified');
 const [config,setConfig]=React.useState<ControlConfig|null>(initial??(first?defaultConfiguration(first,hardLimits):null)),[reason,setReason]=React.useState(''),[preview,setPreview]=React.useState<unknown>(null),[draftId,setDraftId]=React.useState<string|null>(null);
 const baseRevision=React.useRef(read.state.revision);
 const [baseline,setBaseline]=React.useState(()=>JSON.stringify(initial));
 const changed=JSON.stringify(config)!==baseline;
 React.useEffect(()=>{onDirty(changed);return()=>onDirty(false);},[changed,onDirty]);
 const models=read.models.filter(m=>m.enabled&&m.verification!=='unverified');
 if(!config)return <p>先在模型管理中登记现有部署模型，或完成候选模型的协议测试与批准，再建立配置。当前请求继续继承服务端环境配置。</p>;
 const edit=(next:ControlConfig)=>{setConfig(next);setPreview(null);setDraftId(null);};
 const canModels=read.capabilities.includes('models:write'),canBudget=read.capabilities.includes('budgets:write');
 const fields=['tokens','usd','outputTokens','timeoutMs','attempts','tools'] as const;
 const names={tokens:'请求 Token 上界',usd:'请求费用上界（USD）',outputTokens:'单次输出 Token',timeoutMs:'供应商超时（毫秒）',attempts:'最多模型尝试',tools:'最多工具调用'};
 const diff=configurationDiff(initial,config);
 return <section aria-label="配置编辑">
  <p>新请求绑定发布版本；进行中的请求保留原版本。紧急暂停和实时撤权立即生效。所有数值仍受部署硬上限约束。</p>
  <div className="cc-grid">{(['quick','professional','deep'] as const).map(mode=><fieldset key={mode}><legend>{labels[mode]}</legend>
   {!budgetOnly&&<><label>模型<select disabled={!canModels} value={config.modes[mode].model} onChange={e=>edit({...config,modes:{...config.modes,[mode]:{...config.modes[mode],model:e.target.value}}})}>{models.map(m=><option key={m.id} value={m.id}>{m.name} · {m.provider}</option>)}</select></label>
   <label>跨供应商回退<select disabled={!canModels} value={config.modes[mode].fallback??''} onChange={e=>edit({...config,modes:{...config.modes,[mode]:{...config.modes[mode],fallback:e.target.value||null}}})}><option value="">停用</option>{models.filter(m=>m.provider!==models.find(x=>x.id===config.modes[mode].model)?.provider).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label></>}
   {fields.map(key=><label key={key}>{names[key]}<input disabled={!canBudget} type="number" step={key==='usd'?'0.000001':'1'} value={config.modes[mode].limits[key]} onChange={e=>edit({...config,modes:{...config.modes,[mode]:{...config.modes[mode],limits:{...config.modes[mode].limits,[key]:Number(e.target.value)}}}})} /></label>)}
  </fieldset>)}</div>
  {!budgetOnly&&<><div className="cc-grid">{(['semantic_intent','synthesis'] as const).map(purpose=><label key={purpose}>{purpose==='semantic_intent'?'语义解析模型':'结果总结模型'}<select disabled={!canModels} value={config.purposes[purpose]??''} onChange={e=>edit({...config,purposes:{...config.purposes,[purpose]:e.target.value||null}})}><option value="">继承模式模型</option>{models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>)}</div>
   <details><summary>功能工具开关（只限制已获权能力）</summary><div className="cc-grid">{availableTools.map(name=><label key={name}><input type="checkbox" disabled={!canModels} checked={!config.disabledTools.includes(name)} onChange={e=>edit({...config,disabledTools:e.target.checked?config.disabledTools.filter(v=>v!==name):[...config.disabledTools,name]})} />{name}</label>)}</div></details></>}
  <fieldset><legend>跨请求预算</legend><div className="cc-grid">
   <label>控制方式<select disabled={!canBudget} value={config.budget.kind} onChange={e=>edit({...config,budget:{...config.budget,kind:e.target.value as ControlConfig['budget']['kind']}})}><option value="observe">仅观察</option><option value="soft">软提醒</option><option value="hard">硬限制</option></select></label>
   {(['dailyUsd','monthlyUsd','testDailyUsd'] as const).map(key=><label key={key}>{{dailyUsd:'日预算（USD）',monthlyUsd:'月预算（USD）',testDailyUsd:'测试日硬预算（USD）'}[key]}<input disabled={!canBudget} type="number" step="0.001" value={config.budget[key]} onChange={e=>edit({...config,budget:{...config.budget,[key]:Number(e.target.value)}})} /></label>)}
   <label>提醒阈值（%，逗号分隔）<input disabled={!canBudget} value={config.budget.warningPercent.join(',')} onChange={e=>edit({...config,budget:{...config.budget,warningPercent:e.target.value.split(',').map(Number)}})} /></label>
  </div>
  <details><summary>供应商及模型独立预算</summary>{(['deepseek','openai',...models.map(m=>m.id)]).map(key=>{
   const provider=key==='deepseek'||key==='openai';const value=provider?config.budget.providerLimits[key]:config.budget.modelLimits[key];
   const change=(next:{dailyUsd:number;monthlyUsd:number}|null)=>edit({...config,budget:{...config.budget,...(provider?{providerLimits:{...config.budget.providerLimits,[key]:next}}:{modelLimits:next?{...config.budget.modelLimits,[key]:next}:Object.fromEntries(Object.entries(config.budget.modelLimits).filter(([k])=>k!==key))})}});
   return <div className="cc-row" key={key}><label><input disabled={!canBudget} type="checkbox" checked={!!value} onChange={e=>change(e.target.checked?{dailyUsd:config.budget.dailyUsd,monthlyUsd:config.budget.monthlyUsd}:null)} />{key}</label>{value&&(['dailyUsd','monthlyUsd'] as const).map(k=><label key={k}>{k==='dailyUsd'?'日 USD':'月 USD'}<input disabled={!canBudget} type="number" step="0.001" value={value[k]} onChange={e=>change({...value,[k]:Number(e.target.value)})} /></label>)}</div>;
  })}</details></fieldset>
  {(canModels||canBudget)&&<><label>发布原因<input value={reason} maxLength={500} onChange={e=>setReason(e.target.value)} /></label><div className="cc-row">
   <button disabled={busy} onClick={()=>void act({action:'validate',config,expectedRevision:baseRevision.current}).then(setPreview).catch(()=>{})}>校验并预览</button>
   <button disabled={busy||!preview} onClick={()=>{void (async()=>{const value=await act({action:'draft',config,expectedRevision:baseRevision.current}) as {draft:{id:string}};setDraftId(value.draft.id);})().catch(()=>{});}}>保存草稿</button>
   <button disabled={busy||!draftId||!reason.trim()} onClick={()=>{void (async()=>{const published=await act({action:'publish',draftId:draftId!,expectedRevision:baseRevision.current,reason}) as {state:{revision:string}};baseRevision.current=published.state.revision;setBaseline(JSON.stringify(config));setPreview(null);setDraftId(null);onDirty(false);})().catch(()=>{});}}>发布配置</button>
  </div></>}
  <details open={!!preview}><summary>变更预览 · {diff.length} 项</summary>{diff.length?<div className="cc-table"><table><thead><tr><th>路径</th><th>原值</th><th>新值</th></tr></thead><tbody>{diff.map(d=><tr key={d.path}><td>{d.path}</td><td>{JSON.stringify(d.before)}</td><td>{JSON.stringify(d.after)}</td></tr>)}</tbody></table></div>:<p>与当前配置相同。</p>}{preview!=null&&<p>服务端校验通过。保存草稿后，仍会在发布时重新核对目录、权限与版本。</p>}</details>
 </section>;
}
