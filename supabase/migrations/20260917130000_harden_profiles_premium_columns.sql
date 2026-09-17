-- AUD-02 (BACKLOG.md, whole-project audit 2026-09-11): profiles.is_premium and
-- profiles.premium_until are writable by the owning authenticated user under the
-- ordinary own-row RLS policy (profiles_update_own / profiles_insert_own), with no
-- protective trigger. RLS is row-level only -- it does not restrict which columns an
-- UPDATE/INSERT may set -- so any authenticated user can self-grant Premium with a
-- raw REST PATCH/POST to their own profile row. is_user_premium(uuid,timestamptz) and
-- every server-side entitlement check (dashboard-entitlement.ts, retention-status,
-- admin_users_* RPCs) trust these two columns directly.
--
-- Verified live: pg_class.relacl on public.profiles grants anon and authenticated the
-- full `arwdDxtm` table-level ACL (Supabase's default bootstrap grant), and neither
-- column had an existing column-level ACL entry. A bare
-- `revoke update (is_premium) on profiles from authenticated` is a NO-OP in that
-- situation: Postgres only restricts a column when the table-level privilege for that
-- same action has ALSO been revoked -- a table-level grant is a superset that
-- authorizes every column regardless of any column-level revoke layered on top of it.
-- (Confirmed here: has_column_privilege('authenticated','profiles','is_premium','update')
-- still returned true after a first attempt using the column-only revoke.)
--
-- Fix: revoke the table-level INSERT/UPDATE grant entirely, then re-grant INSERT/UPDATE
-- to authenticated on an explicit column allowlist -- every existing profiles column
-- except is_premium and premium_until. This preserves every other current write path
-- byte-for-byte (tariffs, telegram linking, live_fast_* fast-mode trigger, API key
-- rotation, aux battery alerts, etc. -- enumerated from the live schema, 26 columns
-- total, 24 re-granted) while making the two entitlement columns writable only by
-- service_role (the admin premium editor and cron/inactivity paths already use the
-- service_role client, which bypasses grants and RLS entirely, so authorized premium
-- administration is unaffected). anon gets no INSERT/UPDATE grant on profiles at all
-- afterward -- RLS already made anon's prior table-level grant unreachable (auth.uid()
-- is null for anon, so profiles_update_own/profiles_insert_own can never match a row),
-- so this removes a dormant excess privilege rather than changing any real behavior.

revoke insert on public.profiles from anon, authenticated;
revoke update on public.profiles from anon, authenticated;

grant insert (
  id, email, created_at, preferred_currency, preferred_locale, default_price_per_kwh,
  bydmate_cloud_api_key, home_price_per_kwh, commercial_ac_price_per_kwh,
  fast_dc_price_per_kwh, vehicle_connected_at, telegram_id, telegram_username,
  notify_channel, timezone, last_active_at, inactivity_warning_sent_at,
  live_status_mode, live_fast_until, live_fast_vehicle_id, bydmate_cloud_api_key_hash,
  bydmate_cloud_api_key_fingerprint, preferred_pressure_unit, aux_battery_alerts_enabled
) on public.profiles to authenticated;

grant update (
  email, preferred_currency, preferred_locale, default_price_per_kwh,
  bydmate_cloud_api_key, home_price_per_kwh, commercial_ac_price_per_kwh,
  fast_dc_price_per_kwh, vehicle_connected_at, telegram_id, telegram_username,
  notify_channel, timezone, last_active_at, inactivity_warning_sent_at,
  live_status_mode, live_fast_until, live_fast_vehicle_id, bydmate_cloud_api_key_hash,
  bydmate_cloud_api_key_fingerprint, preferred_pressure_unit, aux_battery_alerts_enabled
) on public.profiles to authenticated;
