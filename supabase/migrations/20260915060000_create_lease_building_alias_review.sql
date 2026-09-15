begin;

create table if not exists public.lease_building_alias_review (
  historical_name text primary key,
  historical_row_count integer not null check (historical_row_count > 0),
  observed_submarkets text[],
  observed_districts text[],
  resolution_status text not null default 'NEEDS_REVIEW'
    check (resolution_status in ('AUTO_VERIFIED','MANUAL_VERIFIED','NEEDS_REVIEW','NO_MATCH')),
  matched_building_id uuid references public.buildings(id) on delete restrict,
  matched_building_name text,
  resolution_basis text,
  confidence text not null default 'UNRESOLVED'
    check (confidence in ('ABSOLUTE','UNRESOLVED')),
  candidate_count integer not null default 0,
  candidate_snapshot jsonb not null default '[]'::jsonb,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists lease_building_alias_review_status_idx
  on public.lease_building_alias_review (resolution_status, historical_row_count desc);

create index if not exists lease_building_alias_review_building_idx
  on public.lease_building_alias_review (matched_building_id)
  where matched_building_id is not null;

alter table public.lease_building_alias_review enable row level security;
revoke all on public.lease_building_alias_review from public, anon, authenticated, service_role;
grant select, insert, update on public.lease_building_alias_review to service_role;

comment on table public.lease_building_alias_review is
  'Governed review queue for historical lease building aliases. AUTO_VERIFIED rows must come only from deterministic unique matching; unresolved aliases remain NEEDS_REVIEW and do not enter the canonical building map.';

commit;
