import { REGISTERED_AGENT_TOOL_NAMES } from '../agent/toolRegistry';
import { deepSeekModelForMode } from '../agent/modelProvider';
import { deploymentLimits, modelSchema, type RegisteredModel } from './config';
/** Exact deployed identities and existing planning upper rates. No discovery or paid probe. */
export function environmentControl(env:NodeJS.ProcessEnv=process.env) {
  const models:RegisteredModel[]=[];let hard:ReturnType<typeof deploymentLimits>|null=null;
  try{hard=deploymentLimits(env);}catch{/* Keep emergency management available; never fabricate valid hard limits. */}
  const add=(provider:'deepseek'|'openai',model:string,inputRate:number,outputRate:number,think=false)=>{
    const id=`environment-${provider}-${model}`;
    if(!hard||models.some(m=>m.id===id)||!Number.isFinite(inputRate)||!Number.isFinite(outputRate))return;
    const parsed=modelSchema.safeParse({id,provider,model,name:model,enabled:true,verification:'environment_legacy',verifiedAt:null,
      tools:true,structured:true,streaming:true,reasoning:think ? true : null,continuation:think,contextLimit:null,outputLimit:hard.outputTokens,
      inputRate,cachedInputRate:null,outputRate,currency:'USD',priceSource:'existing_deployment_planning_upper_rates_not_invoice',priceDate:null});
    if(parsed.success)models.push(parsed.data);
  };
  if (env.DEEPSEEK_API_KEY?.trim()) {
    for (const mode of ['deep', 'professional', 'quick', undefined] as const) {
      const { model, thinkingConfigured } = deepSeekModelForMode(mode, env);
      if (!['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro'].includes(model)) continue;
      const pro = model === 'deepseek-v4-pro';
      add('deepseek', model, pro ? 1.32 : .3, pro ? 3.96 : 1.2, thinkingConfigured);
    }
  }
  if(env.AI_OPENAI_ENABLED==='true'&&env.OPENAI_API_KEY?.trim())for(const mode of ['QUICK','PROFESSIONAL','DEEP']){
    const model=env[`OPENAI_AGENT_MODEL_${mode}`]?.trim()||env.OPENAI_AGENT_MODEL?.trim();
    if(model&&/^(?:gpt-|o[134](?:-|$))[a-zA-Z0-9._-]*$/.test(model))add('openai',model,Number(env.OPENAI_AGENT_INPUT_USD_PER_MILLION),Number(env.OPENAI_AGENT_OUTPUT_USD_PER_MILLION));
  }
  return {models,tools:[...REGISTERED_AGENT_TOOL_NAMES].sort(),limits:hard,invalid:hard===null,providers:{deepseek:{credentials:!!env.DEEPSEEK_API_KEY?.trim(),enabled:!!env.DEEPSEEK_API_KEY?.trim()},openai:{credentials:!!env.OPENAI_API_KEY?.trim(),enabled:env.AI_OPENAI_ENABLED==='true'}},fallback:env.AI_MODEL_FALLBACK_ENABLED==='true'};
}
