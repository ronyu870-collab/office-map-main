begin;
revoke all on public.lease_building_record_map from service_role;
grant select,insert,update on public.lease_building_record_map to service_role;
revoke all on public.lease_building_record_map from anon,authenticated;
commit;
