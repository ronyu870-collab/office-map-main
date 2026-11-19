-- Submarket business briefs are editorial material, separate from tracked building
-- inventory and quarterly observations. No rows are seeded with unverified facts.
-- Apply only through the authorized deployment/migration process, not during PR creation.
create table if not exists public.map_submarket_profiles (
  submarket text primary key,
  headline text not null default '',
  overview text not null default '',
  industries text not null default '',
  transport text not null default '',
  demographics jsonb not null default '[]'::jsonb,
  policies jsonb not null default '[]'::jsonb,
  insights jsonb not null default '[]'::jsonb,
  updated_by uuid null,
  updated_at timestamptz not null default now(),
  constraint map_submarket_profiles_name_check check (length(btrim(submarket)) between 1 and 100),
  constraint map_submarket_profiles_content_check check (
    length(headline) <= 160
    and length(overview) <= 2500
    and length(industries) <= 1600
    and length(transport) <= 1600
  ),
  constraint map_submarket_profiles_arrays_check check (
    jsonb_typeof(demographics) = 'array'
    and jsonb_typeof(policies) = 'array'
    and jsonb_typeof(insights) = 'array'
    and jsonb_array_length(demographics) <= 12
    and jsonb_array_length(policies) <= 20
    and jsonb_array_length(insights) <= 12
  )
);

alter table public.map_submarket_profiles enable row level security;
-- The Data API must not expose editable research commentary to the browser.
-- All reads/writes go through the existing server-side identity resolver.
revoke all on table public.map_submarket_profiles from public, anon, authenticated;
grant select, insert, update on table public.map_submarket_profiles to service_role;

comment on table public.map_submarket_profiles is
  'Colliers map submarket editorial briefs; source/date-bearing fact arrays, administrator-maintained. No machine-generated population or policies.';
comment on column public.map_submarket_profiles.demographics is
  'Array of facts with value, unit, geographic scope, data-as-of, https source';
comment on column public.map_submarket_profiles.policies is
  'Array of policies with issuer, applicability, date and original https source';
