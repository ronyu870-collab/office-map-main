begin;

-- Team live-transaction visibility is a fixed role contract:
-- Viewer and Editor have identical read scope; Viewer differs only on writes.
drop policy if exists "role scoped read lease transactions" on public.lease_transactions;
create policy "role scoped read lease transactions"
on public.lease_transactions
for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles r
    where r.user_id = (select auth.uid())
      and r.role in ('viewer', 'editor', 'admin')
  )
);

-- The legacy global switch is obsolete. Removing the table prevents future
-- configuration drift from hiding team transactions from Viewer/Editor.
drop table if exists public.system_settings;

commit;
