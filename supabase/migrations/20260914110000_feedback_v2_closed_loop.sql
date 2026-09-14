begin;

alter table public.admin_issues
  add column if not exists last_activity_at timestamptz,
  add column if not exists last_admin_activity_at timestamptz,
  add column if not exists last_user_activity_at timestamptz;

alter table public.admin_issue_comments
  add column if not exists kind text not null default 'comment',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.admin_issue_comments'::regclass
      and conname = 'admin_issue_comments_kind_check'
  ) then
    alter table public.admin_issue_comments
      add constraint admin_issue_comments_kind_check
      check (kind in ('comment', 'status_change', 'system'));
  end if;
end
$$;

create table if not exists public.admin_issue_reads (
  issue_id uuid not null references public.admin_issues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);

alter table public.admin_issue_reads enable row level security;

create index if not exists admin_issue_reads_user_idx
  on public.admin_issue_reads (user_id, last_read_at desc);
create index if not exists admin_issues_last_activity_idx
  on public.admin_issues (last_activity_at desc);
create index if not exists admin_issues_last_user_activity_idx
  on public.admin_issues (last_user_activity_at desc)
  where source = 'user_feedback';

drop policy if exists "users manage own issue reads" on public.admin_issue_reads;
create policy "users manage own issue reads"
on public.admin_issue_reads
for all
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (
    (select private.is_admin())
    or exists (
      select 1
      from public.admin_issues issue
      where issue.id = admin_issue_reads.issue_id
        and issue.source = 'user_feedback'
        and lower(issue.created_by) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
    )
  )
);

update public.admin_issues issue
set
  last_user_activity_at = case
    when issue.source = 'user_feedback' then greatest(
      issue.created_at,
      coalesce((
        select max(c.created_at)
        from public.admin_issue_comments c
        where c.issue_id = issue.id and c.is_admin = false
      ), issue.created_at)
    )
    else coalesce((
      select max(c.created_at)
      from public.admin_issue_comments c
      where c.issue_id = issue.id and c.is_admin = false
    ), issue.last_user_activity_at)
  end,
  last_admin_activity_at = coalesce((
    select max(c.created_at)
    from public.admin_issue_comments c
    where c.issue_id = issue.id and c.is_admin = true
  ), issue.last_admin_activity_at),
  last_activity_at = greatest(
    issue.created_at,
    coalesce((select max(c.created_at) from public.admin_issue_comments c where c.issue_id = issue.id), issue.created_at),
    coalesce(issue.resolved_at, issue.created_at),
    coalesce(issue.reopened_at, issue.created_at)
  )
where issue.last_activity_at is null
   or issue.last_user_activity_at is null
   or issue.last_admin_activity_at is null;

alter table public.admin_issues
  alter column last_activity_at set default now();

create or replace function public.feedback_comment_touch_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.admin_issues
  set
    last_activity_at = new.created_at,
    last_admin_activity_at = case when new.is_admin then new.created_at else last_admin_activity_at end,
    last_user_activity_at = case when new.is_admin then last_user_activity_at else new.created_at end
  where id = new.issue_id;
  return new;
end;
$$;

drop trigger if exists admin_issue_comments_touch_activity on public.admin_issue_comments;
create trigger admin_issue_comments_touch_activity
after insert on public.admin_issue_comments
for each row execute function public.feedback_comment_touch_activity();

create or replace function public.feedback_prepare_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_email text := coalesce((select auth.jwt() ->> 'email'), 'system');
begin
  if new.status is distinct from old.status then
    if new.status = 'resolved' then
      new.resolved_at := coalesce(new.resolved_at, now());
      if coalesce(new.resolved_by, '') = '' then
        new.resolved_by := actor_email;
      end if;
    elsif old.status = 'resolved' then
      new.resolved_at := null;
      new.resolved_by := '';
      if new.status = 'open' then
        new.reopened_at := now();
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists admin_issues_prepare_status_change on public.admin_issues;
create trigger admin_issues_prepare_status_change
before update of status on public.admin_issues
for each row execute function public.feedback_prepare_status_change();

create or replace function public.feedback_record_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  actor_email text := coalesce((select auth.jwt() ->> 'email'), nullif(new.resolved_by, ''), 'system');
  actor_is_admin boolean := coalesce((select private.is_admin()), false);
begin
  if new.status is distinct from old.status then
    insert into public.admin_issue_comments (
      issue_id, content, images, created_by, is_admin, kind, metadata
    ) values (
      new.id,
      '',
      '{}'::text[],
      actor_email,
      actor_is_admin,
      'status_change',
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists admin_issues_record_status_change on public.admin_issues;
create trigger admin_issues_record_status_change
after update of status on public.admin_issues
for each row execute function public.feedback_record_status_change();

create or replace function public.feedback_mark_read(p_issue_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if not (
    (select private.is_admin())
    or exists (
      select 1 from public.admin_issues issue
      where issue.id = p_issue_id
        and issue.source = 'user_feedback'
        and lower(issue.created_by) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
    )
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.admin_issue_reads(issue_id, user_id, last_read_at)
  values (p_issue_id, (select auth.uid()), now())
  on conflict (issue_id, user_id)
  do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function public.feedback_admin_reply(
  p_issue_id uuid,
  p_content text,
  p_images text[] default '{}'::text[],
  p_next_status text default null
)
returns public.admin_issues
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  actor_email text := coalesce((select auth.jwt() ->> 'email'), 'admin');
  result public.admin_issues;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (select 1 from public.admin_issues where id = p_issue_id) then
    raise exception 'issue_not_found' using errcode = 'P0002';
  end if;

  if char_length(trim(coalesce(p_content, ''))) = 0
     and cardinality(coalesce(p_images, '{}'::text[])) = 0 then
    raise exception 'reply_required' using errcode = '22023';
  end if;

  if cardinality(coalesce(p_images, '{}'::text[])) > 3 then
    raise exception 'too_many_images' using errcode = '22023';
  end if;

  if p_next_status is not null
     and p_next_status not in ('open', 'in_progress', 'resolved', 'wontfix', 'duplicate') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  insert into public.admin_issue_comments(
    issue_id, content, images, created_by, is_admin, kind, metadata
  ) values (
    p_issue_id,
    trim(coalesce(p_content, '')),
    coalesce(p_images, '{}'::text[]),
    actor_email,
    true,
    'comment',
    '{}'::jsonb
  );

  if p_next_status is not null then
    update public.admin_issues
    set status = p_next_status
    where id = p_issue_id;
  end if;

  perform public.feedback_mark_read(p_issue_id);

  select * into result from public.admin_issues where id = p_issue_id;
  return result;
end;
$$;

create or replace function public.feedback_reopen(
  p_issue_id uuid,
  p_message text default ''
)
returns public.admin_issues
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  actor_email text := coalesce((select auth.jwt() ->> 'email'), '');
  result public.admin_issues;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.admin_issues issue
    where issue.id = p_issue_id
      and issue.source = 'user_feedback'
      and lower(issue.created_by) = lower(actor_email)
      and issue.status = 'resolved'
  ) then
    raise exception 'feedback_not_reopenable' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(p_message, ''))) > 0 then
    insert into public.admin_issue_comments(
      issue_id, content, images, created_by, is_admin, kind, metadata
    ) values (
      p_issue_id,
      trim(p_message),
      '{}'::text[],
      actor_email,
      false,
      'comment',
      '{}'::jsonb
    );
  end if;

  update public.admin_issues
  set status = 'open'
  where id = p_issue_id;

  perform public.feedback_mark_read(p_issue_id);

  select * into result from public.admin_issues where id = p_issue_id;
  return result;
end;
$$;

grant execute on function public.feedback_mark_read(uuid) to authenticated;
grant execute on function public.feedback_admin_reply(uuid, text, text[], text) to authenticated;
grant execute on function public.feedback_reopen(uuid, text) to authenticated;

commit;
