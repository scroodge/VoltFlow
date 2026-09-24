-- Close the same privilege gap documented in AGENTS.md's "Hard-won rules > Migrations":
-- Supabase grants EXECUTE on every new public function to anon/authenticated EXPLICITLY,
-- so the prior migration's `revoke all ... from public` (20260924100000) did not remove it.
-- Verified right after applying that migration: bydmate_dispatch_telemetry_cadence_digest
-- was executable by anon and authenticated. It is SECURITY DEFINER and reads/updates the
-- cadence-alarm audit table and admin_users/profiles, so this closes the exposure fast.
--
-- Idempotent because this self-hosted deployment has no migration-history table.

revoke execute on function public.bydmate_dispatch_telemetry_cadence_digest() from anon, authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.bydmate_dispatch_telemetry_cadence_digest()', 'execute') then
    raise exception 'anon still has execute on bydmate_dispatch_telemetry_cadence_digest';
  end if;
  if has_function_privilege('authenticated', 'public.bydmate_dispatch_telemetry_cadence_digest()', 'execute') then
    raise exception 'authenticated still has execute on bydmate_dispatch_telemetry_cadence_digest';
  end if;
end;
$$;
