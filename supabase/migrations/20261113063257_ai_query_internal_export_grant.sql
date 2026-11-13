begin;
-- Independent internal-download permission. No accounts are granted permission
-- and no feature is enabled by this migration. Existing authority intersection,
-- revision triggers, expiry and session checks also apply to this capability.
alter table private.ai_query_grants drop constraint ai_query_grants_capabilities_check;
alter table private.ai_query_grants add constraint ai_query_grants_capabilities_check
  check (capabilities <@ array['query:catalog','query:brochure','query:quarter','export:internal']);
commit;
