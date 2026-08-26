-- Zero-power stall tracking for Mate-driven auto-stop of charging_sessions.
--
-- Di+ reports `is_charging` for as long as the charge gun is connected, not while energy
-- is actually flowing. When an AC charger stops with the gun left in the car, the ingest
-- reducer kept the session open and, once the existing frozen-reading check finally fired,
-- immediately opened a replacement — a loop of phantom 0 kWh sessions (car `way`,
-- 2026-08-26; see CHANGELOG.md).
--
-- The frozen-reading columns added in 20260813120000 cannot catch this on their own: they
-- require SOC *and* charge_power_kw to be bit-identical, and a parked car's SOC drifts
-- down (100 -> 99.9 -> 99.8) from standby draw, resetting that timer at every step. This
-- column tracks charge power alone, so SOC drift cannot defeat it.

alter table public.bydmate_auto_charging_session_state
  add column if not exists zero_power_since_device_time timestamptz;

comment on column public.bydmate_auto_charging_session_state.zero_power_since_device_time is
  'Device time since charge_power_kw was first seen at an explicit ~0 kW while a session
   was open; used against AUTO_CHARGING_ZERO_POWER_STALL_MS to close a session after the
   charger stops with the gun still plugged in. Null when real power is flowing, and also
   when no power reading is present at all (no measurement is not the same as zero).';
