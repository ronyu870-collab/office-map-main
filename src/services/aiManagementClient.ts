import { managementInputSchema, type ManagementInput } from '@/src/lib/intelligence/control/managementView';
import { z } from 'zod';
export type ManagementScope={actorId:string;sessionId:string};
export class ManagementError extends Error {constructor(public readonly reason:'denied'|'conflict'|'unavailable'|'invalid_configuration'){super(reason);}}
async function sessionFor(scope:ManagementScope,signal:AbortSignal){
  const [{getSessionFast},{getImpersonationTargetUserId}]=await Promise.all([import('./Auth'),import('./impersonationHeaders')]);
  const session=await getSessionFast();signal.throwIfAborted();
  if(!session||session.user.id!==scope.actorId||session.session.user.id!==scope.actorId||session.sessionId!==scope.sessionId||getImpersonationTargetUserId())throw new ManagementError('denied');
  return session;
}
export async function requestAiManagement(scope:ManagementScope,input:ManagementInput,signal:AbortSignal):Promise<unknown>{
  managementInputSchema.parse(input);const session=await sessionFor(scope,signal),bounded=AbortSignal.any([signal,AbortSignal.timeout(input.action==='test_run'?35000:16000)]);
  const response=await fetch('/api/intelligence/management',{method:'POST',cache:'no-store',signal:bounded,headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.session.access_token}`},body:JSON.stringify(input)});
  if(response.status===401||response.status===403)throw new ManagementError('denied');
  if(response.status===409)throw new ManagementError('conflict');if(response.status===422)throw new ManagementError('invalid_configuration');
  if(!response.ok||!response.body)throw new ManagementError('unavailable');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{while(true){const part=await reader.read();bounded.throwIfAborted();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2*1024*1024)throw new ManagementError('unavailable');chunks.push(part.value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const all=new Uint8Array(bytes);let at=0;for(const c of chunks){all.set(c,at);at+=c.byteLength;}
  const value=z.object({status:z.literal('ready'),data:z.unknown(),asOf:z.string()}).parse(JSON.parse(new TextDecoder().decode(all)));
  await sessionFor(scope,signal);bounded.throwIfAborted();return value.data;
}
