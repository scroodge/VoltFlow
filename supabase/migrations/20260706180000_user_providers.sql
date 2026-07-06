-- User-connected charging providers.
-- Users can create their own custom providers (label + prices) and delete them.
-- Built-in providers (the charging_provider_type enum values) remain unchanged.

-- Add a marker enum value meaning "this is a user-created provider, look up user_providers.id"
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'charging_provider_type' and e.enumlabel = 'user_provider'
  ) then
    alter type public.charging_provider_type add value 'user_provider';
  end if;
end $$;

create table if not exists public.user_providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  home_price_per_kwh numeric not null default 0 check (home_price_per_kwh >= 0),
  commercial_ac_price_per_kwh numeric not null check (commercial_ac_price_per_kwh >= 0),
  fast_dc_price_per_kwh numeric not null check (fast_dc_price_per_kwh >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, label)
);

drop trigger if exists set_user_providers_updated_at on public.user_providers;
create trigger set_user_providers_updated_at
before update on public.user_providers
for each row execute procedure public.set_updated_at();

alter table public.user_providers enable row level security;

drop policy if exists "user_providers_select_own" on public.user_providers;
create policy "user_providers_select_own"
  on public.user_providers for select
  using (auth.uid() = user_id);

drop policy if exists "user_providers_insert_own" on public.user_providers;
create policy "user_providers_insert_own"
  on public.user_providers for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_providers_update_own" on public.user_providers;
create policy "user_providers_update_own"
  on public.user_providers for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_providers_delete_own" on public.user_providers;
create policy "user_providers_delete_own"
  on public.user_providers for delete
  using (auth.uid() = user_id);

-- Nullable FK to user_providers for sessions using a custom user-created provider.
-- When provider_type = 'user_provider', user_provider_id points to the custom provider row.
-- When provider_type is a built-in enum value, user_provider_id is null.
alter table public.charging_sessions
  add column if not exists user_provider_id uuid references public.user_providers(id) on delete set null;

alter table public.charging_tariff_locations
  add column if not exists user_provider_id uuid references public.user_providers(id) on delete set null;
