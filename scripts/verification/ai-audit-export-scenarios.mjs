import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';

export async function verifyAuditExport({db,app,check,person,successful,blocker,until,stopApp,startApp,settings}) {
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
  await check('导出解码故障留下明确生成失败，恢复原始证据后新导出仍可用',async()=>{
    const original=(await db.query('select content_digest from private.ai_query_ingress_events where event_id=$1',[id])).rows[0].content_digest;
    const before=new Set((await db.query('select export_id from private.ai_audit_export_operations')).rows.map(x=>x.export_id));
    try{await db.query("update private.ai_query_ingress_events set content_digest=$2 where event_id=$1",[id,'b'.repeat(64)]);
      assert.equal((await request(who,body)).status,503);
      const rows=(await db.query('select export_id,state from private.ai_audit_export_operations')).rows.filter(x=>!before.has(x.export_id));assert.equal(rows.length,1);assert.equal(rows[0].state,'generation_failed');
    }finally{await db.query('update private.ai_query_ingress_events set content_digest=$2 where event_id=$1',[id,original]);}
    assert.equal((await request(who,body)).status,200);
  });
  await check('缺少生命周期协议的旧数据库不能交付文件；恢复最新协议后可用',async()=>{
    const old=await readFile(new URL('../../supabase/migrations/20261113132136_ai_audit_controlled_export.sql',import.meta.url),'utf8');
    const current=await readFile(new URL('../../supabase/migrations/20261113135841_ai_audit_export_reconciliation.sql',import.meta.url),'utf8');
    const oldBody=old.slice(old.indexOf('create function private.ai_audit_export_control('),old.indexOf('revoke all on function private.ai_audit_export_control')).replace('create function','create or replace function');
    try{await db.query(oldBody);const denied=await request(who,body);assert.equal(denied.status,503);assert.equal(denied.headers.get('content-disposition'),null);}
    finally{await db.query(current.slice(current.indexOf('create or replace function private.ai_audit_export_control('),current.lastIndexOf('commit;')));}
    assert.equal((await request(who,body)).status,200);
  });
  const reconcile=async()=>{
    const worker=spawn(process.execPath,['scripts/intelligence/reconcile-audit-exports.mjs'],{env:{...process.env,AI_EXPORT_RECONCILE_ALLOW_LOCAL:'disposable',AI_EXPORT_RECONCILE_URL:settings.API_URL,AI_EXPORT_RECONCILE_SECRET:settings.SERVICE_ROLE_KEY,AI_EXPORT_RECONCILE_WORKER:'auth-export-crash'},stdio:['ignore','pipe','pipe']});
    let out='';worker.stdout.on('data',x=>{out+=x;});assert.equal((await once(worker,'exit'))[0],0);return JSON.parse(out);
  };
  await check('失败补记也暂时不可写时保留待处理，独立恢复只标生成未确认',async()=>{
    const original=(await db.query('select content_digest from private.ai_query_ingress_events where event_id=$1',[id])).rows[0].content_digest;
    const before=new Set((await db.query('select export_id from private.ai_audit_export_operations')).rows.map(x=>x.export_id));let failedId;
    await db.query("create function private.fail_failure_note() returns trigger language plpgsql as $$begin if new.reason='generation_failed' then raise exception 'synthetic failure-note fault';end if;return new;end$$;create trigger fail_failure_note before insert on private.ai_audit_export_lifecycle for each row execute function private.fail_failure_note()");
    try{await db.query('update private.ai_query_ingress_events set content_digest=$2 where event_id=$1',[id,'b'.repeat(64)]);assert.equal((await request(who,body)).status,503);
      const row=(await db.query('select export_id,state from private.ai_audit_export_operations')).rows.find(x=>!before.has(x.export_id));assert.ok(row);failedId=row.export_id;assert.equal(row.state,'pending_generation');
    }finally{await db.query('update private.ai_query_ingress_events set content_digest=$2 where event_id=$1',[id,original]);await db.query('drop trigger fail_failure_note on private.ai_audit_export_lifecycle;drop function private.fail_failure_note()');}
    await db.query("update private.ai_audit_export_operations set due_at=case when export_id=$1 then clock_timestamp()-interval '1 second' else clock_timestamp()+interval '10 minutes' end where state in ('pending_generation','pending_report')",[failedId]);
    const fixed=await reconcile();assert.equal(fixed.reconciliation.outcomes.find(x=>x.exportId===failedId)?.state,'generation_unconfirmed');
  });
  await check('无客户端下载报告的已准备文件由独立CLI标交付未确认，迟到有效报告追加更正',async()=>{
    const f=await request(who,body);assert.equal(f.status,200);
    await db.query("update private.ai_audit_export_operations set due_at=case when export_id=$1 then clock_timestamp()-interval '1 second' else clock_timestamp()+interval '10 minutes' end where state in ('pending_generation','pending_report')",[f.body.exportId]);
    const repaired=await reconcile();assert.equal(repaired.reconciliation.outcomes.find(x=>x.exportId===f.body.exportId)?.state,'delivery_unconfirmed');
    assert.equal((await request(who,{action:'report',receiptToken:f.headers.get('x-audit-export-receipt')})).status,200);
    const states=(await db.query('select state from private.ai_audit_export_lifecycle where export_id=$1 order by occurred_at,event_id',[f.body.exportId])).rows.map(x=>x.state);
    assert.deepEqual(states,['pending_generation','pending_report','delivery_unconfirmed','client_dispatch_reported']);
  });
  await check('导出读取已持久化后Next真实SIGKILL，独立补记不重建文件且重启后新导出可用',async()=>{
    const before=new Set((await db.query('select export_id from private.ai_audit_export_operations')).rows.map(x=>x.export_id));
    await blocker.query('begin');await blocker.query('select pg_advisory_xact_lock(8172361)');
    await db.query("create function private.block_export_prepare() returns trigger language plpgsql as $$begin if new.phase='prepare' then perform pg_advisory_xact_lock(8172361);end if;return new;end$$;create trigger block_export_prepare before insert on private.ai_audit_export_events for each row execute function private.block_export_prepare()");
    let lostId;const pending=request(who,body).catch(()=>null);
    try{await until(async()=>{const rows=(await db.query("select export_id from private.ai_audit_export_operations where state='pending_generation'")).rows;lostId=rows.find(x=>!before.has(x.export_id))?.export_id;return Boolean(lostId);},'durable export read');
      await until(async()=>Boolean((await db.query("select 1 from pg_locks where locktype='advisory' and objid=8172361 and not granted")).rowCount),'blocked file preparation');
      await stopApp();
    }finally{await blocker.query('rollback');await db.query('drop trigger block_export_prepare on private.ai_audit_export_events;drop function private.block_export_prepare()');}
    assert.equal(await pending,null);
    const recorded=(await db.query('select state from private.ai_audit_export_operations where export_id=$1',[lostId])).rows[0].state;assert.ok(['pending_generation','pending_report'].includes(recorded));
    await db.query("update private.ai_audit_export_operations set due_at=case when export_id=$1 then clock_timestamp()-interval '1 second' else clock_timestamp()+interval '10 minutes' end where state in ('pending_generation','pending_report')",[lostId]);
    const fixed=await reconcile();assert.equal(fixed.reconciliation.outcomes.find(x=>x.exportId===lostId)?.state,recorded==='pending_report'?'delivery_unconfirmed':'generation_unconfirmed');
    assert.equal(fixed.reconciliation.replayed,false);assert.equal(fixed.overview.missing_operations,0);assert.equal(fixed.overview.missing_history,0);
    await startApp();assert.equal((await request(who,body)).status,200);
  });
  await check('真实注销后的旧JWT不能下载已有审计或上报旧文件回执',async()=>{
    await who.client.auth.signOut({scope:'local'});
    assert.ok([401,403].includes((await request(who,body)).status));
    assert.ok([401,403].includes((await request(who,{action:'report',receiptToken:file.headers.get('x-audit-export-receipt')})).status));
  });
}
