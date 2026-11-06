-- Building photographs have separate provenance from owner sales/commission material.
-- Apply this migration before deploying the map photo catalog.
begin;

create table public.building_photos (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete restrict,
  image_url text not null check (length(image_url) <= 4096 and image_url ~ '^https://[^[:space:]]+$'),
  source_url text not null check (length(source_url) <= 4096 and source_url ~ '^https?://[^[:space:]]+$'),
  source_name text not null default '' check (length(source_name) <= 160),
  attribution_text text check (length(attribution_text) between 1 and 500),
  license_url text check (length(license_url) <= 4096 and license_url ~ '^https://[^[:space:]]+$'),
  caption text not null check (length(caption) between 1 and 160 and length(btrim(caption)) > 0),
  photo_kind text not null default 'exterior'
    check (photo_kind in ('exterior', 'interior', 'rendering', 'construction', 'other')),
  storage_path text,
  width integer check (width > 0),
  height integer check (height > 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  file_size bigint check (file_size > 0),
  status text not null default 'pending' check (status in ('pending', 'ready', 'archived')),
  sort_order integer not null default 0 check (sort_order >= 0),
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  notes text,
  constraint building_photos_source_unique unique (building_id, image_url),
  constraint building_photos_storage_ownership check (
    storage_path is null or storage_path ~ (
      '^building-photos/v1/' || building_id::text || '/' || id::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(jpg|jpeg|png|webp)$'
    )
  ),
  constraint building_photos_cloud_integrity check (
    storage_path is null or (sha256 is not null and file_size is not null and width is not null and height is not null)
  )
);

create index building_photos_ready_order_idx on public.building_photos (building_id, sort_order, id)
  where status = 'ready';

comment on table public.building_photos is '网络收集的楼宇图片及出处。与业主销控、佣金及楼书资料分开；仅服务端按地图权限读取。';
comment on column public.building_photos.image_url is '原始网络图片链接；有私有存储副本时保留该链接用于溯源。';
comment on column public.building_photos.source_url is '确认楼宇名称和图片关联的来源页面，不是搜索结果缩略图地址。';
comment on column public.building_photos.collected_at is '收集时间，不代表拍摄、竣工、出租或业主确认日期。';
comment on column public.building_photos.storage_path is '现有私有 bucket building-sales-materials 内 building-photos/v1/{building_id}/{photo_id}/{file}。';

alter table public.building_photos enable row level security;
revoke all on public.building_photos from public, anon, authenticated;
grant select, insert, update, delete on public.building_photos to service_role;
create policy "server manages building photos" on public.building_photos
  for all to service_role using (true) with check (true);

commit;
