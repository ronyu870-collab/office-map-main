begin;

create table backup_q3_20260928.future_supply_assignments_pre_q3_gap_fill as
select * from public.future_supply_assignments;

insert into public.future_supply_assignments
  (future_supply_id, user_id, user_name, record_year, record_quarter)
values
  (
    '2d8df90a-9f19-4fdb-a0d6-0d4c0fbbbba9'::uuid,
    '1ed03601-f298-4132-84ae-6222a997369b'::uuid,
    'Lily Liu',
    2026, 3
  ),
  (
    'c28c2c7d-2ae1-49b7-a8b2-dd000ee4c909'::uuid,
    'c291ce1a-fba0-42c5-9776-e41802422e12'::uuid,
    'Linda Yang',
    2026, 3
  )
on conflict (future_supply_id, user_id, record_year, record_quarter) do nothing;

commit;
