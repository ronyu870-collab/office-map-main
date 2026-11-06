-- Owner-issued availability sheets: preserve original files, not inferred unit inventory.
begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
create table public.building_sales_materials (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  document_date date,
  source text not null check (char_length(btrim(source)) between 1 and 120),
  notes text not null default '' check (char_length(notes) <= 1000),
  original_name text not null check (char_length(original_name) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint.presentation.macroEnabled.12')),
  file_size integer not null check (file_size between 1 and 536870912),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  extraction_sha256 text not null check (extraction_sha256 ~ '^[a-f0-9]{64}$'),
  extraction jsonb not null check (jsonb_typeof(extraction) = 'object'),
  unique (building_id, source_sha256, extraction_sha256),
  series_key text not null default 'general' check (series_key ~ '^[a-z][a-z0-9_-]{0,79}$'),
  scope_label text not null default '房源资料' check (char_length(scope_label) between 1 and 100),
  content_types text[] not null default array['availability'] check (cardinality(content_types) between 1 and 3 and content_types <@ array['availability','commission','brochure']),
  data_date text,
  historical_context jsonb check (historical_context is null or ((jsonb_typeof(historical_context)='object' and (historical_context->>'not_current'='true') is true and length(btrim(historical_context->>'period_label'))>0 and length(btrim(historical_context->>'evidence'))>0) is true)),
  association_status text not null default 'confirmed' check (association_status in ('confirmed','unconfirmed')),
  association_note text not null default '' check (char_length(association_note) <= 500),
  commission_policies jsonb not null default '[]'::jsonb check (jsonb_typeof(commission_policies) = 'array' and jsonb_array_length(commission_policies) <= 40),
  project_facts jsonb not null default '[]'::jsonb check (jsonb_typeof(project_facts) = 'array' and jsonb_array_length(project_facts) <= 100),
  workbook_preview jsonb check (workbook_preview is null or jsonb_typeof(workbook_preview) = 'object'),
  details jsonb not null default '[]'::jsonb check (jsonb_typeof(details) = 'array' and jsonb_array_length(details) <= 200),
  status text not null default 'pending' check (status in ('pending', 'ready', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  check (storage_path = building_id::text || '/' || id::text || '/original.' ||
    case mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
      when 'image/webp' then 'webp' when 'application/pdf' then 'pdf'
      when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
      when 'application/vnd.openxmlformats-officedocument.presentationml.presentation' then 'pptx'
      when 'application/vnd.ms-powerpoint.presentation.macroEnabled.12' then 'pptm' end),
  check ((extraction->'extraction'->>'method' in ('codex-vision','codex-document')) is true),
  check ((extraction->'extraction'->>'reviewed' = 'true') is true),
  check ((extraction->'extraction'->>'source_sha256' = source_sha256) is true),
  check (status = 'pending' or (published_at is not null and (jsonb_array_length(details) + jsonb_array_length(commission_policies) + jsonb_array_length(project_facts)) > 0)),
  check (status <> 'archived' or archived_at is not null),
  check (historical_context is null or (jsonb_array_length(details)=0 and not ('availability'=any(content_types)))),
  check (status <> 'ready' or association_status='confirmed')
);
create index building_sales_materials_building_ready_idx
  on public.building_sales_materials (building_id, created_at desc, id desc)
  where status = 'ready';
create index building_sales_materials_series_idx on public.building_sales_materials(building_id,series_key,data_date desc,created_at desc);
create index building_sales_materials_created_by_idx on public.building_sales_materials(created_by);
create index building_sales_materials_archived_by_idx on public.building_sales_materials(archived_by);
alter table public.building_sales_materials enable row level security;
-- All metadata reads/writes go through the authenticated, scoped application API.
-- No client policy: signed URLs grant only short-lived access to a specific object.
revoke all on public.building_sales_materials from public, anon, authenticated;
grant select, insert, update, delete on public.building_sales_materials to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('building-sales-materials', 'building-sales-materials', false, 536870912,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint.presentation.macroEnabled.12']);
-- No storage.objects policies are added. The server signs an immutable upload path
-- and checks role, map building scope and material state before signing downloads.
comment on table public.building_sales_materials is '业主原始销控资料版本；不替代季度指标，也不自动推断实时可租单元。';
commit;
