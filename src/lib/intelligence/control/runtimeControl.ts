import type { ModelAttempt } from '../agent/modelRuntime';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { environmentControl } from './environment';
import type { VerifiedQueryIdentity } from '../query/serverAuthority';
import type { ProviderId } from '../agent/modelProtocol';
import { ModelProviderError } from '../agent/modelProvider';
import { controlConfigSchema, modelSchema, validateControlConfig, type ControlSnapshot, type RegisteredModel } from './config';

const stateSchema = z.object({ allowed: z.literal(true), version: z.uuid().nullable(), revision: z.uuid(), paused: z.boolean(),
  disabledProviders: z.array(z.enum(['deepseek', 'openai'])).max(2), disabledModels: z.array(z.string().max(120)).max(200),
  config: controlConfigSchema.nullable(), models: z.array(modelSchema).max(100).nullable() });
export type RuntimeControlBinding = { snapshot?: ControlSnapshot; availabilityModels?: RegisteredModel[];
  beforeCall: (provider: ProviderId, model: string, signal: AbortSignal, reservation?: {attempt:number;reserveUsd:number;modelId:string}) => Promise<void>;
  settle?: (attempt:ModelAttempt) => Promise<void> };

/** A single request snapshot, no process-global cache. Security controls remain live.
 * Only the exact absent RPC is compatible with a pre-migration deployment.
 * A database outage or malformed configuration always blocks paid calls. */
export async function bindRuntimeControl(client: SupabaseClient, identity: VerifiedQueryIdentity, signal: AbortSignal, requestId:string, testing=false): Promise<RuntimeControlBinding> {
  let failure: unknown, absent = false;
  const load = async (currentSignal: AbortSignal) => {
    currentSignal.throwIfAborted();
    if (identity.expiresAt <= Date.now() || identity.actorId !== identity.effectiveUserId) throw new Error('QUERY_DENIED');
    const result = await client.rpc('ai_control_runtime', { p_actor: identity.actorId, p_session: identity.sessionId })
      .abortSignal(AbortSignal.any([currentSignal, AbortSignal.timeout(3000)]));
    if (result.error) {
      if (['PGRST202', '42883'].includes(result.error.code) && /ai_control_runtime/.test(result.error.message)) return null;
      throw new ModelProviderError('invalid_configuration');
    }
    if (result.data?.allowed === false) throw new Error('QUERY_DENIED');
    return stateSchema.parse(result.data);
  };
  let snapshot: ControlSnapshot | undefined,availabilityModels:RegisteredModel[]|undefined;
  try {
    const initial = await load(signal);
    absent = initial === null;
    if (initial?.version) {
      if (!initial.config || !initial.models) throw new Error('CONTROL_INVALID_SNAPSHOT');
      snapshot = { version: initial.version, config: validateControlConfig(initial.config, initial.models), models: initial.models };
    }
    if(initial){
      const primaries=snapshot?new Set(Object.values(snapshot.config.modes).map(p=>p.model)):null;
      availabilityModels=initial.paused?[]:(snapshot?.models??environmentControl().models).filter(m=>(!primaries||primaries.has(m.id))&&m.enabled&&!initial.disabledProviders.includes(m.provider)&&!initial.disabledModels.includes(m.id)&&!initial.disabledModels.includes(m.model));
    }
  } catch (error) { availabilityModels=[];failure = error instanceof Error && error.message === 'QUERY_DENIED' ? error : new ModelProviderError('invalid_configuration'); }
  let settlementFailed=false;
  return { snapshot,availabilityModels, beforeCall: async (provider, model, currentSignal, reservation) => {
    if(settlementFailed)throw new ModelProviderError('budget_exceeded','admission_service_unavailable');
    if (failure) throw failure;
    const current = await load(currentSignal);
    if (!current && !absent) throw new ModelProviderError('invalid_configuration');
    if (current?.paused || current?.disabledProviders.includes(provider)
      || current?.disabledModels.includes(model)
      || current?.disabledModels.includes(`environment-${provider}-${model}`)
      || snapshot?.models.some(m => m.provider === provider && m.model === model && current?.disabledModels.includes(m.id)))
      throw new ModelProviderError('disclosure_denied');
    if(current && reservation){
      const admitted=await client.rpc('ai_model_budget',{p_actor:identity.actorId,p_session:identity.sessionId,p_request_id:requestId,p_action:'reserve',
        p_input:{attempt:reservation.attempt,provider,modelId:reservation.modelId,configurationVersion:snapshot?.version??null,reserveUsd:reservation.reserveUsd,testing}})
        .abortSignal(AbortSignal.any([currentSignal,AbortSignal.timeout(4500)]));
      if(admitted.error)throw new ModelProviderError('budget_exceeded','admission_service_unavailable');
      if(admitted.data?.allowed!==true){
        const reason=z.enum(['global_daily','global_monthly','provider_daily','provider_monthly','model_daily','model_monthly','test_daily','account_admission']).safeParse(admitted.data?.reason);
        throw new ModelProviderError('budget_exceeded',reason.success?reason.data:'account_admission');
      }
    }
  },settle:async(attempt)=>{
    if(absent)return;
    // Accounting must still settle after browser cancellation/revocation. It never
    // grants another send. A lost settlement keeps the full reservation occupied.
    try{
      const settled=await client.rpc('ai_model_budget',{p_actor:identity.actorId,p_session:identity.sessionId,p_request_id:requestId,p_action:'settle',
        p_input:{attempt:attempt.attempt,usageStatus:attempt.usageStatus,estimateUsd:attempt.estimateUsd}}).abortSignal(AbortSignal.timeout(4500));
      if(settled.error||settled.data?.allowed!==true)settlementFailed=true;
    }catch{settlementFailed=true;}
  } };

}
