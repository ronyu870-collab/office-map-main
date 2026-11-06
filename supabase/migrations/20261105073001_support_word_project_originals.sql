-- Allow private, downloadable Word originals on the existing project materials path.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '45s';

alter table public.building_sales_materials
  drop constraint building_sales_materials_mime_type_check,
  drop constraint building_sales_materials_check,
  add constraint building_sales_materials_mime_type_check check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  add constraint building_sales_materials_original_path_check check (
    storage_path is null or (
      storage_path = building_id::text || '/' || id::text || '/original.' ||
      case mime_type
        when 'image/jpeg' then 'jpg'
        when 'image/png' then 'png'
        when 'image/webp' then 'webp'
        when 'application/pdf' then 'pdf'
        when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
        when 'application/vnd.openxmlformats-officedocument.presentationml.presentation' then 'pptx'
        when 'application/vnd.ms-powerpoint.presentation.macroEnabled.12' then 'pptm'
        when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
      end
    ) is true
  );

update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
where id = 'building-sales-materials'
  and not ('application/vnd.openxmlformats-officedocument.wordprocessingml.document' = any(allowed_mime_types));

commit;
