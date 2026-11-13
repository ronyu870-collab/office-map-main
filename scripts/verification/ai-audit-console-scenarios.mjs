import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export async function verifyAuditConsole({db,service,app,check,person,viewer,other,admin,call,input,successful,encryptAuditContent,decryptAuditContent,auditPayloadDigest,keyId,encryptionKey,digestKey}) {
  const request=async(who,body,headers={})=>{
    const res=await fetch(app+'/api/intelligence/audit',{method:'POST',headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+who.token}:{}),...headers},body:JSON.stringify(body)});
    return {status:res.status,body:await res.json(),headers:res.headers};
  };
  const window=()=>({action:'list',from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+500).toISOString()});
  const grant=who=>db.query("insert into private.ai_audit_read_grants(user_id,valid_until,grant_reference) values($1,now()+interval '1 day','synthetic explicit auditor') on conflict(user_id) do update set valid_until=excluded.valid_until,grant_reference=excluded.grant_reference",[who.id]);
  const accessBody=e=>{
    const document=JSON.parse(decryptAuditContent(e.cipher,{requestId:e.access_id,eventId:e.access_id,actorId:e.actor_id,effectiveUserId:e.effective_user_id},new Map([[keyId,encryptionKey]])));
    return document.encoding==='gzip-base64'?JSON.parse(gunzipSync(Buffer.from(document.data,'base64'),{maxOutputLength:512*1024}).toString('utf8')):document;
  };
  await check('审计默认拒绝管理员/普通用户/匿名，未知与存在的目标没有泄漏差异',async()=>{
    assert.equal((await request(null,window())).status,401);
    for(const who of [viewer,admin,other]){
      assert.equal((await request(who,window())).status,403);
      for(const id of [successful.body.requestId,randomUUID()])assert.deepEqual((await request(who,{action:'stream',id})).body,{status:'denied'});
    }
    assert.equal((await db.query("select count(*)::int n from private.ai_audit_console_access where outcome='denied'")).rows[0].n,9);
  });
  await grant(other);
  await check('审计检索接口的限额内非法控制字符正文也完整加密留痕',async()=>{
    const body='\u0000'.repeat(24576);
    const res=await fetch(app+'/api/intelligence/audit',{method:'POST',headers:{Authorization:'Bearer '+other.token,'Content-Type':'application/json'},body});assert.equal(res.status,403);
    const row=(await db.query("select * from private.ai_audit_console_access where actor_id=$1 and action='invalid' order by occurred_at desc limit 1",[other.id])).rows[0];
    assert.equal(accessBody(row).content.rawRequest,body);
  });
  await check('明确审计资格独立于AI使用权，真实API可读他人原文、回答快照和交付事件',async()=>{
    await db.query('delete from private.ai_query_grants where user_id=$1',[other.id]);
    const res=await request(other,{action:'stream',id:successful.body.requestId});assert.equal(res.status,200);
    assert.equal(res.body.record.stream.actor_id,viewer.id);assert.deepEqual(res.body.record.generatedArchive,successful.body.result);
    assert.equal(res.body.record.events[0].document.content.submittedText,'CBD最高的楼是什么？');assert.equal(res.body.record.archiveState,'available');
    const row=(await db.query('select * from private.ai_audit_console_access where parent_access_id=$1',[res.body.accessId])).rows[0];
    assert.equal(row.outcome,'allowed');assert.equal(row.response_digest,createHash('sha256').update(JSON.stringify(res.body)).digest('hex'));
    assert.match(res.headers.get('cache-control'),/no-store/);
    const old=await service.rpc('ai_query_audit_read',{p_actor:other.id,p_effective:other.id,p_request_id:successful.body.requestId});assert.equal(old.data.allowed,false);
  });
  await check('孤立入口可按原文检索及展开，原文检索条件加密记录，不假装已经查询成功',async()=>{
    const text='独立原文检索例子 CBD有哪些楼';
    await db.query("create function private.console_orphan_fault() returns trigger language plpgsql set search_path='' as $$begin raise exception 'synthetic orphan';end $$;create trigger console_orphan_fault before insert on private.ai_query_audit_events for each row execute function private.console_orphan_fault()");
    let failed;
    try{failed=await call(viewer,{...input(),question:text});assert.equal(failed.status,503);}finally{await db.query('drop trigger console_orphan_fault on private.ai_query_audit_events;drop function private.console_orphan_fault()');}
    const res=await request(other,{...window(),actorId:viewer.id,state:'unstarted',keyword:'独立原文检索例子'});assert.equal(res.status,200);
    const match=res.body.items.find(item=>item.requestId===failed.body.requestId);assert.ok(match);assert.equal(match.relatedExecutionState,'unstarted');
    const detail=await request(other,{action:'intake',id:match.id});assert.equal(detail.status,200);assert.equal(JSON.parse(detail.body.record.document.content.payload.rawRequest).question,text);
    assert.equal(detail.body.record.meaning,'submitted_attempt_not_proof_of_execution');
    const logged=(await db.query('select * from private.ai_audit_console_access where access_id=$1',[res.body.accessId])).rows[0];
    assert.ok(!JSON.stringify(logged).includes('独立原文检索例子'));assert.match(accessBody(logged).content.rawRequest,/独立原文检索例子/);
  });
  await check('原文凭证保持脱敏，旧无入口问答也能检索，模拟/跨源/越界条件均拒绝',async()=>{
    const submitted={...input(),question:'CBD有哪些楼 password=syntheticSecretValue'};
    const fresh=await call(viewer,submitted);assert.equal(fresh.status,200);
    const detail=await request(other,{action:'stream',id:fresh.body.requestId});assert.equal(detail.status,200);assert.ok(!JSON.stringify(detail.body).includes('syntheticSecretValue'));
    const conflict=await call(viewer,{...submitted,question:'旧流检索例子'});assert.equal(conflict.status,409);
    const page=await request(other,{...window(),actorId:viewer.id,entry:'legacy_stream',keyword:'旧流检索例子'});assert.equal(page.status,200);assert.ok(page.body.items.some(item=>item.requestId===conflict.body.requestId));
    assert.equal((await request(other,window(),{'x-colliers-impersonate-user':other.id})).status,403);
    assert.equal((await request(other,window(),{Origin:'https://untrusted.invalid'})).status,403);
    assert.equal((await request(other,{...window(),from:new Date(Date.now()-32*86400000).toISOString()})).status,403);
  });
  await check('关键词分页允许首批零命中，继续查找不会漏掉后续原文；游标不能换条件或伪造',async()=>{
    const source=await person('viewer','audit-pages');
    for(let i=0;i<55;i++){
      const id=randomUUID(),requestId=randomUUID(),body=JSON.stringify({content:{version:'query-intake/1',entry:'query_submission',payload:{rawRequest:JSON.stringify({question:i===0?'后页唯一命中':'普通合成问题'+i})}},redactionTypes:[]});
      const res=await service.rpc('ai_query_record_intake',{p_event_id:id,p_request_id:requestId,p_actor:source.id,p_session:source.sessionId,p_reason:'request_received',p_bytes:100,p_complete:true,p_digest:'a'.repeat(64),p_digest_scope:'complete',p_effective:source.id,p_entry:'query_submission',p_content_digest:auditPayloadDigest(body,digestKey),p_cipher:encryptAuditContent(body,{requestId,eventId:id,actorId:source.id,effectiveUserId:source.id},keyId,encryptionKey)});assert.equal(res.error,null);
    }
    const filter={...window(),actorId:source.id,keyword:'后页唯一命中'},first=await request(other,filter);assert.equal(first.status,200);
    assert.equal(first.body.scanned,50);assert.equal(first.body.items.length,0);assert.equal(first.body.searchComplete,false);assert.ok(first.body.nextCursor);
    const last=await request(other,{...filter,cursor:first.body.nextCursor});assert.equal(last.status,200);assert.equal(last.body.scanned,5);assert.equal(last.body.items.length,1);assert.equal(last.body.searchComplete,true);assert.equal(last.body.totalMatches,null);
    assert.equal((await request(other,{...filter,cursor:first.body.nextCursor,keyword:'换条件'})).status,403);
    assert.equal((await request(other,{...filter,cursor:first.body.nextCursor+'x'})).status,403);
  });
  await check('读取后撤销审计资格不交付正文，查看凭据写入失败同样拒绝返回',async()=>{
    await db.query("create function private.revoke_console_on_read() returns trigger language plpgsql set search_path='' as $$begin if new.action='list' and new.outcome='allowed' then update private.ai_audit_read_grants set valid_until=clock_timestamp()-interval '1 second' where user_id=new.actor_id;end if;return new;end $$;create trigger revoke_console_on_read after insert on private.ai_audit_console_access for each row execute function private.revoke_console_on_read()");
    try{const r=await request(other,window());assert.equal(r.status,403);assert.deepEqual(r.body,{status:'denied'});}finally{await db.query('drop trigger revoke_console_on_read on private.ai_audit_console_access;drop function private.revoke_console_on_read()');await grant(other);}
    for(const phase of ['list','prepare']){
      await db.query(`create function private.console_access_fault() returns trigger language plpgsql set search_path='' as $$begin if new.action='${phase}' then raise exception 'synthetic access fault';end if;return new;end $$;create trigger console_access_fault before insert on private.ai_audit_console_access for each row execute function private.console_access_fault()`);
      try{const r=await request(other,window());assert.equal(r.status,503);assert.deepEqual(r.body,{status:'unavailable'});}finally{await db.query('drop trigger console_access_fault on private.ai_audit_console_access;drop function private.console_access_fault()');}
    }
  });
  await check('审计链或入口密文受损不冒称可信正文，真实注销和停用账号不能继续查看',async()=>{
    const source=await call(viewer);assert.equal(source.status,200);
    const prior=(await db.query('select event_id,event_hash from private.ai_query_audit_events where request_id=$1 order by sequence limit 1',[source.body.requestId])).rows[0];
    await db.query("update private.ai_query_audit_events set event_hash=repeat('0',64) where event_id=$1",[prior.event_id]);
    try{assert.equal((await request(other,{action:'stream',id:source.body.requestId})).status,503);}finally{await db.query('update private.ai_query_audit_events set event_hash=$2 where event_id=$1',[prior.event_id,prior.event_hash]);}
    const incoming=(await db.query('select event_id,cipher from private.ai_query_ingress_events where request_id=$1',[source.body.requestId])).rows[0];
    await db.query("update private.ai_query_ingress_events set cipher=jsonb_set(cipher,'{tag}',to_jsonb(repeat('0',32))) where event_id=$1",[incoming.event_id]);
    try{assert.equal((await request(other,{action:'intake',id:incoming.event_id})).status,503);}finally{await db.query('update private.ai_query_ingress_events set cipher=$2 where event_id=$1',[incoming.event_id,incoming.cipher]);}
    await db.query("update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=$1",[other.id]);
    try{assert.ok([401,403].includes((await request(other,window())).status));}finally{await db.query('update auth.users set banned_until=null where id=$1',[other.id]);}
    const temporary=await person('viewer','audit-session');await grant(temporary);assert.equal((await request(temporary,window())).status,200);
    await temporary.client.auth.signOut({scope:'local'});assert.ok([401,403].includes((await request(temporary,window())).status));
    assert.ok((await other.client.schema('private').from('ai_audit_console_access').select('*')).error);
  });
}
