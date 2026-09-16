create table if not exists public.lease_transaction_drafts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  user_name text not null default '',
  draft_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.lease_transaction_drafts enable row level security;

revoke all on table public.lease_transaction_drafts from anon;
grant select, insert, update, delete on table public.lease_transaction_drafts to authenticated;

drop policy if exists "users read own lease drafts" on public.lease_transaction_drafts;
create policy "users read own lease drafts"
on public.lease_transaction_drafts
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "users create own lease drafts" on public.lease_transaction_drafts;
create policy "users create own lease drafts"
on public.lease_transaction_drafts
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "users update own lease drafts" on public.lease_transaction_drafts;
create policy "users update own lease drafts"
on public.lease_transaction_drafts
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "users delete own lease drafts" on public.lease_transaction_drafts;
create policy "users delete own lease drafts"
on public.lease_transaction_drafts
for delete
to authenticated
using ((select auth.uid()) = user_id);

comment on table public.lease_transaction_drafts is 'Cloud drafts for the Lease Submission create workflow. One draft per authenticated user.';
