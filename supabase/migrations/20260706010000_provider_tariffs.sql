-- Per-user editable provider tariffs. Absence of a row for a provider means
-- "use the hardcoded PROVIDER_TARIFF_PRESETS default" (src/lib/charging-tariffs.ts).

create table if not exists public.provider_tariffs (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider_type public.charging_provider_type not null,
  home_price_per_kwh numeric not null default 0 check (home_price_per_kwh >= 0),
  commercial_ac_price_per_kwh numeric not null check (commercial_ac_price_per_kwh >= 0),
  fast_dc_price_per_kwh numeric not null check (fast_dc_price_per_kwh >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider_type)
);

drop trigger if exists set_provider_tariffs_updated_at on public.provider_tariffs;
create trigger set_provider_tariffs_updated_at
before update on public.provider_tariffs
for each row execute procedure public.set_updated_at();

alter table public.provider_tariffs enable row level security;

drop policy if exists "provider_tariffs_select_own" on public.provider_tariffs;
create policy "provider_tariffs_select_own"
  on public.provider_tariffs for select
  using (auth.uid() = user_id);

drop policy if exists "provider_tariffs_insert_own" on public.provider_tariffs;
create policy "provider_tariffs_insert_own"
  on public.provider_tariffs for insert
  with check (auth.uid() = user_id);

drop policy if exists "provider_tariffs_update_own" on public.provider_tariffs;
create policy "provider_tariffs_update_own"
  on public.provider_tariffs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "provider_tariffs_delete_own" on public.provider_tariffs;
create policy "provider_tariffs_delete_own"
  on public.provider_tariffs for delete
  using (auth.uid() = user_id);
