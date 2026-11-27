import { runAgentLoop } from '../agent/agentOrchestrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createModelRuntime, modelAvailability } from '../agent/modelRuntime';
import type { AgentCompletion, ModelAdapter, ProviderId } from '../agent/modelProtocol';
import { createDeepSeekAdapter } from '../agent/deepseekAdapter';
import { ModelProviderError } from '../agent/modelProvider';
import { controlConfigSchema, modelSchema, validateControlConfig, type ControlConfig, type ControlSnapshot, type RegisteredModel } from './config';
import { bindRuntimeControl, bindScopedRuntimeControl } from './runtimeControl';

const actorId = randomUUID(), sessionId = randomUUID();
const signal = () => new AbortController().signal;
const model = (id: string, provider: ProviderId, name: string): RegisteredModel => modelSchema.parse({
  id, provider, model: name, name, enabled: true, verification: 'verified', verifiedAt: '2026-11-25T00:00:00Z',
  tools: true, structured: true, streaming: true, reasoning: null, continuation: provider === 'openai',
  contextLimit: null, outputLimit: 4096, inputRate: .3, outputRate: 1.2, cachedInputRate: null,
  priceSource: 'synthetic isolated fixture, not invoice', priceDate: '2026-11-25', currency: 'USD',
});
const models = [model('ds-flash','deepseek','deepseek-flash'), model('ds-pro','deepseek','deepseek-v4-pro'), model('oa-test','openai','gpt-6-test')];
const limits = { tokens: 60000, usd: .25, outputTokens: 1800, timeoutMs: 18000, attempts: 4, tools: 4 };
const makeConfig = (): ControlConfig => controlConfigSchema.parse({ protocol: 'ai-control-config/1',
  modes: Object.fromEntries(['quick','professional','deep'].map(mode => [mode, { model: mode === 'deep' ? 'ds-pro' : 'ds-flash', fallback: null, limits }])),
  purposes: { semantic_intent: 'ds-pro', synthesis: 'oa-test' },
  budget: { kind: 'observe', dailyUsd: 1, monthlyUsd: 10, testDailyUsd: 0, warningPercent: [85] }, disabledTools: [],
});
const snapshot = (): ControlSnapshot => ({ version: randomUUID(), config: makeConfig(), models: structuredClone(models) });
const complete = (provider: ProviderId, name: string): AgentCompletion => ({ provider, model: name, message: { role: 'assistant', content: 'isolated fixture' }, inputTokens: 20, outputTokens: 10 });
const adapter = (provider: ProviderId) => vi.fn<ModelAdapter>().mockImplementation(async (_messages,_signal,_delta,options) => complete(provider,options!.model));
beforeEach(() => {
  vi.stubEnv('DEEPSEEK_API_KEY','synthetic-only'); vi.stubEnv('AI_OPENAI_ENABLED','true'); vi.stubEnv('OPENAI_API_KEY','synthetic-only');
  vi.stubEnv('AI_OPENAI_ACTOR_IDS',actorId); vi.stubEnv('AI_MODEL_FALLBACK_ENABLED','true');
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('control configuration safety', () => {
  it('accepts approved configurations without changing environment defaults', () => {
    expect(validateControlConfig(makeConfig(), models)).toEqual(makeConfig());
    expect(process.env.DEEPSEEK_CHAT_MODEL).toBeUndefined();
  });
  it.each(['apiKey','url','sql','actorId'])('rejects unregistered top-level input %s', key => {
    expect(() => validateControlConfig({ ...makeConfig(), [key]: 'synthetic' }, models)).toThrow();
  });
  it('rejects unverified, disabled, non-tool and invalid-model registrations', () => {
    for (const patch of [{ enabled: false }, { verification: 'unverified' as const }, { tools: false }, { model: 'arbitrary-secret-model' }])
      expect(() => validateControlConfig(makeConfig(), models.map(m => m.id === 'ds-flash' ? { ...m, ...patch } : m))).toThrow();
  });
  it('rejects missing credentials and disabled deployment provider/fallback', () => {
    vi.stubEnv('DEEPSEEK_API_KEY',''); expect(() => validateControlConfig(makeConfig(),models)).toThrow('CONTROL_PROVIDER_UNAVAILABLE');
    vi.stubEnv('DEEPSEEK_API_KEY','synthetic-only'); vi.stubEnv('AI_OPENAI_ENABLED','false');
    expect(() => validateControlConfig(makeConfig(),models)).toThrow('CONTROL_PROVIDER_UNAVAILABLE');
    vi.stubEnv('AI_OPENAI_ENABLED','true');vi.stubEnv('AI_MODEL_FALLBACK_ENABLED','false');
    const value=makeConfig();value.modes.quick.fallback='oa-test';expect(() => validateControlConfig(value,models)).toThrow('CONTROL_FALLBACK_DISABLED');
  });
  it.each(['tokens','usd','outputTokens','timeoutMs'] as const)('cannot raise deployment hard limit %s', key => {
    const value=makeConfig(); const names={tokens:'AI_AGENT_MAX_TOKENS',usd:'AI_AGENT_MAX_ESTIMATED_USD',outputTokens:'AI_AGENT_MAX_OUTPUT_TOKENS',timeoutMs:'AI_AGENT_PROVIDER_TIMEOUT_MS'};
    vi.stubEnv(names[key],String(limits[key]/2));expect(() => validateControlConfig(value,models)).toThrow('CONTROL_DEPLOYMENT_LIMIT');
  });
});

describe('actual adapter configuration and live controls', () => {
  it('sends the selected approved Model ID in the actual DeepSeek wire request', async () => {
    vi.stubEnv('DEEPSEEK_CHAT_MODEL','deepseek-flash');
    const fetcher=vi.fn().mockImplementation(async (_url,options) => {
      const body=JSON.parse(options.body);
      return Response.json({model:body.model,choices:[{finish_reason:'stop',message:{role:'assistant',content:'synthetic'}}],usage:{prompt_tokens:20,completion_tokens:10}});
    });
    vi.stubGlobal('fetch',fetcher);
    try {
      const realAdapter=createDeepSeekAdapter();
      await realAdapter([{role:'user',content:'synthetic'}],signal(),undefined,{model:'deepseek-v4-pro',maxOutputTokens:256,timeoutMs:1000,tools:[]});
      expect(JSON.parse(fetcher.mock.calls[0][1].body).model).toBe('deepseek-v4-pro');
      expect(process.env.DEEPSEEK_CHAT_MODEL).toBe('deepseek-flash');
    }finally{vi.unstubAllGlobals();}
  });
  it.each(['quick','professional','deep'] as const)('passes the mode %s model ID to the real runtime adapter', async mode => {
    const bound=snapshot(), deepseek=adapter('deepseek'), onAttempt=vi.fn(), beforeCall=vi.fn();
    const run=createModelRuntime({actorId,question:'解释净有效租金概念',mode,control:{snapshot:bound,beforeCall},adapters:{deepseek},revalidate:async()=>{},onAttempt});
    await run.invoke([{role:'user',content:'synthetic'}],signal());
    expect(deepseek.mock.calls[0][3]?.model).toBe(mode === 'deep' ? 'deepseek-v4-pro' : 'deepseek-flash');
    expect(onAttempt.mock.calls[0][0].configurationVersion).toBe(bound.version);
    expect(run.summary().configurationVersion).toBe(bound.version);
  });
  it('uses dedicated semantic/synthesis model roles and one shared token ledger', async () => {
    const bound=snapshot(), deepseek=adapter('deepseek'), openai=adapter('openai');
    const run=createModelRuntime({actorId,question:'解释净有效租金概念',control:{snapshot:bound,beforeCall:async()=>{}},adapters:{deepseek,openai},revalidate:async()=>{},onAttempt:async()=>{}});
    await run.interpret([{role:'user',content:'synthetic'}],signal());
    await run.invoke([{role:'user',content:'synthetic'}],signal(),undefined,'synthesis');
    expect(deepseek.mock.calls[0][3]?.model).toBe('deepseek-v4-pro');expect(openai.mock.calls[0][3]?.model).toBe('gpt-6-test');
    expect(run.summary().chargedTokens).toBe(60);expect(run.records.map(r=>r.purpose)).toEqual(['semantic_intent','synthesis']);
  });
  it('uses the configured synthesis model through the actual agent orchestration after a verified tool result',async()=>{
    const bound=snapshot(),deepseek=adapter('deepseek'),openai=adapter('openai');
    deepseek.mockResolvedValueOnce({...complete('deepseek','deepseek-flash'),message:{role:'assistant',content:null,calls:[{id:'synthetic-call',name:'query_verified_real_estate',arguments:JSON.stringify({question:'synthetic bounded query'})}]}});
    const run=createModelRuntime({actorId,question:'解释合成结果',control:{snapshot:bound,beforeCall:async()=>{}},adapters:{deepseek,openai},revalidate:async()=>{},onAttempt:async()=>{}});
    const result=await runAgentLoop({question:'解释合成结果',invoke:run.invoke,limits:run.limits,signal:signal(),runTool:async()=>({content:'{"resultId":"synthetic-result"}',result:{resultId:'synthetic-result'}})});
    expect(result.result?.resultId).toBe('synthetic-result');expect(deepseek).toHaveBeenCalledTimes(1);expect(openai).toHaveBeenCalledTimes(1);
    expect(openai.mock.calls[0][3]?.model).toBe('gpt-6-test');expect(run.records.map(r=>r.purpose)).toEqual(['agent','synthesis']);
  });
  it('uses provider-reported cache counts as an input subset and applies the registered cache price once',async()=>{
    const bound=snapshot();bound.models[0].cachedInputRate=.1;
    const deepseek=adapter('deepseek').mockResolvedValue({...complete('deepseek','deepseek-flash'),inputTokens:100,outputTokens:20,cachedInputTokens:40,reasoningTokens:5});
    const run=createModelRuntime({actorId,question:'解释概念',control:{snapshot:bound,beforeCall:async()=>{}},adapters:{deepseek},revalidate:async()=>{},onAttempt:async()=>{}});
    await run.invoke([],signal());expect(run.records[0].chargedTokens).toBe(120);expect(run.records[0].estimateUsd).toBeCloseTo((60*.3+40*.1+20*1.2)/1e6,12);
  });
  it('does not silently substitute DeepSeek when a configured OpenAI actor lacks disclosure eligibility', async () => {
    const bound=snapshot();bound.config.modes.quick.model='oa-test';vi.stubEnv('AI_OPENAI_ACTOR_IDS','');
    const deepseek=adapter('deepseek'),openai=adapter('openai');
    const run=createModelRuntime({actorId,question:'解释概念',control:{snapshot:bound,beforeCall:async()=>{}},adapters:{deepseek,openai},revalidate:async()=>{},onAttempt:async()=>{}});
    await expect(run.invoke([],signal())).rejects.toThrow('AGENT_MODEL_DISCLOSURE_DENIED');
    expect(deepseek).not.toHaveBeenCalled();expect(openai).not.toHaveBeenCalled();expect(run.records[0].usageStatus).toBe('not_sent');
  });
  it('honors per-request attempts, output, timeout and tools below deployment caps', async () => {
    const bound=snapshot();bound.config.modes.quick.limits={...limits,attempts:1,tools:2,outputTokens:256,timeoutMs:2000};
    const deepseek=adapter('deepseek'); const run=createModelRuntime({actorId,question:'解释概念',control:{snapshot:bound,beforeCall:async()=>{}},adapters:{deepseek},revalidate:async()=>{},onAttempt:async()=>{}});
    expect(run.limits).toEqual({rounds:1,tools:2});await run.invoke([],signal());
    expect(deepseek.mock.calls[0][3]).toMatchObject({maxOutputTokens:256,timeoutMs:2000});
    await expect(run.invoke([],signal())).rejects.toMatchObject({code:'budget_exceeded',budgetReason:'attempt_limit'});
    expect(deepseek).toHaveBeenCalledTimes(1);
  });
  it('checks emergency controls before every provider send, preserving prior usage and truthful unsent accounting', async () => {
    let paused=false;const deepseek=adapter('deepseek');
    const run=createModelRuntime({actorId,question:'解释概念',control:{snapshot:snapshot(),beforeCall:async()=>{if(paused)throw new ModelProviderError('disclosure_denied');}},adapters:{deepseek},revalidate:async()=>{},onAttempt:async()=>{}});
    await run.invoke([],signal());paused=true;
    await expect(run.invoke([],signal())).rejects.toThrow('AGENT_MODEL_DISCLOSURE_DENIED');
    expect(deepseek).toHaveBeenCalledTimes(1);expect(run.records.at(-1)).toMatchObject({usageStatus:'not_sent',estimateUsd:0,chargedTokens:0});
    expect(run.summary().chargedTokens).toBe(30);
  });
  it('uses only the published fallback and cannot bypass the original provider disclosure rule', async () => {
    const bound=snapshot();bound.config.modes.quick.fallback='oa-test';
    const deepseek=vi.fn<ModelAdapter>().mockRejectedValue(new ModelProviderError('provider_unavailable')),openai=adapter('openai');
    const run=createModelRuntime({actorId,question:'解释概念',control:{snapshot:bound,beforeCall:async()=>{}},adapters:{deepseek,openai},revalidate:async()=>{},onAttempt:async()=>{}});
    await run.invoke([],signal());expect(openai.mock.calls[0][3]?.model).toBe('gpt-6-test');expect(run.records.map(r=>r.fallback)).toEqual([false,true]);
  });
});

describe('cross-instance binding and read failures', () => {
  const identity={actorId,effectiveUserId:actorId,sessionId,expiresAt:Date.now()+3600000};
  const db = (read: () => unknown) => ({rpc:vi.fn(()=>({abortSignal:async()=>read()}))}) as unknown as SupabaseClient;
  it('new requests bind new versions while in-flight requests preserve their original snapshot', async () => {
    let active=snapshot();const revision=randomUUID();
    const client=db(()=>({data:{allowed:true,...active,revision,paused:false,disabledModels:[],disabledProviders:[]},error:null}));
    const first=await bindRuntimeControl(client,identity,signal(),randomUUID());active=snapshot();active.config.modes.quick.model='ds-pro';
    const second=await bindRuntimeControl(client,identity,signal(),randomUUID());
    expect(first.snapshot?.version).not.toBe(second.snapshot?.version);expect(first.snapshot?.config.modes.quick.model).toBe('ds-flash');
    const deepseek=adapter('deepseek');for(const control of [first,second]){
      const run=createModelRuntime({actorId,question:'解释概念',control,adapters:{deepseek},revalidate:async()=>{},onAttempt:async()=>{}});await run.invoke([],signal());
    }
    expect(deepseek.mock.calls.map(c=>c[3]?.model)).toEqual(['deepseek-flash','deepseek-v4-pro']);
  });
  it.each(['paused','provider','model'])('a live %s stop applies to an already bound task', async kind => {
    const active=snapshot();let stop=false;
    const client=db(()=>({data:{allowed:true,...active,revision:randomUUID(),paused:stop&&kind==='paused',disabledModels:stop&&kind==='model'?['ds-flash']:[],disabledProviders:stop&&kind==='provider'?['deepseek']:[]},error:null}));
    const binding=await bindRuntimeControl(client,identity,signal(),randomUUID());await binding.beforeCall('deepseek','deepseek-flash',signal());stop=true;
    await expect(binding.beforeCall('deepseek','deepseek-flash',signal())).rejects.toThrow('AGENT_MODEL_DISCLOSURE_DENIED');
  });
  it('an inherited environment model can be stopped before any dynamic version is published',async()=>{
    const client=db(()=>({data:{allowed:true,version:null,revision:randomUUID(),paused:false,disabledModels:['environment-deepseek-deepseek-flash'],disabledProviders:[],config:null,models:null},error:null}));
    const binding=await bindRuntimeControl(client,identity,signal(),randomUUID());await expect(binding.beforeCall('deepseek','deepseek-flash',signal())).rejects.toThrow('AGENT_MODEL_DISCLOSURE_DENIED');
  });
  it('advertises a configured OpenAI primary without legacy model/rate variables and still enforces actor disclosure and pause',async()=>{
    const active=snapshot();for(const policy of Object.values(active.config.modes))policy.model='oa-test';
    vi.stubEnv('OPENAI_AGENT_MODEL','');vi.stubEnv('OPENAI_AGENT_INPUT_USD_PER_MILLION','');vi.stubEnv('OPENAI_AGENT_OUTPUT_USD_PER_MILLION','');
    let paused=false;const client=db(()=>({data:{allowed:true,...active,revision:randomUUID(),paused,disabledModels:[],disabledProviders:[]},error:null}));
    const binding=await bindRuntimeControl(client,identity,signal(),randomUUID());expect(modelAvailability(actorId,binding.availabilityModels).openai).toBe(true);expect(modelAvailability(randomUUID(),binding.availabilityModels).openai).toBe(false);
    paused=true;const stopped=await bindRuntimeControl(client,identity,signal(),randomUUID());expect(modelAvailability(actorId,stopped.availabilityModels).openai).toBe(false);
  });
  it('blocks paid calls on database failure without throwing at deterministic-query binding', async () => {
    const binding=await bindRuntimeControl(db(()=>({error:{code:'08006',message:'synthetic outage'}})),identity,signal(),randomUUID());
    expect(binding.snapshot).toBeUndefined();await expect(binding.beforeCall('deepseek','deepseek-flash',signal())).rejects.toThrow();
  });
  it('only accepts an exact absent RPC as pre-migration compatibility, never an unrelated function error', async () => {
    const absent=await bindRuntimeControl(db(()=>({error:{code:'PGRST202',message:'Could not find public.ai_control_runtime'}})),identity,signal(),randomUUID());
    await expect(absent.beforeCall('deepseek','deepseek-flash',signal())).resolves.toBeUndefined();
    const broken=await bindRuntimeControl(db(()=>({error:{code:'42883',message:'unknown helper'}})),identity,signal(),randomUUID());
    await expect(broken.beforeCall('deepseek','deepseek-flash',signal())).rejects.toThrow();
  });
});

describe('Pitch and ordinary control-plane integration', () => {
  const scopedProfile = { provider: 'deepseek' as const, model: 'synthetic-authorized-model',
    maxTokens: 20000, maxOutputTokens: 500, timeoutMs: 1000, maxUsd: .1, inputRate: .3, outputRate: 1.2 };
  it('pins content authorization despite a configured synthesis model and protocol-test tools', async () => {
    const deepseek=adapter('deepseek'), openai=adapter('openai'), beforeCall=vi.fn();
    const run=createModelRuntime({actorId,question:'Pitch Studio approved evidence',scopedProfile,
      control:{snapshot:snapshot(),beforeCall},protocolTest:'tools',adapters:{deepseek,openai},
      revalidate:async()=>{},onAttempt:async()=>{}});
    await run.invoke([],signal(),undefined,'synthesis');
    expect(deepseek.mock.calls[0][3]).toMatchObject({model:scopedProfile.model,tools:[]});
    expect(openai).not.toHaveBeenCalled();
    await expect(run.invoke([],signal())).rejects.toMatchObject({code:'budget_exceeded',budgetReason:'attempt_limit'});
  });
  it('keeps deployment ceilings above scoped task budgets', async () => {
    vi.stubEnv('AI_AGENT_MAX_OUTPUT_TOKENS','256');vi.stubEnv('AI_AGENT_MAX_TOKENS','10000');
    const deepseek=adapter('deepseek');
    const run=createModelRuntime({actorId,question:'Pitch Studio approved evidence',scopedProfile,adapters:{deepseek},
      revalidate:async()=>{},onAttempt:async()=>{}});
    await run.invoke([],signal());
    expect(deepseek.mock.calls[0][3]?.maxOutputTokens).toBe(256);
    expect(run.summary().maxTokens).toBe(10000);
  });
  it.each(['paused','provider','model'])('scoped workloads obey a live %s stop without borrowing ordinary query accounting', async kind => {
    let stop=false;
    const rpc=vi.fn((name:string)=>({abortSignal:async()=>{
      expect(name).toBe('ai_control_runtime');
      return {data:{allowed:true,version:null,revision:randomUUID(),paused:stop&&kind==='paused',
        disabledProviders:stop&&kind==='provider'?['deepseek']:[],disabledModels:stop&&kind==='model'?[scopedProfile.model]:[],
        config:null,models:null},error:null};
    }}));
    const control=await bindScopedRuntimeControl({rpc} as unknown as SupabaseClient,
      {actorId,effectiveUserId:actorId,sessionId,expiresAt:Date.now()+3600000},signal(),randomUUID());
    expect(control.snapshot).toBeUndefined();expect(control.settle).toBeUndefined();
    stop=true;
    const deepseek=adapter('deepseek');
    const run=createModelRuntime({actorId,question:'Pitch Studio approved evidence',scopedProfile,control,adapters:{deepseek},
      revalidate:async()=>{},onAttempt:async()=>{}});
    await expect(run.invoke([],signal())).rejects.toMatchObject({code:'disclosure_denied'});
    expect(deepseek).not.toHaveBeenCalled();
    expect(rpc.mock.calls.every(([name])=>name==='ai_control_runtime')).toBe(true);
  });
});
