import { IMPERSONATION_REQUEST_HEADER } from '@/src/lib/server/impersonationAuth';
import { REGISTERED_AGENT_TOOL_NAMES } from '../agent/toolRegistry';
import { isAdministrationAction, runAdministration } from './administration';
import { environmentControl } from './environment';
import type { AuditKeys } from '../query/auditStore';
import { operationDetailSchema, operationsOverviewSchema, operationsTaskPageSchema } from './operationsView';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { readQueryBody } from '../query/httpBody';
import { isQuerySameOrigin } from '../query/sameOrigin';
import { verifyQueryIdentity } from '../query/serverAuthority';
import { validateControlConfig } from './config';
import { configurationDiff, controlStateSchema, draftSchema, historySchema, managementInputSchema, managementReadSchema, mayChangeConfiguration } from './managementView';

const reply = (data: unknown, status=200) => Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',Vary:`Authorization, ${IMPERSONATION_REQUEST_HEADER}`}});
export async function handleManagement(request: Request, dependencies: { client: SupabaseClient; digestKey: Uint8Array; keys?:AuditKeys }): Promise<Response> {
  try {
    if (!isQuerySameOrigin(request) || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??'')) return reply({status:'rejected'},400);
    const identity = await verifyQueryIdentity(request, dependencies.client).catch(()=>null);
    if (!identity || identity.actorId!==identity.effectiveUserId) return reply({status:'denied'},401);
    const body=await readQueryBody(request,dependencies.digestKey,5000);
    if(body.rejection)return reply({status:'rejected'},body.rejection==='body_too_large'?413:400);
    const parsed=managementInputSchema.safeParse(JSON.parse(body.text!));
    if(!parsed.success)return reply({status:'rejected'},400);
    const input=parsed.data;
    const call=async(action:string,payload:unknown={})=>{
      if(identity.expiresAt<=Date.now())throw new Error('CONTROL_DENIED');
      const {data,error}=await dependencies.client.rpc('ai_control_manage',{p_actor:identity.actorId,p_session:identity.sessionId,p_action:action,p_input:payload})
        .abortSignal(AbortSignal.any([request.signal,AbortSignal.timeout(6000)]));
      if(error)throw new Error('CONTROL_UNAVAILABLE');
      if(data?.reason==='rate_limit')throw new Error('CONTROL_RATE_LIMIT');
      if(data?.allowed!==true)throw new Error('CONTROL_DENIED');
      return data;
    };
    const current=managementReadSchema.parse(await call('read',{admit:true}));
    let result:unknown;
    if(input.action==='read') result={...current,environment:environmentControl()};
    else if(isAdministrationAction(input.action)) result=await runAdministration(input,current,dependencies.client,identity,request.signal,dependencies.keys);
    else if(input.action==='overview'||input.action==='tasks'||input.action==='detail'){
      if(input.action!=='detail'){
        const span=Date.parse(input.to)-Date.parse(input.from);
        if(span<=0||span>31*86400000||Date.parse(input.to)>Date.now()+60000)return reply({status:'rejected'},400);
      }
      const read=await dependencies.client.rpc('ai_operations_read',{p_actor:identity.actorId,p_session:identity.sessionId,p_input:input})
        .abortSignal(AbortSignal.any([request.signal,AbortSignal.timeout(6000)]));
      if(read.error)throw new Error('CONTROL_UNAVAILABLE');
      if(read.data?.allowed!==true)throw new Error('CONTROL_DENIED');
      result=input.action==='overview'?operationsOverviewSchema.parse(read.data):input.action==='tasks'?operationsTaskPageSchema.parse(read.data):operationDetailSchema.parse(read.data);
    }
    else if(input.action==='history')result=historySchema.parse(await call('history'));
    else {
      if(!('expectedRevision' in input))return reply({status:'rejected'},400);
      if(input.expectedRevision!==current.state.revision)return reply({status:'conflict'},409);
      if(input.action==='emergency') {
        if(!current.capabilities.includes('emergency:write'))throw new Error('CONTROL_DENIED');
      } else {
        if(!current.capabilities.includes('models:write')&&!current.capabilities.includes('budgets:write'))throw new Error('CONTROL_DENIED');
        const candidate=input.action==='publish' ? current.drafts.find(d=>d.id===input.draftId)?.config
          : input.action==='rollback' ? historySchema.parse(await call('history')).versions.find(v=>v.version===input.version)?.config : 'config' in input ? input.config : undefined;
        if(!candidate)return reply({status:'conflict'},409);
        const valid=validateControlConfig(candidate,current.models);
        if(valid.disabledTools.some(name=>!REGISTERED_AGENT_TOOL_NAMES.has(name)))throw new Error('CONTROL_MODEL_CAPABILITY');
        if(!mayChangeConfiguration(current.config,valid,current.capabilities))throw new Error('CONTROL_DENIED');
        if(input.action==='validate') {
          const live=managementReadSchema.parse(await call('read'));
          if(!mayChangeConfiguration(current.config,valid,live.capabilities))throw new Error('CONTROL_DENIED');
          if(live.state.revision!==current.state.revision)return reply({status:'conflict'},409);
          return reply({status:'ready',data:{diff:configurationDiff(current.config,valid),expectedRevision:current.state.revision},asOf:new Date().toISOString()});
        }
      }
      const {action,...payload}=input;
      const applied=await call(action,payload);
      if(applied.conflict===true)return reply({status:'conflict'},409);
      result=action==='draft' ? {draft:draftSchema.parse(applied.draft)} : {state:controlStateSchema.parse(applied.state)};
    }
    const final=managementReadSchema.parse(await call('read'));
    const needed=input.action==='overview'||input.action==='tasks'||input.action==='detail'||input.action==='budget'||input.action==='diagnostics'?'operations:read'
      :input.action==='grant'||input.action==='grants'?'grants:write':input.action==='test_run'?'tests:run':input.action==='global'||input.action==='emergency'||input.action==='alert_action'||input.action==='alert_rule'?'emergency:write':null;
    if(needed&&!final.capabilities.includes(needed as typeof final.capabilities[number]))throw new Error('CONTROL_DENIED');
    if(['registry','evaluations','evaluate','simulate'].includes(input.action)&&!final.capabilities.some(c=>['operations:read','models:write','tests:run'].includes(c)))throw new Error('CONTROL_DENIED');
    if(input.action==='read')result={...final,environment:environmentControl()};
    return reply({status:'ready',data:result,asOf:new Date().toISOString()});
  } catch(error) {
    if(error instanceof Error && error.message==='CONTROL_RATE_LIMIT')return reply({status:'rate_limited'},429);
    if(error instanceof Error && error.message==='CONTROL_CONFLICT')return reply({status:'conflict'},409);
    if(error instanceof Error && error.message==='CONTROL_DENIED')return reply({status:'denied'},403);
    if(error instanceof z.ZodError || error instanceof SyntaxError)return reply({status:'rejected'},400);
    if(error instanceof Error && /^CONTROL_(MODEL_|PROVIDER_|DEPLOYMENT_|FALLBACK_)/.test(error.message))return reply({status:'invalid_configuration',reason:error.message},422);
    return reply({status:'unavailable'},503);
  }
}
