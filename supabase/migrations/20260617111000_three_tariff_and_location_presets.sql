-- Three-tariff pricing model + user GPS tariff presets.

alter table public.profiles
  add column if not exists home_price_per_kwh numeric not null default 0.12 check (home_price_per_kwh >= 0),
  add column if not exists commercial_ac_price_per_kwh numeric not null default 0.12 check (commercial_ac_price_per_kwh >= 0),
  add column if not exists fast_dc_price_per_kwh numeric not null default 0.12 check (fast_dc_price_per_kwh >= 0);

update public.profiles
set
  home_price_per_kwh = coalesce(default_price_per_kwh, 0.12),
  commercial_ac_price_per_kwh = coalesce(commercial_ac_price_per_kwh, default_price_per_kwh, 0.12),
  fast_dc_price_per_kwh = coalesce(fast_dc_price_per_kwh, default_price_per_kwh, 0.12)
where true;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'charging_tariff_type'
  ) then
    create type public.charging_tariff_type as enum ('home', 'commercial_ac', 'fast_dc');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'charging_provider_type'
  ) then
    create type public.charging_provider_type as enum ('home', 'malanka', 'evika', 'forevo', 'zaryadka', 'custom');
  end if;
end $$;

alter table public.charging_sessions
  add column if not exists tariff_type public.charging_tariff_type not null default 'home',
  add column if not exists provider_type public.charging_provider_type not null default 'custom';

create table if not exists public.charging_tariff_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  radius_m numeric not null default 150 check (radius_m > 0 and radius_m <= 5000),
  tariff_type public.charging_tariff_type not null,
  provider_type public.charging_provider_type not null default 'custom',
  price_per_kwh_override numeric check (price_per_kwh_override is null or price_per_kwh_override >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists charging_tariff_locations_user_idx
  on public.charging_tariff_locations (user_id);

create index if not exists charging_tariff_locations_user_tariff_idx
  on public.charging_tariff_locations (user_id, tariff_type);

drop trigger if exists set_charging_tariff_locations_updated_at on public.charging_tariff_locations;
create trigger set_charging_tariff_locations_updated_at
before update on public.charging_tariff_locations
for each row execute procedure public.set_updated_at();

alter table public.charging_tariff_locations enable row level security;

drop policy if exists "charging_tariff_locations_select_own" on public.charging_tariff_locations;
create policy "charging_tariff_locations_select_own"
  on public.charging_tariff_locations for select
  using (auth.uid() = user_id);

drop policy if exists "charging_tariff_locations_insert_own" on public.charging_tariff_locations;
create policy "charging_tariff_locations_insert_own"
  on public.charging_tariff_locations for insert
  with check (auth.uid() = user_id);

drop policy if exists "charging_tariff_locations_update_own" on public.charging_tariff_locations;
create policy "charging_tariff_locations_update_own"
  on public.charging_tariff_locations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "charging_tariff_locations_delete_own" on public.charging_tariff_locations;
create policy "charging_tariff_locations_delete_own"
  on public.charging_tariff_locations for delete
  using (auth.uid() = user_id);
