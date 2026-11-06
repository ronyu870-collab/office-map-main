begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
alter table public.building_sales_materials
  add column original_location text not null default 'cloud' check (original_location in ('cloud','local_archive')),
  add column archive_reference text,
  alter column storage_path drop not null;
alter table public.building_sales_materials add constraint material_original_location_check check (
  (original_location='cloud' and storage_path is not null and archive_reference is null)
  or
  (original_location='local_archive' and storage_path is null and historical_context is not null
   and (archive_reference='sha256:'||source_sha256) is true
   and (extraction->'extraction'->>'historical_import_authorized'='true') is true)
);
comment on column public.building_sales_materials.archive_reference is '本地已核对原件的内容哈希引用；不包含本机路径，不表示云端已有原件。';
commit;
