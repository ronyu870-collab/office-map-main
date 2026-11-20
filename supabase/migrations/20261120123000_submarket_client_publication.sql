-- Client-facing submarket descriptions are an explicit editorial release.
-- Existing 16 research rows must NOT be silently promoted to approved material.
alter table public.map_submarket_profiles
  add column if not exists is_published boolean not null default false,
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid;

comment on column public.map_submarket_profiles.is_published is
  'True only after a real administrator explicitly verifies sources and releases the client-facing description; default false for all existing and new rows.';
comment on column public.map_submarket_profiles.published_at is
  'Time of last editorial approval; cleared when edited or retracted.';
comment on column public.map_submarket_profiles.published_by is
  'Authenticated administrator who confirmed public publication.';

-- Preserve the existing server-only authorization boundary; do not expose
-- draft commentary through anon/authenticated Data API grants.
alter table public.map_submarket_profiles enable row level security;
revoke all on table public.map_submarket_profiles from public, anon, authenticated;
grant select, insert, update on table public.map_submarket_profiles to service_role;
