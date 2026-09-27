-- The latest-quarterly view is read-only by design. Keep only SELECT for authenticated users
-- so Viewer cannot retain misleading table-level write privileges through this view.
revoke insert, update, delete, truncate, references, trigger
  on table public.view_latest_quarterly_submissions
  from authenticated;

grant select on table public.view_latest_quarterly_submissions to authenticated;
