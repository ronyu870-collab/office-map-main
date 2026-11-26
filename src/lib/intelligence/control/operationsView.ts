import { z } from 'zod';
import { operationMetadataSchema } from './operationsProjection';

const timestamp=z.iso.datetime({offset:true}), count=z.number().int().nonnegative(), amount=z.number().finite().nonnegative().nullable();
const range={from:timestamp,to:timestamp};
export const operationsInputs=[
  z.strictObject({action:z.literal('overview'),...range,provider:z.enum(['deepseek','openai']).optional(),model:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/).optional(),taskType:z.enum(['social','query','artifact','analysis','research']).optional(),mode:z.enum(['quick','professional','deep']).optional(),route:z.enum(['direct_response','deterministic_query','single_interpretation','bounded_agent','deep_research']).optional(),state:z.enum(['received','running','completed','partial','incomplete','clarification','denied','cancelled','failed','unknown']).optional(),purpose:z.enum(['agent','semantic_intent','synthesis']).optional(),actorId:z.uuid().optional(),costOrder:z.enum(['estimated_usd','tokens','calls','tools','duration','failed']).optional()}),
  z.strictObject({action:z.literal('tasks'),...range,order:z.enum(['newest','oldest']).optional(),pageSize:z.number().int().min(1).max(50).optional(),beforeTime:timestamp.optional(),beforeId:z.uuid().optional(),
    state:z.enum(['received','running','completed','partial','incomplete','clarification','denied','cancelled','failed','unknown']).optional(),
    provider:z.enum(['deepseek','openai']).optional(),model:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/).optional(),
    mode:z.enum(['quick','professional','deep']).optional(),route:z.enum(['direct_response','deterministic_query','single_interpretation','bounded_agent','deep_research']).optional(),
    taskType:z.enum(['social','query','artifact','analysis','research']).optional(),errorCategory:z.enum(['budget','configuration','security','cancelled','provider','tool','data','agent','unknown']).optional(),errorCode:z.string().regex(/^[a-zA-Z0-9_./-]{1,120}$/).optional(),
    configurationVersion:z.string().max(120).optional(),formalResult:z.boolean().optional(),filesComplete:z.boolean().optional(),fallback:z.boolean().optional(),actorId:z.uuid().optional()}),
  z.strictObject({action:z.literal('detail'),requestId:z.uuid()}),
] as const;
export const operationRequestSchema=z.object({request_id:z.uuid(),received_at:timestamp,updated_at:timestamp,last_sequence:count,
  state:z.string().max(30),metadata:operationMetadataSchema.omit({protocol:true,kind:true,type:true}).partial()});
export type OperationRequest=z.infer<typeof operationRequestSchema>;
export const operationsTaskPageSchema=z.object({allowed:z.literal(true),asOf:timestamp,items:z.array(operationRequestSchema).max(50),hasMore:z.boolean()});
export const operationDetailSchema=z.object({allowed:z.literal(true),asOf:timestamp,request:operationRequestSchema.nullable(),hasMore:z.boolean(),
  events:z.array(z.object({event_id:z.uuid(),sequence:count,at:timestamp,metadata:operationMetadataSchema})).max(512)});
export const operationsOverviewSchema=z.object({allowed:z.literal(true),asOf:timestamp,from:timestamp,to:timestamp,bucket:z.enum(['minute','hour','day']),
  metrics:z.object({requests:count,completed:count,partial:count,failed:count,cancelled:count,denied:count,clarification:count,incomplete:count.default(0),businessCompleted:count.default(0),businessEnded:count.default(0),running:count,possiblyInterrupted:count,
    p95Ms:amount,formalResults:count,fileTasks:count,fileTasksCompleted:count}),
  usage:z.object({calls:count,notSent:count,unknownUsage:count,inputTokens:amount,outputTokens:amount,cachedInputTokens:amount,reasoningTokens:amount,
    reservationTokens:amount.optional(),chargedTokens:amount.optional(),estimatedUsd:amount,reservedUnknownUsd:amount,actualBilledUsd:z.null(),billingStatus:z.literal('not_reconciled')}),
  efficiency:z.object({zeroPaidRequests:count,modelCallsPerRequest:amount,toolCallsPerRequest:amount,reusedTools:amount,fallbackRequests:count,legalRecoveryRate:amount,recoveryRequests:count.optional(),recoveryCompleted:count.optional()}).optional(),
  usageTrend:z.array(z.object({at:timestamp,calls:count,inputTokens:amount,outputTokens:amount,estimatedUsd:amount,reservedUnknownUsd:amount})).max(1500).optional(),
  costRanking:z.array(z.object({request_id:z.uuid(),state:z.string(),task_type:z.string().nullable(),configuration_version:z.string().nullable(),calls:count,estimated_usd:amount,reserved_unknown_usd:amount,duration_ms:amount,tokens:amount.optional(),tools:amount.optional()})).max(20).optional(),
  costDimensions:z.array(z.object({dimension:z.string(),value:z.string(),requests:count,completed:count,estimated_usd:amount,reserved_unknown_usd:amount,average_usd:amount,average_success_usd:amount,unsuccessful_usd:amount})).max(200).optional(),
  routes:z.array(z.object({route:z.string().max(120),requests:count})).max(10),
  models:z.array(z.object({provider:z.enum(['deepseek','openai']),model:z.string().max(120),calls:count,not_sent:count,unknown_usage:count,input_tokens:amount,output_tokens:amount,
    cached_input_tokens:amount,reasoning_tokens:amount,estimated_usd:amount,p50_ms:amount,p95_ms:amount,last_success:timestamp.nullable(),last_failure:timestamp.nullable(),business_requests:count.optional(),business_completed:count.optional(),failed_calls:count.optional(),fallback_calls:count.optional()})).max(100),
  trend:z.array(z.object({at:timestamp,requests:count,completed:count,partial:count,failed:count,cancelled:count,denied:count,budget:count})).max(1500),
  coverage:z.object({firstProjectedAt:timestamp.nullable(),projectedRequests:count,auditRequests:count,missingEvents:count}),
});
export type OperationsOverview=z.infer<typeof operationsOverviewSchema>;
