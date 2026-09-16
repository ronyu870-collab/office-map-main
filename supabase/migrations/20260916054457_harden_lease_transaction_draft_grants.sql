revoke all privileges on table public.lease_transaction_drafts from authenticated;
grant select, insert, update, delete on table public.lease_transaction_drafts to authenticated;
revoke all privileges on table public.lease_transaction_drafts from anon;
