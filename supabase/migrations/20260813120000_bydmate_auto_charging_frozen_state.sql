-- Frozen-reading tracking for Mate-driven auto-stop of charging_sessions.
--
-- Di+ can keep echoing the last real charge_power_kw/SOC reading after a charge has
-- genuinely ended while the gun stays plugged in (car `way`, see BACKLOG.md "Live charge
-- power can get stuck on a stale nonzero charge_power_kw..."). These columns let the
-- ingest reducer remember the last charging sample's SOC/power and when they were first
-- seen unchanged, so a reading that never moves for long enough can be treated as stale
-- and trigger auto-stop instead of holding the session open indefinitely.

alter table public.bydmate_auto_charging_session_state
  add column if not exists frozen_soc numeric,
  add column if not exists frozen_charge_power_kw numeric,
  add column if not exists frozen_since_device_time timestamptz;

comment on column public.bydmate_auto_charging_session_state.frozen_soc is
  'SOC of the most recent charging sample, tracked to detect an unchanged (stale) reading.';
comment on column public.bydmate_auto_charging_session_state.frozen_charge_power_kw is
  'charge_power_kw of the most recent charging sample, tracked to detect an unchanged (stale) reading.';
comment on column public.bydmate_auto_charging_session_state.frozen_since_device_time is
  'Device time since frozen_soc/frozen_charge_power_kw last changed; used against
   AUTO_CHARGING_FROZEN_READING_STALE_MS to detect a Di+ reading stuck on a cached value.';
