begin;

create table backup_q3_20260928.building_assignments_pre_gap_fill as
select * from public.building_assignments;

insert into public.building_assignments
  (building_id, project_name, user_id, user_name, grade, submarket)
values
  ('1f528d1b-d8af-46af-b300-1fcd598170e8'::uuid, '远洋乐堤港一座',
   '9eaee298-d96d-4aaa-b953-16908a6420d1', 'Ming Lu', 'A', '通州'),
  ('e7de91a8-a4dd-41ce-b393-ba75484f83e5'::uuid, '永丰-芯域一期（实创）',
   '0a996597-07ec-4c8c-80e1-c3258b3d30d0', 'Niko Guo', 'BP', '北清路'),
  ('a8a6d90d-5ea5-446b-b05c-61a8bba1bcc5'::uuid, '中关村科学城北区北京协同创新园项目6033地块',
   '0a996597-07ec-4c8c-80e1-c3258b3d30d0', 'Niko Guo', 'BP', '北清路'),
  ('5ad77999-541a-4ede-95b5-fcfd7f01bd4b'::uuid, '北京中建中心（富力C02)',
   '9eaee298-d96d-4aaa-b953-16908a6420d1', 'Ming Lu', 'A', '通州'),
  ('66896e9d-7e73-49f0-8d4e-22cdca6d43e3'::uuid, '嘉捷双子座',
   '53b7f1fd-3786-48c9-88f5-dc70d15ce404', 'Hannah Wang', 'BP', '亦庄')
on conflict do nothing;

commit;
