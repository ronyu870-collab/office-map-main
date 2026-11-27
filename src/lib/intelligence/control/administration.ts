import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createRpcAuditPort, type AuditKeys } from '../query/auditStore';
import type { VerifiedQueryIdentity } from '../query/serverAuthority';
import { routeTask } from '../agent/taskRouting';
import { createModelRuntime, chooseModelMode, type ModelAttempt } from '../agent/modelRuntime';
import { ModelProviderError } from '../agent/modelProvider';
import { modelSchema, selectConfiguredModel, type ControlConfig } from './config';
import type { ManagementInput, ManagementRead } from './managementView';
import { budgetReadSchema, registrySchema } from './administrationView';
import { deepSeekModelForMode } from '../agent/modelProvider';
import { environmentControl } from './environment';
import { registeredEvaluation } from './evaluation';

const actions=new Set(['catalog','inherit','approve','registry','budget','simulate','evaluate','evaluations','diagnostics','alert_rule','alert_action','grants','grant','global','test_run']);
export function isAdministrationAction(action:string) {return actions.has(action);}
export async function runAdministration(input:ManagementInput,current:ManagementRead,client:SupabaseClient,identity:VerifiedQueryIdentity,signal:AbortSignal,keys?:AuditKeys) {
  const rpc=async(action:string,payload:unknown,completion=false)=>{
    if(!completion&&(identity.expiresAt<=Date.now()||signal.aborted))throw new Error('CONTROL_DENIED');
    const result=await client.rpc('ai_control_admin',{p_actor:identity.actorId,p_session:identity.sessionId,p_action:action,p_input:payload})
      .abortSignal(completion?AbortSignal.timeout(6000):AbortSignal.any([signal,AbortSignal.timeout(6500)]));
    if(result.error)throw new Error('CONTROL_UNAVAILABLE');
    if(result.data?.allowed!==true)throw new Error('CONTROL_DENIED');
    if(result.data?.conflict)throw new Error('CONTROL_CONFLICT');
    return result.data;
  };
  if(input.action==='simulate'||input.action==='evaluate'||input.action==='evaluations'){
    if(!current.capabilities.some(c=>['operations:read','models:write','tests:run'].includes(c)))throw new Error('CONTROL_DENIED');
    if(input.action==='evaluations')return rpc('evaluations',{});
    if(input.action==='evaluate'){const summary=await registeredEvaluation();return rpc('evaluation_save',{summary,configurationVersion:current.state.version});}
    const task=routeTask(input.question),mode=chooseModelMode(input.question),modelRequired=['single_interpretation','bounded_agent','deep_research'].includes(task.route);
    const purpose=task.route==='single_interpretation'?'semantic_intent':'agent';
    const selected=current.config&&current.state.version?selectConfiguredModel({version:current.state.version,config:current.config,models:current.models},mode,purpose,false):null;
    const env=environmentControl(),provider=process.env[`AI_PROVIDER_${mode.toUpperCase()}`]??'deepseek';
    const configured=provider==='openai'?process.env[`OPENAI_AGENT_MODEL_${mode.toUpperCase()}`]?.trim()||process.env.OPENAI_AGENT_MODEL?.trim():deepSeekModelForMode(mode).model;
    const inherited=env.models.find(m=>m.provider===provider&&m.model===configured),policy=current.config?.modes[mode];
    return {route:task.route,taskType:task.taskType,mode,configurationVersion:current.state.version??'environment/1',
      applicableModel:modelRequired?selected?{id:selected.id,provider:selected.provider,model:selected.model}:inherited?{id:inherited.id,provider:inherited.provider,model:inherited.model}:null:null,
      limits:policy?.limits??env.limits,routeReason:task.plan?'complete_deterministic_plan':task.capabilities?'live_capability_query':task.route,
      dataDomains:task.plan?['authorized_structured_query']:null,clarification:task.plan?'not_required_for_parse':'not_determined_offline',
      artifacts:{table:task.taskType==='query',file:task.exportFormat??task.chartExport??null,chart:task.chartType??null},modelRequired:['single_interpretation','bounded_agent','deep_research'].includes(task.route),
      requiresDataAuthorization:task.taskType!=='social',exportFormat:task.exportFormat??null,modelForbidden:task.modelForbidden??false,
      note:'复用正式 AI 6.0 分类器；不读取业务数据、不调用模型、不证明数据资格。'};
  }
  if(input.action==='budget'){
    const {data,error}=await client.rpc('ai_model_budget',{p_actor:identity.actorId,p_session:identity.sessionId,p_request_id:randomUUID(),p_action:'read',p_input:{}}).abortSignal(AbortSignal.any([signal,AbortSignal.timeout(5000)]));
    if(error)throw new Error('CONTROL_UNAVAILABLE');
    if(data?.allowed!==true)throw new Error('CONTROL_DENIED');return budgetReadSchema.parse(data);
  }
  if(input.action==='inherit'){
    const definition=environmentControl().models.find(m=>m.id===input.modelId);
    if(!definition)throw new Error('CONTROL_MODEL_NOT_APPROVED');
    return rpc('inherit',{...input,definition});
  }
  if(input.action==='catalog'){
    const m=input.definition;
    if(m.provider==='deepseek'&&!['deepseek-flash','deepseek-v4-flash','deepseek-v4-pro'].includes(m.model)
      ||m.provider==='openai'&&!/^(?:gpt-|o[134](?:-|$))[a-zA-Z0-9._-]*$/.test(m.model))throw new Error('CONTROL_MODEL_CAPABILITY');
    return rpc('catalog',{...input,definition:{...m,verification:'unverified',verifiedAt:null}});
  }
  if(input.action==='registry')return registrySchema.parse(await rpc('registry',{}));
  if(input.action==='test_run'){
    if(!keys)throw new Error('CONTROL_UNAVAILABLE');
    const requestId=randomUUID();
    await rpc('test_start',{...input,requestId});
    const checked=await rpc('test_check',{requestId}),model=modelSchema.parse(checked.model);
    const limits={tokens:60000,usd:input.maxUsd,outputTokens:256,timeoutMs:12000,attempts:1,tools:1};
    const config:ControlConfig={protocol:'ai-control-config/1',modes:{quick:{model:model.id,fallback:null,limits},professional:{model:model.id,fallback:null,limits},deep:{model:model.id,fallback:null,limits}},
      purposes:{semantic_intent:null,synthesis:null},budget:{kind:'observe',dailyUsd:1,monthlyUsd:1,testDailyUsd:0,warningPercent:[85],providerLimits:{deepseek:null,openai:null},modelLimits:{}},disabledTools:[]};
    const audit=createRpcAuditPort(client,identity,keys);
    await audit.receive({requestId,submittedText:`Registered synthetic protocol: ${input.kind}`,plan:{protocol:'ai-model-test/1',kind:input.kind,modelId:model.id},authority:{actorId:identity.actorId,effectiveUserId:identity.actorId,sessionActive:true,policyVersion:'ai-model-test/1',permissionRevision:input.expectedRevision,grants:[],fields:[]}});
    await audit.append(requestId,'running',{phase:'registered_model_test'});
    const budget=async(action:string,payload:unknown)=>{
      const result=await client.rpc('ai_model_budget',{p_actor:identity.actorId,p_session:identity.sessionId,p_request_id:requestId,p_action:action,p_input:payload}).abortSignal(AbortSignal.timeout(5000));
      if(result.error||result.data?.allowed!==true)throw new ModelProviderError('budget_exceeded','account_admission');
    };
    let attempt:ModelAttempt|undefined,deltaCount=0,passed=false,errorCode:string|null=null;
    const createRun=()=>createModelRuntime({actorId:identity.actorId,question:'Synthetic protocol validation',mode:'quick',protocolTest:input.kind,
      revalidate:async()=>{await rpc('test_check',{requestId});},onAttempt:async value=>{attempt=value;await audit.append(requestId,'accounting',value);},
      control:{snapshot:{version:current.state.version??requestId,config,models:[model]},beforeCall:async(provider,_name,_signal,reservation)=>{
        await rpc('test_check',{requestId});
        await budget('reserve',{...reservation,provider,configurationVersion:current.state.version,testing:true});
      },settle:async value=>budget('settle',{attempt:value.attempt,usageStatus:value.usageStatus,estimateUsd:value.estimateUsd})}});
    const prompt=input.kind==='tools'?'Call synthetic_sum exactly once with a=2 and b=3. Do not answer in text.':input.kind==='structured'?'Return exactly a JSON object {"sum":5} for 2+3.': 'Return exactly OK.';
    try{
      const result=await createRun().invoke([{role:'user',content:prompt}],signal,input.kind==='stream'?async()=>{deltaCount++;}:undefined);
      passed=input.kind==='tools'?result.message.calls?.length===1&&result.message.calls[0].name==='synthetic_sum'&&JSON.stringify(z.object({a:z.literal(2),b:z.literal(3)}).parse(JSON.parse(result.message.calls[0].arguments)))==='{"a":2,"b":3}'
        :input.kind==='structured'?z.strictObject({sum:z.literal(5)}).safeParse(JSON.parse(result.message.content??'')).success
        :result.message.content?.trim()==='OK'&&(input.kind!=='stream'||deltaCount>0);
      if(!passed)errorCode='protocol_assertion_failed';
    }catch(error){errorCode=error instanceof ModelProviderError?error.budgetReason??error.code:'protocol_failed';}
    const reported=attempt as ModelAttempt|undefined;
    const summary={actualModel:reported?.model??null,provider:model.provider,paidCalls:reported&&reported.usageStatus!=='not_sent'?1:0,
      inputTokens:reported?.inputTokens??null,outputTokens:reported?.outputTokens??null,usageStatus:reported?.usageStatus??'not_sent',estimateUsd:reported?.estimateUsd??null,durationMs:reported?.durationMs??null,
      deltaCount,errorCode,maxUsd:input.maxUsd,outputLimit:256,timeoutMs:12000,scope:'synthetic_protocol_only',actualBilledUsd:null};
    await audit.append(requestId,passed?'succeeded':'failed',{phase:'registered_model_test',reason:passed?'protocol_passed':errorCode});
    await rpc('test_finish',{requestId,state:passed?'passed':'failed',summary},true);
    return {requestId,state:passed?'passed':'failed',summary};
  }
  return rpc(input.action,input);
}
