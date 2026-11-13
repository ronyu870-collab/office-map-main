-- Additive market communication upgrade. Existing content remains plain text.
alter table public.messages
  add column if not exists rich_segments jsonb,
  add column if not exists reply_to_id bigint references public.messages(id) on delete set null,
  add column if not exists mention_everyone boolean not null default false;
create index if not exists messages_reply_to_id_idx on public.messages(reply_to_id) where reply_to_id is not null;

create table if not exists public.message_notifications (
  message_id bigint not null references public.messages(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (message_id, recipient_user_id)
);
create index if not exists message_notifications_unread_idx
  on public.message_notifications(recipient_user_id, created_at desc)
  where read_at is null;
alter table public.message_notifications enable row level security;
create policy "read own communication mentions" on public.message_notifications
  for select to authenticated using (recipient_user_id = (select auth.uid()));
create policy "acknowledge own communication mentions" on public.message_notifications
  for update to authenticated
  using (recipient_user_id = (select auth.uid()))
  with check (recipient_user_id = (select auth.uid()));
revoke all on public.message_notifications from public, anon, authenticated;
grant select on public.message_notifications to authenticated;
grant update(read_at) on public.message_notifications to authenticated;
grant all on public.message_notifications to service_role;

-- Legacy clients can still insert their own plain text, but cannot forge
-- structured @all messages or reply metadata through the browser Data API.
revoke insert on public.messages from authenticated;
grant insert(user_email, user_name, content) on public.messages to authenticated;

-- Atomic send, recipient verification, alerts and audit. The only caller is
-- the authenticated server route holding service_role; not browser identities.
-- Hosted service_role has BYPASSRLS but NO SELECT on auth.users. This function
-- runs as its migration owner (postgres) to verify active auth identities,
-- while EXECUTE remains exclusively granted to service_role. Never grant
-- service_role broad auth.users privileges or expose this definer to clients.
create or replace function public.post_market_message(
  p_actor_user_id uuid,
  p_segments jsonb,
  p_reply_to_id bigint default null
) returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_content text;
  v_count integer;
  v_broadcast boolean;
  v_email text;
  v_name text;
  v_role text;
  v_message_id bigint;
  v_requested_count integer;
  v_valid_count integer;
  v_notification_count integer;
begin
  if jsonb_typeof(p_segments) is distinct from 'array' then
    raise exception 'Invalid message segments' using errcode='22023';
  end if;
  select count(*)::integer,
         string_agg(s.part->>'text', '' order by s.ord),
         coalesce(bool_or((s.part->>'everyone')='true'), false)
    into v_count, v_content, v_broadcast
    from jsonb_array_elements(p_segments) with ordinality as s(part,ord);
  if v_count < 1 or v_count > 100
     or char_length(trim(coalesce(v_content,''))) < 1
     or char_length(v_content) > 2000 then
    raise exception 'Message must contain 1-2000 characters and at most 100 segments' using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_segments) as s(part)
    where jsonb_typeof(s.part) <> 'object'
       or jsonb_typeof(s.part->'text') is distinct from 'string'
       or char_length(s.part->>'text') < 1
       or (s.part ? 'bold' and jsonb_typeof(s.part->'bold') <> 'boolean')
       or (s.part ? 'color' and (jsonb_typeof(s.part->'color') <> 'string'
            or s.part->>'color' not in ('blue','red','green')))
       or (s.part ? 'mentionUserId' and (
            jsonb_typeof(s.part->'mentionUserId') <> 'string'
            or s.part->>'mentionUserId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            or left(s.part->>'text',1) <> '@'
       ))
       or (s.part ? 'everyone' and (
            s.part->'everyone' <> 'true'::jsonb
            or s.part->>'text' <> '@所有人'
       ))
       or ((s.part ? 'everyone') and (s.part ? 'mentionUserId'))
       or (select count(*) from jsonb_object_keys(s.part) as k(key)
           where k.key not in ('text','bold','color','mentionUserId','everyone')) > 0
  ) then
    raise exception 'Unsupported message formatting' using errcode='22023';
  end if;

  select u.email, coalesce(nullif(trim(r.chinese_name),''),
                            nullif(trim(r.full_name),''), u.email),
         r.role
    into v_email,v_name,v_role
    from auth.users u
    join public.user_roles r on r.user_id = u.id
    where u.id = p_actor_user_id
      and (u.banned_until is null or u.banned_until <= now())
      and r.role in ('viewer','editor','admin');
  if v_email is null then
    raise exception 'Inactive sender' using errcode='42501';
  end if;
  if v_broadcast and v_role <> 'admin' then
    raise exception 'Only an administrator can mention everyone' using errcode='42501';
  end if;
  if p_reply_to_id is not null and not exists (
    select 1 from public.messages where id=p_reply_to_id and is_hidden=false
  ) then
    raise exception 'Reply target unavailable' using errcode='22023';
  end if;

  with requested as (
    select distinct (s.part->>'mentionUserId')::uuid as id
      from jsonb_array_elements(p_segments) as s(part)
      where s.part ? 'mentionUserId'
  )
  select (select count(*)::integer from requested),
         (select count(*)::integer from requested q
          join public.user_roles r on r.user_id=q.id
          join auth.users u on u.id=q.id
          where r.role in ('viewer','editor','admin')
            and (u.banned_until is null or u.banned_until <= now()))
    into v_requested_count,v_valid_count;
  if v_requested_count <> v_valid_count then
    raise exception 'Mentioned member is unavailable' using errcode='22023';
  end if;
  if v_broadcast then
    perform pg_advisory_xact_lock(72248113);
    if exists (
      select 1 from public.messages
      where mention_everyone and created_at > now() - interval '10 minutes'
    ) then
      raise exception 'Everyone was already mentioned recently' using errcode='22023';
    end if;
  end if;

  insert into public.messages(user_email,user_name,content,rich_segments,reply_to_id,mention_everyone)
    values (v_email,v_name,v_content,p_segments,p_reply_to_id,v_broadcast)
    returning id into v_message_id;

  insert into public.message_notifications(message_id,recipient_user_id)
  select v_message_id, r.user_id
  from public.user_roles r
  join auth.users u on u.id=r.user_id
  where r.role in ('viewer','editor','admin')
    and (u.banned_until is null or u.banned_until <= now())
    and r.user_id <> p_actor_user_id
    and (v_broadcast or r.user_id in (
      select (s.part->>'mentionUserId')::uuid
      from jsonb_array_elements(p_segments) as s(part)
      where s.part ? 'mentionUserId'
    ))
  on conflict do nothing;
  get diagnostics v_notification_count = row_count;

  insert into public.audit_logs(user_id,action_type,details,request_source,module,target_table,target_id)
    values(p_actor_user_id::text,'POST_MESSAGE',
      jsonb_build_object('message_id',v_message_id,'reply_to_id',p_reply_to_id,
                         'mention_count',v_notification_count,'mention_everyone',v_broadcast),
      'server','home','messages',v_message_id::text);
  return v_message_id;
end;
$$;
revoke all on function public.post_market_message(uuid,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.post_market_message(uuid,jsonb,bigint) to service_role;
