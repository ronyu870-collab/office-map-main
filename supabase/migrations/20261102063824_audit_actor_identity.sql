begin;

alter table public.audit_logs
  add column actor_kind text check (actor_kind in ('user','tool','system','unknown')),
  add column actor_name text;

create schema if not exists private;
-- Internal trigger must read the protected user directory regardless of caller RLS.
-- Supplied actor fields are always overwritten; they are not client assertions.
create function private.snapshot_audit_actor() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  person_name text;
begin
  new.actor_kind := 'unknown';
  new.actor_name := null;
  select coalesce(nullif(btrim(u.chinese_name),''),nullif(btrim(u.full_name),''),nullif(btrim(u.email),''))
    into person_name from public.user_roles u
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
  end if;
  return new;
end;
$$;
revoke all on function private.snapshot_audit_actor() from public,anon,authenticated;
create trigger audit_logs_snapshot_actor before insert on public.audit_logs
for each row execute function private.snapshot_audit_actor();

-- Classify existing rows using the same resolver. Do not change identity, dates,
-- actions, evidence or business rows. Historical names remain current-directory
-- lookups; only identities unambiguously known as tools/system are backfilled.
update public.audit_logs set actor_kind='tool',actor_name='Codex（工具执行）' where user_id='codex';
update public.audit_logs set actor_kind='system',actor_name='系统任务' where user_id='system';
update public.audit_logs a set actor_kind='unknown'
where a.actor_kind is null and not exists (
  select 1 from public.user_roles u where u.user_id::text=a.user_id or lower(u.email)=lower(a.user_id)
);

comment on column public.audit_logs.actor_name is 'Database-resolved identity at insertion; historical tools/system classified without changing raw user_id.';
comment on column public.audit_logs.actor_kind is 'user, tool, system or unknown; never infer a person from a tool label.';
commit;
