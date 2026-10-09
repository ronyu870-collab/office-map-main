begin;
select set_config('test.user_id', '11111111-1111-4111-8111-111111111111', true);
select set_config('test.is_admin', 'true', true);
do $$ declare result record; begin
  assert not (select quarter_configuration_frozen from private.quarterly_rollout_control where singleton);
  select * into result from public.set_current_submission_period(2100, 2);
  assert result.drafts_rolled = 0;
  assert exists(select 1 from public.update_drafts where record_year = 2100 and record_quarter = 1),
    'phase C rollover changed draft labels';
  begin
    perform public.submit_quarterly_batch(auth.uid(), 'Legacy', 2100, 2, 'GradeA',
      '[{"building_id":"33333333-3333-4333-8333-333333333333","asking_rent":-1}]', '[]');
    raise exception 'phase C legacy wrapper bypassed numeric guard';
  exception when invalid_parameter_value then null;
  end;
  update public.building_assignments set user_id = '22222222-2222-4222-8222-222222222222';
  begin
    perform public.submit_quarterly_batch(auth.uid(), 'Legacy', 2100, 2, 'GradeA',
      '[{"building_id":"33333333-3333-4333-8333-333333333333"}]', '[]');
    raise exception 'phase C legacy wrapper bypassed assignment guard';
  exception when insufficient_privilege then null;
  end;
  update public.building_assignments set user_id = auth.uid()::text;
  select * into result from public.submit_quarterly_batch(auth.uid(), 'Legacy', 2100, 2, 'GradeA',
    '[{"building_id":"33333333-3333-4333-8333-333333333333","asking_rent":0}]', '[]');
  assert result.regular_count = 1 and result.future_count = 0;
end $$;
rollback;
