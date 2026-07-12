-- Replace the guessed 0.12/kWh column default with a neutral placeholder (1).
-- 0.12 quietly implied a real, currency-calibrated electricity rate, which is
-- wrong for most currencies/countries and misled users who never touched the
-- field. New users are now asked for their home price during car creation
-- (optional); this only changes what a *skipped* answer defaults to for rows
-- inserted from now on. Existing profiles are untouched (SET DEFAULT does not
-- rewrite existing rows).

alter table public.profiles
  alter column default_price_per_kwh set default 1,
  alter column home_price_per_kwh set default 1,
  alter column commercial_ac_price_per_kwh set default 1,
  alter column fast_dc_price_per_kwh set default 1;
