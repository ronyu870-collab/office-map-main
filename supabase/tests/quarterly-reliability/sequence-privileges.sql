-- Isolated regression harness only. No production connection or business writes.
do $test$
declare
  client_role text;
  sequence_owner oid;
  archive_owner oid;
  archive_definer boolean;
begin
  foreach client_role in array array['anon', 'authenticated'] loop
    assert not has_sequence_privilege(client_role, 'public.quarterly_draft_history_id_seq', 'SELECT'), client_role || ' can read history sequence';
    assert not has_sequence_privilege(client_role, 'public.quarterly_draft_history_id_seq', 'USAGE'), client_role || ' can advance history sequence';
    assert not has_sequence_privilege(client_role, 'public.quarterly_draft_history_id_seq', 'UPDATE'), client_role || ' can reset history sequence';
  end loop;
  select relowner into sequence_owner from pg_class where oid = 'public.quarterly_draft_history_id_seq'::regclass;
  select proowner, prosecdef into archive_owner, archive_definer from pg_proc where oid = 'private.archive_quarterly_draft()'::regprocedure;
  assert archive_definer, 'archive must retain SECURITY DEFINER';
  assert archive_owner = sequence_owner, 'archive and sequence owners diverged';
  assert has_sequence_privilege(archive_owner, 'public.quarterly_draft_history_id_seq', 'USAGE'), 'archive owner cannot allocate history IDs';
  assert has_sequence_privilege('service_role', 'public.quarterly_draft_history_id_seq', 'SELECT')
     and has_sequence_privilege('service_role', 'public.quarterly_draft_history_id_seq', 'USAGE')
     and has_sequence_privilege('service_role', 'public.quarterly_draft_history_id_seq', 'UPDATE'), 'service-role sequence privileges were lost';
  assert has_table_privilege('authenticated', 'public.quarterly_draft_history', 'SELECT'), 'owner-history table read grant was lost';
end;
$test$;
