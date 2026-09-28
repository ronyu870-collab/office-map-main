-- Correct Q3 submissions that were stored as Q2 while preserving original IDs and timestamps.
alter table public.quarterly_submissions disable trigger quarterly_submissions_set_updated_at;

update public.quarterly_submissions
set record_quarter = 3
where record_year = 2026
  and record_quarter = 2
  and created_at >= timestamptz '2026-09-01 00:00:00+08'
  and created_at <  timestamptz '2026-10-01 00:00:00+08';

alter table public.quarterly_submissions enable trigger quarterly_submissions_set_updated_at;

-- update_drafts is a rolling current-workspace table (one row per user/tab),
-- not a historical submission ledger. Move all current drafts to the active Q3 period.
update public.update_drafts
set record_year = 2026,
    record_quarter = 3
where record_year <> 2026
   or record_quarter <> 3;

-- Carry future-supply assignments forward to Q3 without removing Q2 history.
insert into public.future_supply_assignments
  (future_supply_id, user_id, user_name, record_year, record_quarter)
select
  a.future_supply_id, a.user_id, a.user_name, 2026, 3
from public.future_supply_assignments a
where a.record_year = 2026
  and a.record_quarter = 2
  and not exists (
    select 1
    from public.future_supply_assignments q3
    where q3.future_supply_id = a.future_supply_id
      and q3.user_id = a.user_id
      and q3.record_year = 2026
      and q3.record_quarter = 3
  );

-- Switch the live workspace only after data has been corrected.
update public.app_settings
set value = '2026',
    updated_at = now()
where key = 'current_submission_year';

update public.app_settings
set value = '3',
    updated_at = now()
where key = 'current_submission_quarter';
