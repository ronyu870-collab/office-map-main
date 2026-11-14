import {id,hash,time} from './submissionFixture';
import {FUTURE_POLICY,type FutureSnapshot} from '../future/contracts';
export function futureSample():FutureSnapshot{
  const supplies=[1,2,3,4].map(n=>({id:id(n),building_id:null,name:'同名项目',submarket:'CBD',grade:'A',launch_year:'2026',launch_quarter:['Q3','H2',null,'Q4'][n-1],
    total_area:'10000',location_lng:'116.4',location_lat:'39.9',status:n===3?'pending':'future',completion_year:2024,is_entered_market:false as const,created_at:time,version:hash}));
  const assignment=(n:number,f:number,u:number)=>({id:id(n),future_supply_id:id(f),user_id:id(u),user_name:'同名人员',record_year:2026,record_quarter:3,created_at:time,version:hash});
  const submission=(n:number,f:number,u:number)=>({...assignment(n,f,u),updated_at:time,values:{total_area:'10000',vacant_area:'50',vacancy_rate:'0.5',asking_rent:'10',management_fee:'30',face_rent:'120',rent_free_period:'6',net_effective_rent:'100'}});
  return {policy:FUTURE_POLICY,snapshotId:id(90),requestId:id(91),databaseSnapshot:'test-only',readAt:time,mode:'quality',period:{year:2026,quarter:3},configuredPeriod:{year:2026,quarter:3},periodBasis:'configured',
    inventory:'current_not_entered_future_records',assignmentsTime:'selected_quarter_current_records',complete:true,expected:{supplies:4,assignments:5,submissions:4},
    settings:[{key:'current_submission_year',value:'2026',updatedAt:time,version:hash},{key:'current_submission_quarter',value:'3',updatedAt:time,version:hash}],supplies,
    assignments:[assignment(31,1,11),assignment(32,1,11),assignment(33,1,12),assignment(34,2,11),assignment(35,3,12)],
    submissions:[submission(41,1,11),submission(42,1,11),submission(43,2,12),submission(44,4,12)]};
}
