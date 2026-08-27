begin;

create table if not exists public.system_settings (
  key text primary key,
  boolean_value boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.system_settings (key, boolean_value)
values ('editor_can_view_lease_team_submissions', true)
on conflict (key) do nothing;

alter table public.system_settings enable row level security;
revoke all on public.system_settings from anon, authenticated;
grant select on public.system_settings to authenticated;

drop policy if exists "authenticated read lease team access setting" on public.system_settings;
create policy "authenticated read lease team access setting"
on public.system_settings for select
to authenticated
using (key = 'editor_can_view_lease_team_submissions');

-- Administrators can always read the whole table. Editors can read it only while
-- the global team-summary switch is open; every authenticated user keeps access
-- to their own submissions.
drop policy if exists "authenticated users read lease transactions" on public.lease_transactions;
drop policy if exists "editors and admins read lease transactions" on public.lease_transactions;
drop policy if exists "role scoped read lease transactions" on public.lease_transactions;
create policy "role scoped read lease transactions"
on public.lease_transactions for select
to authenticated
using (
  submitter_id = (select auth.uid())::text
  or exists (
    select 1
    from public.user_roles r
    where r.user_id = (select auth.uid())
      and r.role = 'admin'
  )
  or (
    exists (
      select 1
      from public.user_roles r
      where r.user_id = (select auth.uid())
        and r.role = 'editor'
    )
    and exists (
      select 1
      from public.system_settings s
      where s.key = 'editor_can_view_lease_team_submissions'
        and s.boolean_value = true
    )
  )
);

commit;
