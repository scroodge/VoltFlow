-- Phase 3: Battery snapshots and idle drains tables.
-- Battery snapshots record BMS health data at charge session ends.
-- Idle drains record zero-km trips from energydata (parked energy consumption).
-- Idempotent: safe to re-run.

-- Battery snapshots: recorded when SOC delta >= 5% during a charge session
create table if not exists public.bydmate_battery_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id text not null,
  recorded_at timestamptz not null,
  odometer_km numeric,
  soc_start numeric,
  soc_end numeric,
  kwh_charged numeric,
  calculated_capacity_kwh numeric,
  soh_percent numeric,
  cell_delta_v numeric,
  bat_temp_avg_c numeric,
  charge_id uuid,
  created_at timestamptz not null default now()
);

comment on table public.bydmate_battery_snapshots is
  'BMS health snapshots recorded at charge session ends (SOC delta >= 5%). Tracks battery degradation over time.';

create index if not exists bydmate_battery_snapshots_user_vehicle_idx
  on public.bydmate_battery_snapshots (user_id, vehicle_id, recorded_at desc);

alter table public.bydmate_battery_snapshots enable row level security;

do $$ begin
  create policy "battery_snapshots_select_own" on public.bydmate_battery_snapshots
    for select using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

-- Idle drains: zero-km trips from energydata (parked energy consumption)
create table if not exists public.bydmate_idle_drains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id text not null,
  start_ts timestamptz not null,
  end_ts timestamptz not null,
  kwh_consumed numeric,
  created_at timestamptz not null default now()
);

comment on table public.bydmate_idle_drains is
  'Zero-km trips from BYD energydata indicating parked energy consumption (idle drain).';

create index if not exists bydmate_idle_drains_user_vehicle_idx
  on public.bydmate_idle_drains (user_id, vehicle_id, start_ts desc);

alter table public.bydmate_idle_drains enable row level security;

do $$ begin
  create policy "idle_drains_select_own" on public.bydmate_idle_drains
    for select using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;
