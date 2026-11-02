-- Immutable extraction versions for sources whose scope is wider than a mapped building.
-- This library is server-only; ready map material publication remains a separate operation.
create table public.project_material_library (
  id uuid primary key default gen_random_uuid(),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  original_name text not null check (char_length(original_name) between 1 and 255),
  archive_reference text not null,
  review_state text not null check (review_state in ('reviewed','needs_association','reference','excluded','recovered_partial')),
  batch_key text not null check (batch_key ~ '^[a-z][a-z0-9_-]{0,99}$'),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (source_sha256,payload_sha256),
  check (archive_reference = 'sha256:' || source_sha256),
  check (payload_sha256 = encode(sha256(convert_to(payload::text,'UTF8')),'hex')),
  check (jsonb_typeof(payload) = 'object'),
  check ((payload->>'source_sha256' = source_sha256) is true),
  check ((payload->'historical_context'->>'not_current' = 'true') is true),
  check ((jsonb_typeof(payload->'originals') = 'array' and jsonb_array_length(payload->'originals') between 1 and 100) is true),
  check ((jsonb_typeof(payload->'text_pages') = 'array' and jsonb_array_length(payload->'text_pages') <= 10000) is true),
  check ((jsonb_typeof(payload->'sections') = 'array' and jsonb_array_length(payload->'sections') <= 1000) is true),
  check ((jsonb_typeof(payload->'review') = 'object') is true),
  check (review_state <> 'excluded' or (jsonb_array_length(payload->'text_pages') = 0 and jsonb_array_length(payload->'sections') = 0))
);
create index project_material_library_batch_idx on public.project_material_library(batch_key,created_at,id);
alter table public.project_material_library enable row level security;
revoke all on public.project_material_library from public,anon,authenticated;
-- Append-only for the existing server identity; browsers receive no new grants.
grant select,insert on public.project_material_library to service_role;
comment on table public.project_material_library is 'Private extraction library. Historical source text is not a verified scalar fact. Unassociated sources do not create buildings or current inventory.';

create table public.project_material_library_pages (
  extraction_id uuid not null references public.project_material_library(id) on delete restrict,
  page_number integer not null check (page_number between 1 and 10000),
  content jsonb not null check (jsonb_typeof(content)='object'),
  content_sha256 text not null check (content_sha256 = encode(sha256(convert_to(content::text,'UTF8')),'hex')),
  primary key(extraction_id,page_number),
  check (((content->>'page')::integer = page_number) is true),
  check ((jsonb_typeof(content->'native_text')='string') is true),
  check ((jsonb_typeof(content->'ocr_layers')='array') is true),
  check (jsonb_array_length(jsonb_path_query_array(content, '$.ocr_layers[*] ? (@.verified == false && @.text.type() == "string")')) = jsonb_array_length(content->'ocr_layers'))
);
alter table public.project_material_library_pages enable row level security;
revoke all on public.project_material_library_pages from public,anon,authenticated;
grant select,insert on public.project_material_library_pages to service_role;
comment on table public.project_material_library_pages is 'Append-only native/OCR evidence by source page. OCR layers are never automatically published as verified facts.';
