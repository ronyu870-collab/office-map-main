import type {SupabaseClient} from '@supabase/supabase-js';
import {loadDataAuthority,type DataAuthority,type VerifiedQueryIdentity} from './serverAuthority';
import {loadFutureAuthority,type FutureAuthority} from './future/reader';
import {loadLeaseAuthority,type LeaseAuthority} from './leases/reader';
import type {QueryPlan} from './plan';
export type EntryAuthority=DataAuthority&FutureAuthority&LeaseAuthority;
const noStock={allBuildings:false,buildingIds:[]};
const noFuture={allFutureSupplies:false,futureSupplyIds:[]};
const noLease={allLeaseRecords:false,leaseRecordIds:[],leaseSources:[],leaseFields:[]};
/** Each resource loader grants only its own scope; credentials are never inferred across domains. */
export async function loadOperationAuthority(client:SupabaseClient,identity:VerifiedQueryIdentity,signal:AbortSignal,plan?:QueryPlan|null):Promise<EntryAuthority>{
  if(plan?.operation==='lease_observation')return {...await loadLeaseAuthority(client,identity,signal),...noStock,...noFuture};
  if(plan?.operation==='future_observation')return {...await loadFutureAuthority(client,identity,signal),...noStock,...noLease};
  return {...await loadDataAuthority(client,identity,signal),...noFuture,...noLease};
}
/** Entry/status admission only; factual recovery must reauthorize its stored plan. */
export async function loadEntryAuthority(client:SupabaseClient,identity:VerifiedQueryIdentity,signal:AbortSignal):Promise<EntryAuthority>{
  try{return await loadOperationAuthority(client,identity,signal);}catch(error){
    if(!(error instanceof Error)||error.message!=='QUERY_DENIED')throw error;
  }
  try{return {...await loadFutureAuthority(client,identity,signal),...noStock,...noLease};}catch(error){
    if(!(error instanceof Error)||error.message!=='QUERY_DENIED')throw error;
  }
  return {...await loadLeaseAuthority(client,identity,signal),...noStock,...noFuture};
}
