import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function verifyAuditPeople({db,service,app,check,person,other,call,input,encryptAuditContent,decryptAuditContent,auditPayloadDigest,keyId,encryptionKey,digestKey}) {
  const window=()=>({action:'list',from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+500).toISOString()});
  const request=async(who,body)=>{const res=await fetch(app+'/api/intelligence/audit',{method:'POST',headers:{Authorization:'Bearer '+who.token,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json()};};
  const first=await person('viewer','people-one'),second=await person('editor','people-two');
  await db.query("update public.user_roles set full_name='Ming Zhang',chinese_name='张明' where user_id in ($1,$2)",[first.id,second.id]);
  await call(first,input());await call(second,input());
  await check('审计按当前中英文姓名找人，同名账号分别保留；非admin仍不能提问或取得目录信息',async()=>{
    for(const actorSearch of ['张明','ming zhang']){
      const r=await request(other,{...window(),actorSearch});assert.equal(r.status,200);assert.equal(r.body.identitySemantics,'current_directory_not_historical');assert.ok(Date.parse(r.body.directoryAsOf));
      assert.deepEqual(new Set(r.body.items.map(i=>i.actorId)),new Set([first.id,second.id]));assert.ok(r.body.items.every(i=>i.actorName==='张明 / Ming Zhang'));
      const ledger=(await db.query('select * from private.ai_audit_console_access where access_id=$1',[r.body.accessId])).rows[0];
      assert.ok(!JSON.stringify(ledger).includes(actorSearch));
      const document=JSON.parse(decryptAuditContent(ledger.cipher,{requestId:ledger.access_id,eventId:ledger.access_id,actorId:other.id,effectiveUserId:other.id},new Map([[keyId,encryptionKey]])));
      assert.equal(JSON.parse(document.content.rawRequest).actorSearch,actorSearch);
    }
    const denied=await request(first,{...window(),actorSearch:'张明'});assert.equal(denied.status,403);assert.deepEqual(denied.body,{status:'denied'});
    assert.equal((await request(other,{...window(),actorId:first.id,actorSearch:'张明'})).body.items.every(i=>i.actorId===first.id),true);
    assert.equal((await request(other,{...window(),actorSearch:"%' or true --"})).body.items.length,0);
    assert.equal((await request(other,{...window(),actorSearch:'x'.repeat(121)})).status,403);
  });
  await check('改名和目录删除不覆盖原始操作账号；未知身份保留UUID且不从metadata猜测',async()=>{
    await db.query("update public.user_roles set full_name='Changed Person',chinese_name=null where user_id=$1",[first.id]);
    const renamed=await request(other,{...window(),actorId:first.id});assert.equal(renamed.status,200);assert.equal(renamed.body.items[0].actorName,'Changed Person');
    const original=await request(other,{action:'intake',id:renamed.body.items[0].id});assert.equal(original.body.record.actorId,first.id);
    await db.query('delete from public.user_roles where user_id=$1',[first.id]);
    const missing=await request(other,{...window(),actorId:first.id});assert.equal(missing.status,200);assert.equal(missing.body.items[0].actorName,null);assert.equal(missing.body.items[0].actorId,first.id);
    const named=await request(other,{...window(),actorSearch:'张明'});assert.ok(named.body.items.every(i=>i.actorId===second.id));
  });
  await check('姓名过滤与签名游标绑定，超过一页的同名人员记录按稳定ID完整分页',async()=>{
    for(let i=0;i<53;i++){
      const id=randomUUID(),requestId=randomUUID(),body=JSON.stringify({content:{version:'query-intake/1',entry:'query_submission',payload:{rawRequest:JSON.stringify({question:'人员分页合成问题'+i})}},redactionTypes:[]});
      const response=await service.rpc('ai_query_record_intake',{p_event_id:id,p_request_id:requestId,p_actor:second.id,p_session:second.sessionId,p_reason:'request_received',p_bytes:100,p_complete:true,p_digest:'a'.repeat(64),p_digest_scope:'complete',p_effective:second.id,p_entry:'query_submission',p_content_digest:auditPayloadDigest(body,digestKey),p_cipher:encryptAuditContent(body,{requestId,eventId:id,actorId:second.id,effectiveUserId:second.id},keyId,encryptionKey)});assert.equal(response.error,null);
    }
    const filter={...window(),actorSearch:'张明'},one=await request(other,filter);assert.equal(one.status,200);assert.equal(one.body.items.length,50);assert.ok(one.body.nextCursor);
    const two=await request(other,{...filter,cursor:one.body.nextCursor});assert.equal(two.status,200);assert.equal(two.body.items.length,4);assert.equal(two.body.searchComplete,true);
    assert.equal(new Set([...one.body.items,...two.body.items].map(i=>i.id)).size,54);
    assert.equal((await request(other,{...filter,actorSearch:'Ming',cursor:one.body.nextCursor})).status,403);
  });
  await check('旧数据库没有人员检索协议时新应用拒绝返回，不能静默忽略姓名条件',async()=>{
    const old=await readFile(new URL('../../supabase/migrations/20261113123123_ai_admin_only_access.sql',import.meta.url),'utf8');
    const current=await readFile(new URL('../../supabase/migrations/20261113130012_ai_audit_actor_directory.sql',import.meta.url),'utf8');
    try{await db.query(old);const r=await request(other,{...window(),actorSearch:'张明'});assert.equal(r.status,503);assert.deepEqual(r.body,{status:'unavailable'});}
    finally{
      await db.query(current);
      const latest=await readFile(new URL('../../supabase/migrations/20261113132136_ai_audit_controlled_export.sql',import.meta.url),'utf8');
      await db.query(latest.slice(latest.indexOf('create or replace function private.ai_audit_console_read'),latest.indexOf('create table private.ai_audit_export_grants')));
    }
    assert.equal((await request(other,{...window(),actorSearch:'张明'})).status,200);
  });
}
