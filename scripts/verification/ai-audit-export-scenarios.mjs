import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';

export async function verifyAuditExport({db,app,check,person,successful}) {
  const request=async(who,body,headers={})=>{const r=await fetch(app+'/api/intelligence/audit/export',{method:'POST',headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+who.token}:{}),...headers},body:JSON.stringify(body)});const bytes=new Uint8Array(await r.arrayBuffer());return {status:r.status,headers:r.headers,bytes,body:JSON.parse(new TextDecoder().decode(bytes))};};
  const id=(await db.query("select event_id from private.ai_query_ingress_events where request_id=$1 and entry='query_submission' order by occurred_at limit 1",[successful.body.requestId])).rows[0].event_id;
  const targets=[{kind:'intake',id},{kind:'stream',id:successful.body.requestId}],body={action:'export',targets};
  const who=await person('admin','audit-exporter');
  const readGrant=()=>db.query("insert into private.ai_audit_read_grants(user_id,valid_until,grant_reference) values($1,now()+interval '1 day','synthetic exporter reader') on conflict(user_id) do update set valid_until=excluded.valid_until",[who.id]);
  const exportGrant=()=>db.query("insert into private.ai_audit_export_grants(user_id,enabled,valid_until,grant_reference) values($1,true,now()+interval '1 day','synthetic exporter') on conflict(user_id) do update set enabled=true,valid_until=excluded.valid_until",[who.id]);
  await readGrant();
  await check('审计查看资格不能自动导出，匿名/普通角色/模拟与跨源都不返回审计文件',async()=>{
    assert.equal((await request(who,body)).status,403);assert.equal((await request(null,body)).status,401);
    await exportGrant();assert.equal((await request(who,body,{'x-colliers-impersonate-user':who.id})).status,403);
    assert.equal((await request(who,body,{Origin:'https://foreign.invalid'})).status,403);
    await db.query("update public.user_roles set role='viewer' where user_id=$1",[who.id]);assert.equal((await request(who,body)).status,403);
    await db.query("update public.user_roles set role='admin' where user_id=$1",[who.id]);
  });
  let file;
  await check('完整批量JSON保留精确原文、原始账号、关联回答快照/来源/事件，导出字节与准备凭据一致',async()=>{
    file=await request(who,body,{Origin:app});assert.equal(file.status,200);assert.deepEqual(file.body.targets,targets);assert.equal(file.body.records.length,2);
    assert.equal(JSON.parse(file.body.records[0].intake.document.content.payload.rawRequest).question,'CBD最高的楼是什么？');
    assert.deepEqual(file.body.records[0].execution.generatedArchive,successful.body.result);assert.deepEqual(file.body.records[1].execution.generatedArchive,successful.body.result);
    assert.equal(file.body.records[1].intake,null);assert.equal(file.body.coverage,'selected_records_only');assert.equal(file.body.purpose,'internal_audit_only');
    assert.match(file.headers.get('content-disposition'),/^attachment; filename="ai-audit-[a-f0-9-]+\.json"$/);
    const digest=createHash('sha256').update(file.bytes).digest('hex');assert.equal(digest,file.headers.get('x-audit-export-sha256'));
    const row=(await db.query("select * from private.ai_audit_export_events where parent_id=$1 and phase='prepare'",[file.body.exportId])).rows[0];
    assert.equal(row.file_digest,digest);assert.equal(Number(row.file_bytes),file.bytes.length);assert.equal(row.outcome,'allowed');assert.deepEqual(row.targets,targets);
  });
  await check('浏览器发起下载回执校验签名、账号/会话、文件摘要并去重；不把软件事件说成磁盘保存',async()=>{
    const receiptToken=file.headers.get('x-audit-export-receipt');assert.ok(receiptToken);
    assert.equal((await request(who,{action:'report',receiptToken})).status,200);assert.equal((await request(who,{action:'report',receiptToken})).status,200);
    assert.equal((await request(who,{action:'report',receiptToken:receiptToken+'x'})).status,403);
    const different=await person('admin','export-other');assert.equal((await request(different,{action:'report',receiptToken})).status,403);
    const n=(await db.query("select count(*)::int n from private.ai_audit_export_events where phase='client_dispatch' and outcome='allowed' and actor_id=$1",[who.id])).rows[0].n;assert.equal(n,1);
    await db.query('update private.ai_audit_export_grants set enabled=false where user_id=$1',[who.id]);
    assert.equal((await request(who,{action:'report',receiptToken})).status,403);assert.equal((await request(who,body)).status,403);await exportGrant();
  });
  await check('重复/超限/恶意选择拒绝，缺失目标整份失败而不偷偷导出部分记录',async()=>{
    for(const targets of [[],[body.targets[0],body.targets[0]],Array.from({length:51},()=>({kind:'intake',id:randomUUID()})),[{kind:'../../raw',id}]])assert.equal((await request(who,{action:'export',targets})).status,403);
    const missing=await request(who,{action:'export',targets:[body.targets[0],{kind:'intake',id:randomUUID()}]});assert.equal(missing.status,503);assert.deepEqual(missing.body,{status:'unavailable'});assert.equal(missing.headers.get('content-disposition'),null);
  });
  await check('导出读取后撤销任一资格或记录准备凭据失败，均不交付文件',async()=>{
    for(const relation of ['ai_audit_read_grants','ai_audit_export_grants']){
      await db.query(`create function private.revoke_export_on_read() returns trigger language plpgsql set search_path='' as $$begin if new.phase='read' and new.outcome='allowed' then update private.${relation} set valid_until=clock_timestamp()-interval '1 second' where user_id=new.actor_id;end if;return new;end $$;create trigger revoke_export_on_read after insert on private.ai_audit_export_events for each row execute function private.revoke_export_on_read()`);
      try{const r=await request(who,body);assert.equal(r.status,403);assert.equal(r.headers.get('content-disposition'),null);}finally{await db.query('drop trigger revoke_export_on_read on private.ai_audit_export_events;drop function private.revoke_export_on_read()');await readGrant();await exportGrant();}
    }
    await db.query("create function private.export_prepare_fault() returns trigger language plpgsql set search_path='' as $$begin if new.phase='prepare' then raise exception 'synthetic prepare failure';end if;return new;end $$;create trigger export_prepare_fault before insert on private.ai_audit_export_events for each row execute function private.export_prepare_fault()");
    try{const r=await request(who,body);assert.equal(r.status,503);assert.equal(r.headers.get('content-disposition'),null);}finally{await db.query('drop trigger export_prepare_fault on private.ai_audit_export_events;drop function private.export_prepare_fault()');}
  });
  await check('真实注销后的旧JWT不能下载已有审计或上报旧文件回执',async()=>{
    await who.client.auth.signOut({scope:'local'});
    assert.ok([401,403].includes((await request(who,body)).status));
    assert.ok([401,403].includes((await request(who,{action:'report',receiptToken:file.headers.get('x-audit-export-receipt')})).status));
  });
}
