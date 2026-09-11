begin;

alter table public.admin_issues
  add column if not exists source text not null default 'admin',
  add column if not exists context jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_issues_source_check'
      and conrelid = 'public.admin_issues'::regclass
  ) then
    alter table public.admin_issues
      add constraint admin_issues_source_check
      check (source in ('admin', 'user_feedback'));
  end if;
end
$$;

create index if not exists admin_issues_source_created_idx
  on public.admin_issues (source, created_at desc);
create index if not exists admin_issues_created_by_source_idx
  on public.admin_issues (created_by, source, created_at desc);

-- Ordinary authenticated users can create feedback as themselves and read only
-- their own user-feedback records. Admin access remains governed by the existing
-- admin-manage policy.
drop policy if exists "users read own feedback issues" on public.admin_issues;
create policy "users read own feedback issues"
on public.admin_issues for select
to authenticated
using (
  source = 'user_feedback'
  and created_by = (select auth.jwt() ->> 'email')
);

drop policy if exists "users create own feedback issues" on public.admin_issues;
create policy "users create own feedback issues"
on public.admin_issues for insert
to authenticated
with check (
  source = 'user_feedback'
  and created_by = (select auth.jwt() ->> 'email')
  and status = 'open'
  and priority = 'medium'
  and resolved_at is null
  and coalesce(resolved_by, '') = ''
);

-- Users can read the discussion attached to their own feedback and append
-- follow-up comments. They cannot mark a comment as an administrator comment,
-- edit comments, or delete comments.
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
      and issue.created_by = (select auth.jwt() ->> 'email')
  )
);

drop policy if exists "users comment on own feedback" on public.admin_issue_comments;
create policy "users comment on own feedback"
on public.admin_issue_comments for insert
to authenticated
with check (
  is_admin = false
  and created_by = (select auth.jwt() ->> 'email')
  and exists (
    select 1
    from public.admin_issues issue
    where issue.id = admin_issue_comments.issue_id
      and issue.source = 'user_feedback'
      and issue.created_by = (select auth.jwt() ->> 'email')
  )
);

-- The bucket is already public for reads. Ordinary users may only create files
-- below feedback/<their-auth-uid>/; admin image policies remain unchanged.
drop policy if exists "users upload own feedback images" on storage.objects;
create policy "users upload own feedback images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'issue-images'
  and (storage.foldername(name))[1] = 'feedback'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

commit;
