import type {SupabaseClient} from '@supabase/supabase-js';
import {loadDataAuthority,type DataAuthority,type VerifiedQueryIdentity} from './serverAuthority';
import {loadFutureAuthority,type FutureAuthority} from './future/reader';
import type {QueryPlan} from './plan';
export type EntryAuthority=DataAuthority&FutureAuthority;
/** Independent resource scopes: a future-only account never receives stock scope. */
export async function loadOperationAuthority(client:SupabaseClient,identity:VerifiedQueryIdentity,signal:AbortSignal,plan?:QueryPlan|null):Promise<EntryAuthority>{
  if(plan?.operation==='future_observation')return {...await loadFutureAuthority(client,identity,signal),allBuildings:false,buildingIds:[]};
  return {...await loadDataAuthority(client,identity,signal),allFutureSupplies:false,futureSupplyIds:[]};
}
/** Entry/status admission only; factual recovery must reauthorize its stored plan. */
export async function loadEntryAuthority(client:SupabaseClient,identity:VerifiedQueryIdentity,signal:AbortSignal):Promise<EntryAuthority>{
  try{return await loadOperationAuthority(client,identity,signal);}catch(error){
    if(!(error instanceof Error)||error.message!=='QUERY_DENIED')throw error;
    return {...await loadFutureAuthority(client,identity,signal),allBuildings:false,buildingIds:[]};
  }
}
