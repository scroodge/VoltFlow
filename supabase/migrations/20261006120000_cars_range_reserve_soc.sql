-- Per-car range reserve: user-visible range estimates count down to this SOC, not 0%.
-- 5%-step values only; 0 keeps the historical drain-to-empty behavior.
alter table public.cars
add column if not exists range_reserve_soc_percent numeric not null default 0
  check (range_reserve_soc_percent in (0, 5, 10, 15, 20, 25, 30, 35, 40));
