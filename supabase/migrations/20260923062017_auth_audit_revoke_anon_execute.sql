revoke execute on function public.admin_get_auth_audit_logs(integer, integer, timestamp with time zone, uuid, text, boolean) from anon, public;
grant execute on function public.admin_get_auth_audit_logs(integer, integer, timestamp with time zone, uuid, text, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
