-- The function remains SECURITY INVOKER and RLS-scoped, but an explicit legacy anon
-- execute ACL survived CREATE OR REPLACE. Keep the callable roles intentional.
revoke all on function public.bydmate_phantom_drain_daily(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.bydmate_phantom_drain_daily(uuid, text, timestamptz, timestamptz) to authenticated, service_role;
