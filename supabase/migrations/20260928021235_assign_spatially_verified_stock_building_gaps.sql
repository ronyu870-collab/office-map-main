begin;

create table backup_q3_20260928.building_assignments_pre_spatial_gap_fill as
select * from public.building_assignments;

insert into public.building_assignments
  (building_id, project_name, user_id, user_name, grade, submarket)
values
  (
    '71f99700-1954-4b16-b853-4c255f9d6fb2'::uuid,
    '中固大厦',
    'e050ca07-b3d8-4ad6-b8c4-656b60ca286c',
    'Iris Liu',
    'A','中关村'
  ),
  (
    '221572e0-420e-4bd4-befd-3a3115e4d160'::uuid,
    '中关村通用人工智能创新园一期 - 人工智能创新应用先导区',
    '0a996597-07ec-4c8c-80e1-c3258b3d30d0',
    'Niko Guo',
    'BP','北清路'
  ),
  (
    '4bc20dfc-7391-45ce-97b4-3246919b32c9'::uuid,
    '环保园驭智项目',
    'c4a19f53-1271-48ba-8701-c6b85e6074f6',
    'Tony Yan',
    'BP','北清路'
  )
on conflict do nothing;

commit;
