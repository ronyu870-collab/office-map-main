import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function verifyContext({ client, concurrent, actor, viewer, pass }) {
  const id=randomUUID();
  await client.query(`insert into public.lease_transactions(id,company,new_building,transaction_date,lease_term_months,area_sqm,sub_market)
    values($1,'详情合成企业','合成楼宇',current_date-interval '5 years',60,1250.5,'成交楼宇子市场')`,[id]);
  await client.query(`insert into public.lease_transactions_history(id,source_uid,company,transaction_date,lease_term_months,area_sqm,industry,sub_industry,sub_market,old_sub_market)
    values($1,'context-composite','详情历史合成企业',current_date-interval '5 years',60,800,'历史行业','历史子行业','历史成交楼宇子市场','搬迁前子市场')`,[id]);
  const list=async(who=actor,conn=client,p=1)=>(await conn.query('select public.lease_expiry_context_list($1,current_date,$2) data',[who,p])).rows[0].data;
  const old=async(p=1)=>(await client.query("select public.lease_expiry_review_list($1,current_date,$2,'','window') data",[actor,p])).rows[0].data;
  const before=(await client.query('select to_jsonb(t) data from lease_transactions t where id=$1',[id])).rows[0].data;
  const all=[];
  for(let p=1;p<=3;p++){
    const base=await old(p),now=await list(actor,client,p);
    assert.deepEqual({...now,items:now.items.map(({details,...rest})=>rest)},base);
    all.push(...now.items);
  }
  const live=all.find(i=>i.source_kind==='live'&&i.source.id===id),history=all.find(i=>i.source_kind==='history'&&i.source.id===id);
  assert.deepEqual(live.details,{area_sqm:1250.5,sub_market:'成交楼宇子市场',industry:null,sub_industry:null});
  assert.deepEqual(history.details,{area_sqm:800,sub_market:'历史成交楼宇子市场',industry:'历史行业',sub_industry:'历史子行业'});
  assert.deepEqual((await client.query('select to_jsonb(t) data from lease_transactions t where id=$1',[id])).rows[0].data,before);
  pass('timeline details join source kind and UUID; original rows, page order, totals and review fingerprints unchanged');
  for(const role of ['anon','authenticated']){await client.query(`set role ${role}`);await assert.rejects(list(),e=>e.code==='42501');await client.query('reset role');}
  await assert.rejects(list(viewer),e=>e.code==='42501');
  await client.query('set role service_role');assert.ok((await list()).items.length);await client.query('reset role');
  for(const column of ['banned_until','deleted_at']){
    await client.query(`update auth.users set ${column}=now()+interval '1 day' where id=$1`,[actor]);await assert.rejects(list(),e=>e.code==='42501');await client.query(`update auth.users set ${column}=null where id=$1`,[actor]);
  }
  await client.query('begin');await client.query("update user_roles set role='viewer' where user_id=$1",[actor]);const denied=assert.rejects(list(actor,concurrent),e=>e.code==='42501');await client.query('commit');await denied;
  await client.query("update user_roles set role='admin' where user_id=$1",[actor]);
  pass('new detail RPC denies anonymous, non-admin, banned/deleted accounts and an in-flight revocation');
  await client.query('update lease_transactions set area_sqm=null,sub_market=null where id=$1',[id]);
  const updated=[];for(let p=1;p<=3;p++)updated.push(...(await list(actor,client,p)).items);
  assert.equal(updated.find(i=>i.source_kind==='live'&&i.source.id===id).details.area_sqm,null);
  await client.query('delete from lease_transactions where id=$1',[id]);
  const deleted=[];for(let p=1;p<=3;p++)deleted.push(...(await list(actor,client,p)).items);
  assert.ok(!deleted.some(i=>i.source_kind==='live'&&i.source.id===id));assert.ok(deleted.some(i=>i.source_kind==='history'&&i.source.id===id));
  pass('missing detail stays null and source deletion does not leak details from a colliding historical UUID');
}
