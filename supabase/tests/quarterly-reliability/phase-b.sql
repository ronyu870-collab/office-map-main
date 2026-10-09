begin;
select set_config('test.user_id', '11111111-1111-4111-8111-111111111111', true);
select set_config('test.is_admin', 'true', true);
do $$ declare rev bigint; begin
  assert (select quarter_configuration_frozen from private.quarterly_rollout_control where singleton);
  begin
    perform public.set_current_submission_period(2100, 2);
    raise exception 'legacy quarter setter not frozen';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.set_current_submission_period_v2(2100, 2);
    raise exception 'v2 quarter setter not frozen';
  exception when object_not_in_prerequisite_state then null;
  end;
  select revision into rev from public.update_drafts where tab = 'GradeA';
  perform public.save_quarterly_draft(auth.uid(), 'Legacy', 2100, 1, 'GradeA', '{"during_freeze":1}', rev);
  perform public.submit_quarterly_batch(auth.uid(), 'Legacy', 2100, 1, 'GradeA',
    '[{"building_id":"33333333-3333-4333-8333-333333333333","asking_rent":-1}]', '[]');
  assert exists(select 1 from public.quarterly_submissions where record_year = 2100 and asking_rent = -1),
    'phase B blocked ordinary legacy submission';
end $$;
rollback;
