begin;

create table backup_q3_20260928.donghu_q3_before_draft_recovery as
select *
from public.quarterly_submissions
where building_id='7c2c2afb-f684-4f7f-ab1d-1732e274445f'::uuid
  and record_year=2026
  and record_quarter=3;

insert into public.quarterly_submissions (
  building_id,user_id,user_name,record_year,record_quarter,
  total_area,vacant_area,vacancy_rate,asking_rent,management_fee,
  face_rent,rent_free_period,net_effective_rent,owner,property_management,notes
)
select
  '7c2c2afb-f684-4f7f-ab1d-1732e274445f'::uuid,
  d.user_id,
  d.user_name,
  2026,
  3,
  39742.38::numeric,
  nullif(d.draft_data->'7c2c2afb-f684-4f7f-ab1d-1732e274445f'->>'qVacArea','')::numeric,
  round(
    nullif(d.draft_data->'7c2c2afb-f684-4f7f-ab1d-1732e274445f'->>'qVacArea','')::numeric
    / 39742.38::numeric * 100, 2
  ),
  nullif(d.draft_data->'7c2c2afb-f684-4f7f-ab1d-1732e274445f'->>'qQuote','')::numeric,
  nullif(d.draft_data->'7c2c2afb-f684-4f7f-ab1d-1732e274445f'->>'qProp','')::numeric,
  nullif(d.draft_data->'7c2c2afb-f684-4f7f-ab1d-1732e274445f'->>'qFace','')::numeric,
  nullif(d.draft_data->'7c2c2afb-f684-4f7f-ab1d-1732e274445f'->>'qFree','')::numeric,
  round(
    nullif(d.draft_data->'7c2c2afb-f684-4f7f-ab1d-1732e274445f'->>'qFace','')::numeric
    * (36 - nullif(d.draft_data->'7c2c2afb-f684-4f7f-ab1d-1732e274445f'->>'qFree','')::numeric)
    / 36, 2
  ),
  nullif(d.draft_data->'7c2c2afb-f684-4f7f-ab1d-1732e274445f'->>'qOwner',''),
  nullif(d.draft_data->'7c2c2afb-f684-4f7f-ab1d-1732e274445f'->>'qPropMan',''),
  nullif(d.draft_data->'7c2c2afb-f684-4f7f-ab1d-1732e274445f'->>'qRemark','')
from public.update_drafts d
where d.user_id='3838c60a-5ec6-4151-b145-590b73bde54d'::uuid
  and d.tab='GradeA'
  and d.record_year=2026
  and d.record_quarter=3
  and d.updated_at='2026-09-17 02:07:25.093+00'::timestamptz
  and d.draft_data->'7c2c2afb-f684-4f7f-ab1d-1732e274445f'->>'qQuote'='270'
  and d.draft_data->'7c2c2afb-f684-4f7f-ab1d-1732e274445f'->>'qProp'='30'
  and d.draft_data->'7c2c2afb-f684-4f7f-ab1d-1732e274445f'->>'qFace'='140'
  and d.draft_data->'7c2c2afb-f684-4f7f-ab1d-1732e274445f'->>'qFree'='6'
  and d.draft_data->'7c2c2afb-f684-4f7f-ab1d-1732e274445f'->>'qVacArea'='3600'
  and not exists (
    select 1 from public.quarterly_submissions q
    where q.building_id='7c2c2afb-f684-4f7f-ab1d-1732e274445f'::uuid
      and q.record_year=2026 and q.record_quarter=3
      and q.asking_rent=270 and q.management_fee=30 and q.face_rent=140
      and q.rent_free_period=6 and q.vacant_area=3600
  );

commit;
