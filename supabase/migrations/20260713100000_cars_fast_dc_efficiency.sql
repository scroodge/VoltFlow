-- Per-tariff charging efficiency.
--
-- Charging losses are not one number per car: AC measured ~98% on car `way` (SOC ×
-- capacity 2.706 kWh vs 2.760 kWh grid truth), while fast DC measured ~91% (16.7 kWh
-- absorbed vs 18.40 kWh metered by the provider, 2026-07-13). A DC dispenser meters
-- upstream of the cable, its own cooling, and the high-C-rate heat the pack sheds.
--
-- `default_efficiency_percent` keeps its meaning as the AC figure; fast-DC sessions read
-- this new column instead.

alter table public.cars
  add column if not exists fast_dc_efficiency_percent numeric not null default 90;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cars_fast_dc_efficiency_percent_check'
  ) then
    alter table public.cars
      add constraint cars_fast_dc_efficiency_percent_check
      check (fast_dc_efficiency_percent > 0 and fast_dc_efficiency_percent <= 100);
  end if;
end $$;

comment on column public.cars.fast_dc_efficiency_percent is
  'Grid-to-battery efficiency on fast DC (~91% measured). AC uses default_efficiency_percent.';
comment on column public.cars.default_efficiency_percent is
  'Grid-to-battery efficiency on AC — home and commercial (~98% measured).';
