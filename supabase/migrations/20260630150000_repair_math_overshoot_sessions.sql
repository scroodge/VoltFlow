-- Repair charging sessions poisoned by wall-clock-math overshoot.
--
-- Background (AGENTS.md §finish-detection 2026-06-30): when a session stayed open after
-- charging actually ended, deriveChargingState projected current_percent toward target at
-- the assumed charger rate, with no clamp to the real SOC. Observed: 77.9% persisted while
-- the BMS read 64%. Some of these rows also carry energy_overridden = true, which makes
-- reconcile skip them — so the wrong values are locked in.
--
-- Real SOC is always an integer percent; a fractional current_percent is the unmistakable
-- fingerprint of the math projection. Clearing energy_overridden on exactly those rows lets
-- the corrected reconcile (now SOC-clamped) repair them on next load. Genuine user/provider
-- overrides keep integer SOC and are untouched. Idempotent.

update public.charging_sessions
set energy_overridden = false
where energy_overridden = true
  and current_percent is not null
  and current_percent <> round(current_percent::numeric);
