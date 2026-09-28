create schema if not exists backup_q3_20260928;

create table backup_q3_20260928.app_settings as
select * from public.app_settings;

create table backup_q3_20260928.buildings as
select * from public.buildings;

create table backup_q3_20260928.building_assignments as
select * from public.building_assignments;

create table backup_q3_20260928.quarterly_submissions as
select * from public.quarterly_submissions;

create table backup_q3_20260928.update_drafts as
select * from public.update_drafts;

create table backup_q3_20260928.building_metrics as
select * from public.building_metrics;

create table backup_q3_20260928.future_supplies as
select * from public.future_supplies;

create table backup_q3_20260928.future_supply_assignments as
select * from public.future_supply_assignments;

create table backup_q3_20260928.future_supply_submissions as
select * from public.future_supply_submissions;

create table backup_q3_20260928.backup_manifest (
  created_at timestamptz not null default now(),
  production_project text not null,
  reason text not null
);

insert into backup_q3_20260928.backup_manifest(production_project, reason)
values (
  'qhgxougfzzmgqjzzwudf',
  'Pre-migration snapshot before correcting 2026 Q3 quarterly data stored under Q2'
);
