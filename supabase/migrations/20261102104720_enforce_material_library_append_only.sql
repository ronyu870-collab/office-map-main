-- Supabase's public-schema default ACL grants service_role ALL, including
-- UPDATE/DELETE/TRUNCATE/MAINTAIN. An additive GRANT cannot narrow that ACL.
revoke all on public.project_material_library,public.project_material_library_pages from service_role;
grant select,insert on public.project_material_library,public.project_material_library_pages to service_role;
