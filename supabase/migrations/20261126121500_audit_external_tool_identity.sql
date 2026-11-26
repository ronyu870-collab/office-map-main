begin;
set local lock_timeout='5s';
set local statement_timeout='45s';

-- Only exact registered identifiers from privileged maintenance paths resolve as tools.
-- A label is attribution, not proof of an individual, login, authorization or outcome.
create or replace function private.snapshot_audit_actor() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  person_name text;
begin
  new.actor_kind := 'unknown';
  new.actor_name := null;
  new.actor_role := null;
  select coalesce(nullif(btrim(u.chinese_name),''),nullif(btrim(u.full_name),''),nullif(btrim(u.email),''))
     ,u.role into person_name,new.actor_role from public.user_roles u
    where u.user_id::text=new.user_id or lower(u.email)=lower(new.user_id)
    order by (u.user_id::text=new.user_id) desc limit 1;
  if found then
    new.actor_kind := 'user';
    new.actor_name := person_name;
  elsif new.user_id='codex' then
    new.actor_kind := 'tool';
    new.actor_name := 'Codex（工具执行）';
  elsif new.user_id='system' then
    new.actor_kind := 'system';
    new.actor_name := '系统任务';
  elsif auth.uid() is null and new.request_source in ('chatgpt_mcp','server') then
    case new.user_id
      when 'chatgpt' then new.actor_name := 'ChatGPT（工具执行）';
      when 'tool:chatgpt_submarket_research' then new.actor_name := 'ChatGPT（子市场研究）';
      when 'assistant:authorized-auto-publication' then new.actor_name := 'AI 助手（资料发布）';
      else null;
    end case;
    if new.actor_name is not null then new.actor_kind := 'tool'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.snapshot_audit_actor() from public,anon,authenticated;

-- Historical evidence was examined on 2026-11-26. Scope to the observed batches,
-- dates, action and target; do not bless arbitrary legacy frontend aliases.
-- Only derived identity classification changes; all original evidence stays intact.
update public.audit_logs a
set actor_kind='tool',
    actor_name=case a.user_id
      when 'chatgpt' then 'ChatGPT（工具执行）'
      when 'tool:chatgpt_submarket_research' then 'ChatGPT（子市场研究）'
      when 'assistant:authorized-auto-publication' then 'AI 助手（资料发布）'
    end
where a.actor_kind='unknown' and a.actor_name is null and a.actor_role is null
  and (
    (a.user_id='chatgpt' and a.request_source='chatgpt_mcp'
     and a.module='building_data_ai_enrichment' and a.target_table='building_brochure_data'
     and a.action_type='AI_FIELD_FILL'
     and a.created_at >= '2026-11-24 14:49:00+00' and a.created_at < '2026-11-24 15:09:00+00'
     and a.details->>'batch_id' in ('ai_brochure_submarket_20261124_100_v1','ai_technical_fields_20261124_v2'))
    or
    (a.user_id='chatgpt' and a.request_source='server' and a.target_table='building_photos'
     and a.module in ('map','building_photos')
     and a.action_type in ('BUILDING_PHOTO_IMPORT','BUILDING_PHOTO_STORAGE_BACKFILL','BUILDING_PHOTO_STORAGE_BACKFILL_RECEIPT','BUILDING_PHOTO_STORAGE_BACKFILL_BACKUP')
     and a.created_at >= '2026-11-06 07:40:00+00' and a.created_at < '2026-11-06 07:59:00+00'
     and a.details->>'batch_id'='20261106-chatgpt-external-links-b8')
    or
    (a.user_id='tool:chatgpt_submarket_research' and a.request_source='frontend'
     and a.module='map' and a.target_table='map_submarket_profiles' and a.action_type='ADMIN_DATA_OPERATION'
     and a.created_at >= '2026-11-19 06:07:00+00' and a.created_at < '2026-11-19 06:26:00+00'
     and a.details->>'operation' in ('ai_public_source_backfill','ai_source_asof_correction'))
    or
    (a.user_id='assistant:authorized-auto-publication' and a.request_source='frontend'
     and a.module='map' and a.target_table='map_submarket_profiles' and a.action_type='ADMIN_DATA_OPERATION'
     and a.created_at >= '2026-11-20 04:55:00+00' and a.created_at < '2026-11-20 04:56:00+00'
     and a.details->>'operation'='auto_publish_submarket_client_brief')
  );

commit;
