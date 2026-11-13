import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { OWNER,OTHER,ADMIN,VIEWER } from '../lease-change-history/database.mjs';
import { createAiQueryTestDatabase,grantQuery,SESSION } from './database.mjs';

const db=await createAiQueryTestDatabase();let passed=0;
const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
const query=async(actor=OWNER,effective=actor,session=SESSION)=>{
  await db.setup.query('begin');
  try{
    await db.setup.query('set local role service_role');
    const result=await db.setup.query('select public.ai_query_authority($1,$2,$3) result',[actor,effective,session]);
    await db.setup.query('commit');return result.rows[0].result;
  }catch(error){await db.setup.query('rollback');throw error;}
};
try{
  await check('disabled by default and no admin bypass without explicit grants',async()=>{
    assert.deepEqual(await query(),{allowed:false});
    await db.setup.query("update private.ai_query_control set enabled=true,change_reference='isolated activation'");
    await db.setup.query('update auth.sessions set user_id=$1 where id=$2',[ADMIN,SESSION]);
    assert.deepEqual(await query(ADMIN),{allowed:false});
    await db.setup.query('update auth.sessions set user_id=$1 where id=$2',[OWNER,SESSION]);
  });
  await check('explicit grant returns scoped fields and current version, no business records',async()=>{
    await grantQuery(db,OWNER,{allSubmarkets:false,submarkets:['CBD']});
    const a=await query();assert.equal(a.allowed,true);assert.deepEqual(a.submarkets,['CBD']);assert.equal(a.all_submarkets,false);
    assert.deepEqual(a.fields,['height','netEffectiveRent','totalArea','vacantArea']);assert.equal(a.session_id,SESSION);
  });
  await check('deleted, wrong-owner, unknown and expired sessions deny old credentials',async()=>{
    assert.deepEqual(await query(OWNER,OWNER,randomUUID()),{allowed:false});
    assert.deepEqual(await query(OTHER,OTHER,SESSION),{allowed:false});
    await db.setup.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[SESSION]);
    assert.deepEqual(await query(),{allowed:false});
    await db.setup.query('delete from auth.sessions where id=$1',[SESSION]);assert.deepEqual(await query(),{allowed:false});
    await db.setup.query('insert into auth.sessions(id,user_id) values($1,$2)',[SESSION,OWNER]);
  });
  await check('banned/deleted accounts and removed/unknown roles fail closed',async()=>{
    for(const column of ['banned_until','deleted_at']){
      await db.setup.query(`update auth.users set ${column}=now()+interval '1 hour' where id=$1`,[OWNER]);
      assert.deepEqual(await query(),{allowed:false});await db.setup.query(`update auth.users set ${column}=null where id=$1`,[OWNER]);
    }
    await db.setup.query("update public.user_roles set role='unrecognized' where user_id=$1",[OWNER]);assert.deepEqual(await query(),{allowed:false});
    await db.setup.query("update public.user_roles set role='editor' where user_id=$1",[OWNER]);
  });
  await check('grant expiry, disable and scope changes change authority immediately',async()=>{
    const before=await query();
    await db.setup.query("update private.ai_query_grants set valid_until=now()-interval '1 second' where user_id=$1",[OWNER]);assert.deepEqual(await query(),{allowed:false});
    await grantQuery(db,OWNER,{allSubmarkets:false,submarkets:['金融街']});const after=await query();
    assert.notEqual(before.permission_revision,after.permission_revision);assert.deepEqual(after.submarkets,['金融街']);
    await db.setup.query('update private.ai_query_grants set enabled=false where user_id=$1',[OWNER]);assert.deepEqual(await query(),{allowed:false});
    await grantQuery(db,OWNER);
  });
  await check('admin simulation uses intersection of actual/effective grants and scopes',async()=>{
    await grantQuery(db,ADMIN,{allSubmarkets:false,submarkets:['CBD','金融街'],fields:['height','totalArea']});
    await grantQuery(db,OTHER,{allSubmarkets:false,submarkets:['CBD'],fields:['height']});
    await db.setup.query('update auth.sessions set user_id=$1 where id=$2',[ADMIN,SESSION]);
    const a=await query(ADMIN,OTHER);assert.equal(a.allowed,true);assert.deepEqual(a.fields,['height']);assert.deepEqual(a.submarkets,['CBD']);
    await db.setup.query('update private.ai_query_grants set enabled=false where user_id=$1',[ADMIN]);assert.deepEqual(await query(ADMIN,OTHER),{allowed:false});
    await grantQuery(db,ADMIN);
    await db.setup.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[OTHER]);assert.deepEqual(await query(ADMIN,OTHER),{allowed:false});
    await db.setup.query('update auth.users set banned_until=null where id=$1',[OTHER]);
    await db.setup.query('update auth.sessions set user_id=$1 where id=$2',[OWNER,SESSION]);assert.deepEqual(await query(OWNER,OTHER),{allowed:false});
  });
  await check('empty/disjoint submarket and building scopes deny rather than expand',async()=>{
    await grantQuery(db,OWNER,{allSubmarkets:false,submarkets:[]});assert.deepEqual(await query(),{allowed:false});
    await grantQuery(db,OWNER,{allBuildings:false,buildingIds:[]});assert.deepEqual(await query(),{allowed:false});
    await grantQuery(db,OWNER);
  });
  await check('global disable and policy changes are current, not cached claims',async()=>{
    const before=await query();await db.setup.query("update private.ai_query_control set policy_version='test-v2'");const after=await query();
    assert.notEqual(before.permission_revision,after.permission_revision);assert.equal(after.policy_version,'test-v2');
    await db.setup.query('update private.ai_query_control set enabled=false');assert.deepEqual(await query(),{allowed:false});
    await db.setup.query('update private.ai_query_control set enabled=true');
  });
  await check('policy changes append before/after records with honest maintenance identity',async()=>{
    const rows=(await db.setup.query('select * from private.ai_query_policy_events order by id')).rows;
    assert.ok(rows.length>15);assert.equal(rows.at(-1).actor_kind,'unknown');assert.equal(rows.at(-1).executor,'postgres');
    assert.equal(rows.at(-1).old_record.enabled,false);assert.equal(rows.at(-1).new_record.enabled,true);
  });
  await check('public users cannot call server authority RPC; service cannot grant itself permission',async()=>{
    await assert.rejects(db.asUser(VIEWER,'select public.ai_query_authority($1,$1,$2)',[ADMIN,SESSION]),error=>error.code==='42501');
    await db.setup.query('begin');
    try{await db.setup.query('set local role service_role');await assert.rejects(db.setup.query('update private.ai_query_grants set enabled=true'),error=>error.code==='42501');}
    finally{await db.setup.query('rollback');}
  });
  await check('in-flight authority transaction serializes with later withdrawal',async()=>{
    const second=new pg.Client({host:'127.0.0.1',port:Number(process.env.LEASE_TEST_PG_PORT),user:'postgres',password:'synthetic_ci_only',database:db.database});await second.connect();
    try{
      await db.setup.query('begin');await db.setup.query('select private.ai_query_authority($1,$1,$2)',[OWNER,SESSION]);
      await second.query("set lock_timeout='150ms'");
      await assert.rejects(second.query('update private.ai_query_grants set enabled=false where user_id=$1',[OWNER]),error=>error.code==='55P03');
      await db.setup.query('commit');await second.query('update private.ai_query_grants set enabled=false where user_id=$1',[OWNER]);
      assert.deepEqual(await query(),{allowed:false});
    }finally{await db.setup.query('rollback');await second.end();}
  });
  console.log(`PASS ${passed} authority PostgreSQL 17 scenarios; SQL session rows are isolated fixtures, not real Auth login evidence`);
}finally{await db.close();}
