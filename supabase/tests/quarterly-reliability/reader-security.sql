-- Preserve retained evidence while withdrawing access from stale account tokens.
begin;
select set_config('test.user_id', '11111111-1111-4111-8111-111111111111', true);
create temporary table retained_evidence_counts as
select (select count(*) from public.quarterly_draft_history) history_count,
       (select count(*) from public.quarterly_submission_provenance) provenance_count;
update public.user_roles set role = 'viewer' where user_id = auth.uid();
set role authenticated;
do $$ begin
  assert private.is_active_quarterly_reader(), 'active viewer rejected';
  assert (select count(*) > 0 from public.quarterly_draft_history), 'viewer cannot read own history';
  assert (select count(*) > 0 from public.quarterly_submission_provenance), 'viewer cannot read own provenance';
end $$;
reset role;
-- Removing the application role disables archive/provenance access immediately,
-- even though auth.uid() keeps returning the same simulated unexpired token ID.
delete from public.user_roles where user_id = auth.uid();
set role authenticated;
do $$ begin
  assert not private.is_active_quarterly_reader(), 'roleless account still active';
  assert (select count(*) = 0 from public.quarterly_draft_history), 'disabled account history leaked';
  assert (select count(*) = 0 from public.quarterly_submission_provenance), 'disabled account provenance leaked';
end $$;
reset role;
do $$ begin
  assert (select count(*) = (select history_count from retained_evidence_counts) from public.quarterly_draft_history), 'disablement removed history';
  assert (select count(*) = (select provenance_count from retained_evidence_counts) from public.quarterly_submission_provenance), 'disablement removed provenance';
end $$;
insert into public.user_roles(user_id, role) values (auth.uid(), 'viewer');
delete from auth.users where id = auth.uid();
set role authenticated;
do $$ begin
  assert auth.uid() is not null, 'stale-token test lost identity';
  assert not private.is_active_quarterly_reader(), 'deleted account still active';
  assert (select count(*) = 0 from public.quarterly_draft_history), 'deleted account history leaked';
  assert (select count(*) = 0 from public.quarterly_submission_provenance), 'deleted account provenance leaked';
end $$;
reset role;
do $$ begin
  -- Account cascade deletion can append draft DELETE snapshots, never remove history.
  assert (select count(*) >= (select history_count from retained_evidence_counts) from public.quarterly_draft_history), 'account deletion removed history';
  assert (select count(*) = (select provenance_count from retained_evidence_counts) from public.quarterly_submission_provenance), 'account deletion removed provenance';
  assert not has_function_privilege('anon', 'private.is_active_quarterly_reader()', 'EXECUTE'), 'anonymous reader helper exposed';
end $$;
select set_config('test.user_id', '22222222-2222-4222-8222-222222222222', true);
set role authenticated;
do $$ begin
  assert private.is_active_quarterly_reader(), 'other valid owner not active';
  assert (select count(*) = 0 from public.quarterly_draft_history), 'cross-owner retained history leaked';
  assert (select count(*) = 0 from public.quarterly_submission_provenance), 'cross-owner retained provenance leaked';
end $$;
reset role;
rollback;
