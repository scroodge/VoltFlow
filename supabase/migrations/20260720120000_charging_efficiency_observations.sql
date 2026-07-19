-- Smart Charge "Loose Mode": user-corrected sessions + learned efficiency.
--
-- energy_corrected_at marks a session whose charged_energy_kwh/estimated_cost/price_per_kwh
-- were replaced with provider-billed values (as opposed to energy_overridden rows written by
-- the 20260630150000 repair migration, which are math-repair, not a billing correction).
--
-- charging_efficiency_observations is the auditable measurement log: one row per corrected
-- session, storing the measured efficiency (battery kWh from SOC delta ÷ billed kWh) plus a
-- telemetry-window snapshot (avg battery/outside temp, avg charge power). It is written at
-- correction time, not derived lazily, because bydmate_telemetry_samples has retention-based
-- purge (see supabase/TELEMETRY.md) -- the context would not survive to be recomputed later.

alter table if exists public.charging_sessions
  add column if not exists energy_corrected_at timestamptz;

create table if not exists public.charging_efficiency_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  car_id uuid not null references public.cars(id) on delete cascade,
  session_id uuid not null references public.charging_sessions(id) on delete cascade,
  tariff_type public.charging_tariff_type not null,
  measured_efficiency_percent numeric not null check (measured_efficiency_percent > 0),
  soc_delta_percent numeric not null check (soc_delta_percent > 0),
  battery_capacity_kwh numeric not null check (battery_capacity_kwh > 0),
  billed_energy_kwh numeric not null check (billed_energy_kwh > 0),
  billed_total_cost numeric not null check (billed_total_cost >= 0),
  avg_battery_temp_c numeric,
  avg_outside_temp_c numeric,
  avg_charge_power_kw numeric,
  telemetry_sample_count integer not null default 0,
  computed_at timestamptz not null default now(),
  unique (session_id)
);

create index if not exists charging_efficiency_observations_car_tariff_idx
  on public.charging_efficiency_observations (user_id, car_id, tariff_type, computed_at desc);

alter table public.charging_efficiency_observations enable row level security;

drop policy if exists "charging_efficiency_observations_select_own" on public.charging_efficiency_observations;
create policy "charging_efficiency_observations_select_own"
  on public.charging_efficiency_observations for select
  using (auth.uid() = user_id);

drop policy if exists "charging_efficiency_observations_insert_own" on public.charging_efficiency_observations;
create policy "charging_efficiency_observations_insert_own"
  on public.charging_efficiency_observations for insert
  with check (auth.uid() = user_id);

drop policy if exists "charging_efficiency_observations_update_own" on public.charging_efficiency_observations;
create policy "charging_efficiency_observations_update_own"
  on public.charging_efficiency_observations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "charging_efficiency_observations_delete_own" on public.charging_efficiency_observations;
create policy "charging_efficiency_observations_delete_own"
  on public.charging_efficiency_observations for delete
  using (auth.uid() = user_id);
