import { REGISTERED_AGENT_TOOL_NAMES } from '../agent/toolRegistry';
import { deploymentLimits, modelSchema, type RegisteredModel } from './config';
/** Exact deployed identities and existing planning upper rates. No discovery or paid probe. */
export function environmentControl(env:NodeJS.ProcessEnv=process.env) {
  const models:RegisteredModel[]=[];let hard:ReturnType<typeof deploymentLimits>|null=null;
  try{hard=deploymentLimits(env);}catch{/* Keep emergency management available; never fabricate valid hard limits. */}
  const add=(provider:'deepseek'|'openai',model:string,inputRate:number,outputRate:number)=>{
    const id=`environment-${provider}-${model}`;
    if(!hard||models.some(m=>m.id===id)||!Number.isFinite(inputRate)||!Number.isFinite(outputRate))return;
    const parsed=modelSchema.safeParse({id,provider,model,name:model,enabled:true,verification:'environment_legacy',verifiedAt:null,
      tools:true,structured:true,streaming:true,reasoning:null,continuation:false,contextLimit:null,outputLimit:hard.outputTokens,
      inputRate,cachedInputRate:null,outputRate,currency:'USD',priceSource:'existing_deployment_planning_upper_rates_not_invoice',priceDate:null});
    if(parsed.success)models.push(parsed.data);
  };
  const ds=env.DEEPSEEK_CHAT_MODEL?.trim()||env.DEEPSEEK_MODEL?.trim()||'deepseek-flash';
  if(env.DEEPSEEK_API_KEY?.trim()&&['deepseek-flash','deepseek-v4-flash','deepseek-v4-pro'].includes(ds))add('deepseek',ds,ds==='deepseek-v4-pro'?1.32:.3,ds==='deepseek-v4-pro'?3.96:1.2);
  if(env.AI_OPENAI_ENABLED==='true'&&env.OPENAI_API_KEY?.trim())for(const mode of ['QUICK','PROFESSIONAL','DEEP']){
    const model=env[`OPENAI_AGENT_MODEL_${mode}`]?.trim()||env.OPENAI_AGENT_MODEL?.trim();
    if(model&&/^(?:gpt-|o[134](?:-|$))[a-zA-Z0-9._-]*$/.test(model))add('openai',model,Number(env.OPENAI_AGENT_INPUT_USD_PER_MILLION),Number(env.OPENAI_AGENT_OUTPUT_USD_PER_MILLION));
  }
  return {models,tools:[...REGISTERED_AGENT_TOOL_NAMES].sort(),limits:hard,invalid:hard===null,providers:{deepseek:{credentials:!!env.DEEPSEEK_API_KEY?.trim(),enabled:!!env.DEEPSEEK_API_KEY?.trim()},openai:{credentials:!!env.OPENAI_API_KEY?.trim(),enabled:env.AI_OPENAI_ENABLED==='true'}},fallback:env.AI_MODEL_FALLBACK_ENABLED==='true'};
}
