begin;

create table private.ai_query_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  policy_version text not null check (length(policy_version) between 1 and 100),
  revision uuid not null default gen_random_uuid(),
  change_reference text not null check (length(change_reference) between 1 and 500)
);
insert into private.ai_query_control(singleton,enabled,policy_version,change_reference)
  values(true,false,'trusted-query/1','initial migration: disabled, no user grants');

create table private.ai_query_grants (
  user_id uuid primary key,
  enabled boolean not null default false,
  valid_until timestamptz not null,
  capabilities text[] not null default '{}' check (capabilities <@ array['query:catalog','query:brochure','query:quarter']),
  fields text[] not null default '{}' check (fields <@ array['height','floors','parking','totalArea','vacantArea','netEffectiveRent']),
  all_submarkets boolean not null default false,
  submarkets text[] not null default '{}',
  all_buildings boolean not null default false,
  building_ids uuid[] not null default '{}',
  revision uuid not null default gen_random_uuid(),
  change_reference text not null check (length(change_reference) between 1 and 500),
  check (array_position(capabilities,null) is null and array_position(fields,null) is null and array_position(submarkets,null) is null and array_position(building_ids,null) is null)
);
create table private.ai_query_policy_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  relation_name text not null,
  operation text not null,
  old_record jsonb,
  new_record jsonb,
  executor text not null,
  actor_kind text not null default 'unknown' check (actor_kind='unknown')
);
-- Maintenance session_user identifies the executor, not a verified human operator.
-- A future grant-management API must attach its separately verified actor audit.
create function private.ai_query_policy_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op<>'DELETE' then new.revision:=gen_random_uuid(); end if;
  insert into private.ai_query_policy_events(relation_name,operation,old_record,new_record,executor)
    values(tg_table_name,tg_op,case when tg_op='INSERT' then null else to_jsonb(old) end,
      case when tg_op='DELETE' then null else to_jsonb(new) end,session_user);
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger ai_query_control_changes before insert or update or delete on private.ai_query_control for each row execute function private.ai_query_policy_change();
create trigger ai_query_grant_changes before insert or update or delete on private.ai_query_grants for each row execute function private.ai_query_policy_change();
alter table private.ai_query_control enable row level security;
alter table private.ai_query_grants enable row level security;
alter table private.ai_query_policy_events enable row level security;
revoke all on private.ai_query_control,private.ai_query_grants,private.ai_query_policy_events from public,anon,authenticated,service_role;
revoke all on sequence private.ai_query_policy_events_id_seq from public,anon,authenticated,service_role;
revoke all on function private.ai_query_policy_change() from public,anon,authenticated,service_role;

create function private.ai_query_authority(p_actor uuid,p_effective uuid,p_session uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.ai_query_control; a private.ai_query_grants; e private.ai_query_grants; ar text; er text;
  caps text[]; fs text[]; markets text[]; buildings uuid[]; all_markets boolean; all_entities boolean; revision text;
begin
  select * into c from private.ai_query_control where singleton for share;
  if not found or not c.enabled then return jsonb_build_object('allowed',false); end if;
  -- Serialize account/role/session/grant revocation with this transaction's reads.
  perform 1 from auth.users u join public.user_roles r on r.user_id=u.id
    where u.id in (p_actor,p_effective) order by u.id for share of u,r;
  select r.role into ar from public.user_roles r join auth.users u on u.id=r.user_id
    where u.id=p_actor and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp());
  select r.role into er from public.user_roles r join auth.users u on u.id=r.user_id
    where u.id=p_effective and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp());
  if ar is null or er is null or ar not in ('viewer','editor','admin') or er not in ('viewer','editor','admin')
    or (p_actor<>p_effective and ar<>'admin') then return jsonb_build_object('allowed',false); end if;
  perform 1 from auth.sessions s where s.id=p_session and s.user_id=p_actor
    and (s.not_after is null or s.not_after>clock_timestamp()) for share;
  if not found then return jsonb_build_object('allowed',false); end if;
  perform 1 from private.ai_query_grants where user_id in (p_actor,p_effective) order by user_id for share;
  select * into a from private.ai_query_grants where user_id=p_actor and enabled and valid_until>clock_timestamp();
  select * into e from private.ai_query_grants where user_id=p_effective and enabled and valid_until>clock_timestamp();
  if a.user_id is null or e.user_id is null then return jsonb_build_object('allowed',false); end if;
  select coalesce(array_agg(v order by v),'{}') into caps from (select unnest(a.capabilities) v intersect select unnest(e.capabilities)) t;
  select coalesce(array_agg(v order by v),'{}') into fs from (select unnest(a.fields) v intersect select unnest(e.fields)) t;
  all_markets:=a.all_submarkets and e.all_submarkets;
  all_entities:=a.all_buildings and e.all_buildings;
  if a.all_submarkets then markets:=e.submarkets;
  elsif e.all_submarkets then markets:=a.submarkets;
  else select coalesce(array_agg(v order by v),'{}') into markets from (select unnest(a.submarkets) v intersect select unnest(e.submarkets)) t; end if;
  if a.all_buildings then buildings:=e.building_ids;
  elsif e.all_buildings then buildings:=a.building_ids;
  else select coalesce(array_agg(v order by v),'{}') into buildings from (select unnest(a.building_ids) v intersect select unnest(e.building_ids)) t; end if;
  if not ('query:catalog'=any(caps)) or (not all_markets and cardinality(markets)=0) or (not all_entities and cardinality(buildings)=0) then return jsonb_build_object('allowed',false); end if;
  revision:=encode(sha256(convert_to(jsonb_build_array(c.revision,a.revision,e.revision,ar,er)::text,'UTF8')),'hex');
  return jsonb_build_object('allowed',true,'actor_id',p_actor,'effective_user_id',p_effective,'session_id',p_session,
    'policy_version',c.policy_version,'permission_revision',revision,'capabilities',caps,'fields',fs,
    'all_submarkets',all_markets,'submarkets',markets,'all_buildings',all_entities,'building_ids',buildings);
end $$;

create function public.ai_query_authority(p_actor uuid,p_effective uuid,p_session uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.ai_query_authority(p_actor,p_effective,p_session) $$;
revoke all on function private.ai_query_authority(uuid,uuid,uuid), public.ai_query_authority(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant usage on schema private to service_role;
grant execute on function private.ai_query_authority(uuid,uuid,uuid), public.ai_query_authority(uuid,uuid,uuid) to service_role;
commit;
