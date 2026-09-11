begin;

alter table public.admin_issues
  add column if not exists source text not null default 'admin',
  add column if not exists context jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.admin_issues'::regclass
      and conname = 'admin_issues_source_check'
  ) then
    alter table public.admin_issues
      add constraint admin_issues_source_check
      check (source in ('admin', 'user_feedback'));
  end if;
end
$$;

create index if not exists admin_issues_owner_created_idx
  on public.admin_issues (created_by, created_at desc)
  where source = 'user_feedback';

drop policy if exists "users read own feedback" on public.admin_issues;
create policy "users read own feedback"
on public.admin_issues for select
to authenticated
using (
  source = 'user_feedback'
  and lower(created_by) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
);

drop policy if exists "users create own feedback" on public.admin_issues;
create policy "users create own feedback"
on public.admin_issues for insert
to authenticated
with check (
  source = 'user_feedback'
  and lower(created_by) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  and status = 'open'
  and priority = 'medium'
  and resolved_at is null
  and coalesce(resolved_by, '') = ''
  and reopened_at is null
  and char_length(trim(title)) between 1 and 120
  and char_length(trim(coalesce(description, ''))) between 1 and 4000
  and cardinality(coalesce(images, '{}'::text[])) <= 3
);

drop policy if exists "users read comments on own feedback" on public.admin_issue_comments;
create policy "users read comments on own feedback"
on public.admin_issue_comments for select
to authenticated
using (
  exists (
    select 1
    from public.admin_issues issue
    where issue.id = admin_issue_comments.issue_id
      and issue.source = 'user_feedback'
      and lower(issue.created_by) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  )
);

drop policy if exists "users comment on own feedback" on public.admin_issue_comments;
create policy "users comment on own feedback"
on public.admin_issue_comments for insert
to authenticated
with check (
  lower(created_by) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  and is_admin = false
  and char_length(coalesce(content, '')) <= 2000
  and (
    char_length(trim(coalesce(content, ''))) > 0
    or cardinality(coalesce(images, '{}'::text[])) > 0
  )
  and cardinality(coalesce(images, '{}'::text[])) <= 3
  and exists (
    select 1
    from public.admin_issues issue
    where issue.id = admin_issue_comments.issue_id
      and issue.source = 'user_feedback'
      and lower(issue.created_by) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  )
);

drop policy if exists "users upload own feedback images" on storage.objects;
create policy "users upload own feedback images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'issue-images'
  and name like ('feedback/' || (select auth.uid())::text || '/%')
);

commit;
