begin;

update public.future_supplies
set launch_quarter = null
where id = 'b98562e0-67f3-442d-8ccb-eef9a0532612'::uuid
  and launch_quarter = 'Q6';

alter table public.future_supplies
  validate constraint future_supplies_launch_quarter_valid;

create index if not exists quarterly_submissions_building_idx
  on public.quarterly_submissions (building_id);

create index if not exists future_supply_submissions_future_supply_idx
  on public.future_supply_submissions (future_supply_id);

create index if not exists future_supply_submissions_user_idx
  on public.future_supply_submissions (user_id);

commit;
