alter table public.future_supplies
  add constraint future_supplies_launch_quarter_valid
  check (
    launch_quarter is null
    or launch_quarter in ('Q1','Q2','Q3','Q4','H1','H2')
  ) not valid;
