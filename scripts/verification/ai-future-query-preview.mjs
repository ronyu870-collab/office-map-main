import {randomUUID} from 'node:crypto';

/** Synthetic rows for the explicitly requested disposable Auth harness preview. */
export async function seedFutureQueryPreview(db,userId){
 const rows=[
  ['合成未来甲座','2026','Q4','future',60000],
  ['合成未来乙座','2026','H2','future',45000],
  ['合成未来丙座','2027',null,'future',null],
  ['合成待核项目',null,null,'pending',30000],
  ['合成未来丁座','2027','Q1','future',20000],
 ];
 const ids=[];
 for(const [name,year,quarter,status,area] of rows){
  const id=randomUUID();ids.push(id);
  await db.query(`insert into public.future_supplies(id,name,submarket,grade,launch_year,launch_quarter,status,total_area,location_lng,location_lat,is_entered_market)
   values($1,$2,'CBD','A',$3,$4,$5,$6,116.4,39.9,false)`,[id,name,year,quarter,status,area]);
 }
 await db.query("update private.ai_query_grants set capabilities=capabilities||array['query:future-catalog','query:future-progress','query:future-quality'],all_future_supplies=true where user_id=$1",[userId]);
 for(const id of ids.slice(0,3))await db.query("insert into public.future_supply_assignments(future_supply_id,user_id,user_name,record_year,record_quarter) values($1,$2,'合成验收账号',2026,3)",[id,userId]);
 for(const [id,asking] of [[ids[0],10],[ids[1],null]])await db.query(`insert into public.future_supply_submissions(future_supply_id,user_id,user_name,record_year,record_quarter,total_area,vacant_area,vacancy_rate,asking_rent,management_fee,face_rent,rent_free_period,net_effective_rent)
  values($1,$2,'合成验收账号',2026,3,10000,50,0.5,$3,30,120,6,100)`,[id,userId,asking]);
 return ids;
}
