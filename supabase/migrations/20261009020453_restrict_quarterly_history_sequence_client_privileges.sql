begin;
set local lock_timeout = '500ms';
set local statement_timeout = '2s';
-- History IDs are allocated by the postgres-owned SECURITY DEFINER archive trigger.
-- Client readers do not need direct sequence access.
revoke all privileges on sequence public.quarterly_draft_history_id_seq from public, anon, authenticated;
commit;
