-- Correct the autoservice_soc_percent column comments.
--
-- 20260708130000_add_autoservice_fid_fields.sql described this column as
-- "BMS-direct, more reliable than Di+". Measurement on 2026-08-26 showed the
-- opposite: autoservice FID_SOC is the *display* SOC — the whole-percent value the
-- instrument cluster shows — while Di+ 2.0 reports the raw BMS SOC at 0.1 %
-- resolution (its own /api/historyStatus calls it socPermille / socPrecise).
--
-- Evidence (car `way`, 1360 paired samples, SOC 13-100 %): the autoservice value is
-- always an integer, and relates to diplus_soc by an affine map,
--   display = 1.0280 x raw - 2.246   (usable window raw 2.18-99.46 %)
-- so it reads ~1.9 pp low at 10 % SOC and ~0.6 pp high at the top — it reports 100
-- while the pack is still balancing at raw 99.4. The coefficients differ per vehicle
-- (`yuan up`: 1.0178 x raw - 0.519), and two cars still on Di+ 1.x showed zero
-- divergence across 2703 samples because Di+ 1.x reported the display value itself.
--
-- Comments only. No data or schema change. Idempotent: safe to re-run.

comment on column public.bydmate_telemetry_samples.autoservice_soc_percent is
  'SOC from autoservice FID_SOC. This is the DISPLAY SOC (whole percent, what the '
  'instrument cluster shows) — a rescaled, clamped view of the raw BMS SOC, NOT the '
  'raw value. diplus_soc carries the raw BMS SOC on Di+ 2.0 (0.1 % resolution). The '
  'two differ by up to ~2 pp and must not be mixed in one series or differenced '
  'against each other; see telemetry->>''soc_source'' for which scale a sample used.';

comment on column public.bydmate_live_snapshots.autoservice_soc_percent is
  'SOC from autoservice FID_SOC. This is the DISPLAY SOC (whole percent, what the '
  'instrument cluster shows) — a rescaled, clamped view of the raw BMS SOC, NOT the '
  'raw value. diplus_soc carries the raw BMS SOC on Di+ 2.0 (0.1 % resolution). The '
  'two differ by up to ~2 pp and must not be mixed in one series or differenced '
  'against each other; see telemetry->>''soc_source'' for which scale a sample used.';
