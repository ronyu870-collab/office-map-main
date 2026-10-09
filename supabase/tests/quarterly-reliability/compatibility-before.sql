create table public.test_legacy_rpc_definitions as
select p.oid::regprocedure::text signature, pg_get_functiondef(p.oid) definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in
  ('save_quarterly_draft', 'submit_quarterly_batch', 'set_current_submission_period');
