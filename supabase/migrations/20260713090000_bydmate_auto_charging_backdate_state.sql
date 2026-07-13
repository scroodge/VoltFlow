-- Backdating state for Mate-driven auto-start of charging_sessions.
--
-- Parked+charging telemetry arrives at ~1 sample/min (driving is ~1 Hz), so the
-- 4-consecutive-sample confirmation streak spans ~4 minutes of real charging. On a
-- fast DC charger that is ~10% SOC (~4.5 kWh) that never made it into the session.
-- These columns let the ingest reducer remember when the streak began, and what the
-- SOC was before the plug went in, so the session can be backdated to the real start.

alter table public.bydmate_auto_charging_session_state
  add column if not exists streak_start_percent numeric,
  add column if not exists streak_start_device_time timestamptz,
  add column if not exists last_idle_percent numeric,
  add column if not exists last_idle_device_time timestamptz;

comment on column public.bydmate_auto_charging_session_state.streak_start_percent is
  'SOC at the first charging sample of the current confirmation streak.';
comment on column public.bydmate_auto_charging_session_state.streak_start_device_time is
  'Device time of the first charging sample of the current confirmation streak.';
comment on column public.bydmate_auto_charging_session_state.last_idle_percent is
  'SOC at the most recent non-charging sample — the pre-plug-in reading.';
comment on column public.bydmate_auto_charging_session_state.last_idle_device_time is
  'Device time of the most recent non-charging sample.';
