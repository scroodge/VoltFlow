-- The atomic charging cursor is server-only operational state.  The applied
-- progression migration revoked browser DML but pre-existing grants retained
-- SELECT/TRUNCATE and ancillary table privileges.  Keep every browser role out
-- of this table; the service-role RPCs are its only application consumer.
begin;

revoke all on public.bydmate_auto_charging_session_state from public, anon, authenticated;
grant all on public.bydmate_auto_charging_session_state to service_role;

commit;
