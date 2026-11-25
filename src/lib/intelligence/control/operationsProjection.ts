import { z } from 'zod';
import { errorCategory } from './errorCategory';

const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const code=z.string().regex(/^[a-zA-Z0-9_./-]{1,120}$/);
export const operationMetadataSchema=z.strictObject({
  protocol:z.literal('ai-operations/1'), kind:z.enum(['received','running','tool_started','tool_finished','accounting','response_generated','succeeded','denied','failed','cancelled','correction','delivery_receipt']),
  type:z.enum(['lifecycle','model_attempt','summary','tool']),testing:z.boolean().optional(),
  mode:z.enum(['quick','professional','deep']).optional(), configurationVersion:code.optional(),
  route:z.enum(['direct_response','deterministic_query','single_interpretation','bounded_agent','deep_research']).optional(),
  taskType:z.enum(['social','query','artifact','analysis','research']).optional(),
  status:z.enum(['completed','partial','incomplete','clarification','denied','cancelled','failed']).optional(),
  phase:code.optional(), tool:code.optional(), tools:z.array(z.strictObject({name:code,status:z.enum(['ready','limited']),reused:z.boolean(),durationMs:count.nullable(),errorCode:code.optional()})).max(12).optional(), durationMs:count.optional(), formalResult:z.boolean().optional(),
  recoveryRequested:z.boolean().optional(),recoveryCompleted:z.boolean().optional(),paidModelCalls:count.optional(),filesRequested:count.optional(), filesCompleted:count.optional(), toolCalls:count.optional(), reusedTools:count.optional(),
  attempt:count.optional(), provider:z.enum(['deepseek','openai']).optional(), model:code.optional(),
  purpose:z.enum(['agent','semantic_intent','synthesis']).optional(), fallback:z.boolean().optional(),
  errorCategory:z.enum(['budget','configuration','security','cancelled','provider','tool','data','agent','unknown']).optional(),
  attemptState:z.enum(['completed','failed']).optional(), errorCode:code.optional(),
  usageStatus:z.enum(['provider_reported','unknown_reserved','not_sent']).optional(),
  inputTokens:count.nullable().optional(), outputTokens:count.nullable().optional(), cachedInputTokens:count.nullable().optional(), reasoningTokens:count.nullable().optional(),
  reservationTokens:count.optional(), chargedTokens:count.optional(), estimateUsd:z.number().finite().nonnegative().max(100000).optional(),
  messageBytes:count.optional(), toolBytes:count.optional(), opaqueBytes:count.optional(), systemBytes:count.optional(), observationBytes:count.optional(),
});
export type OperationMetadata=z.infer<typeof operationMetadataSchema>;
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

/** Explicit whitelist: never passes prompts, tool arguments/results, files, cipher,
 * raw supplier errors, native continuation or credentials to operational storage. */
export function operationMetadata(kind:OperationMetadata['kind'],raw:unknown):OperationMetadata {
  const sanitized=object(raw),value=object(sanitized.content ?? raw), operations=object(value.operations), context=object(value.context);
  const data:Record<string,unknown>={protocol:'ai-operations/1',kind,type:'lifecycle'};
  const take=(target:string,source:Record<string,unknown>,key=target)=>{if(source[key]!==undefined)data[target]=source[key];};
  if(value.protocol==='agent-model-attempt/1'){
    data.type='model_attempt';
    for(const key of ['mode','configurationVersion','attempt','provider','model','purpose','fallback','durationMs','usageStatus','inputTokens','outputTokens','cachedInputTokens','reasoningTokens','reservationTokens','chargedTokens','estimateUsd','errorCode'])take(key,value);
    take('attemptState',value,'state');
    for(const key of ['messageBytes','toolBytes','opaqueBytes','systemBytes','observationBytes'])take(key,context);
  }else{
    if(value.recoveryRequested===true)data.recoveryRequested=true;
    if(value.recoveryCompleted===true){data.recoveryCompleted=true;data.status='completed';}
    take('phase',value);if(value.phase==='registered_model_test')data.testing=true;take('route',value,'executionRoute');take('taskType',value);
    take('mode',operations);take('configurationVersion',operations);
    if(kind==='accounting' && value.provider==='server_policy'){
      data.type='summary';take('paidModelCalls',operations,'paidCalls');
      for(const key of ['durationMs','formalResult','toolCalls','reusedTools','filesRequested','filesCompleted'])take(key,value);
      if(['completed','partial','incomplete'].includes(String(value.status)))take('status',value);
      if(value.status==='limited')data.status='incomplete';
      if(Array.isArray(value.toolTrace))data.tools=value.toolTrace.slice(0,12).map(raw=>{const t=object(raw);return {name:t.name,status:t.status,reused:t.reused===true,durationMs:t.durationMs??null,...(typeof t.errorCode==='string'&&/^[a-zA-Z0-9_./-]{1,120}$/.test(t.errorCode)?{errorCode:t.errorCode}:{})};});
      if(typeof operations.budgetRejection==='string')data.errorCode=operations.budgetRejection;
    }
    if(typeof value.tool==='string' && /^[a-z_]{1,100}$/.test(value.tool)) {data.tool=value.tool; if(['tool_started','tool_finished'].includes(kind))data.type='tool';}
    if(['completed','partial','incomplete'].includes(String(value.executionStatus)))take('status',value,'executionStatus');
    if(value.executionStatus==='limited')data.status='incomplete';
    if(kind==='correction'&&value.delivery==='not_sent'){data.status=/authorization_changed|not_granted|rejected/.test(String(value.reason))?'denied':value.status==='cancelled'?'cancelled':'failed';data.formalResult=false;data.filesCompleted=0;data.recoveryCompleted=false;}
    if(kind==='denied')data.status=value.reason==='clarification_required'?'clarification':'denied';
    if(kind==='cancelled'||kind==='failed')data.status=kind;
    const result=object(value.result ?? value);
    if(kind==='response_generated' && z.uuid().safeParse(result.resultId).success && Array.isArray(object(result.table).columns))data.formalResult=true;
    // Reasons are stable server sentinels only; free-form messages never leave the audit layer.
    if(typeof value.reason==='string'&&/^(?:[a-z_]{1,100}|(?:AGENT|QUERY)_[A-Z_]{1,90})$/.test(value.reason))data.errorCode=value.reason;
  }
  if(typeof data.errorCode==='string')data.errorCategory=errorCategory(data.errorCode);
  return operationMetadataSchema.parse(data);
}
