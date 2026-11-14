import {futureSample} from './futureFixture';
import {id,hash} from './submissionFixture';
import {buildFutureResult} from '../future/result';
import type {FutureAuthority} from '../future/reader';

export function timelineResult(count=4,unknown=false){
  const raw=futureSample();raw.mode='catalog';raw.period=null;raw.configuredPeriod=null;raw.periodBasis='none';raw.settings=[];raw.assignments=[];raw.submissions=[];
  raw.supplies=Array.from({length:count},(_,i)=>({...raw.supplies[i%4],id:id(i+1),launch_year:unknown?null:i===count-1?'2028':'2026'}));raw.expected={supplies:count,assignments:0,submissions:0};
  const authority:FutureAuthority={actorId:id(10),effectiveUserId:id(10),sessionId:id(20),sessionActive:true,permissionRevision:hash,policyVersion:'test',grants:['query:future-catalog'],fields:[],allSubmarkets:true,submarkets:[],allFutureSupplies:true,futureSupplyIds:[]};
  return buildFutureResult(raw,{view:'launch_schedule',period:null},authority,raw.requestId);
}
