-- Android "live" lock-screen status via updating web push (tag-replaced, silent).
-- profiles.live_status_mode: user preference read server-side at telemetry ingest
-- (the server decides whether to push, so this cannot live in localStorage).
-- bydmate_live_status_state: per-vehicle throttle/dedup state, same pattern as
-- bydmate_charge_notification_state.

alter table public.profiles
  add column if not exists live_status_mode text not null default 'charging'
    check (live_status_mode in ('off', 'charging', 'charging_parked'));

create table if not exists public.bydmate_live_status_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  last_state text,
  last_sent_at timestamptz,
  last_soc numeric check (last_soc is null or (last_soc >= 0 and last_soc <= 100)),
  charge_started_at timestamptz,
  charge_start_soc numeric check (
    charge_start_soc is null or (charge_start_soc >= 0 and charge_start_soc <= 100)
  ),
  updated_at timestamptz not null default now(),
  primary key (user_id, vehicle_id)
);

drop trigger if exists set_bydmate_live_status_state_updated_at on public.bydmate_live_status_state;
create trigger set_bydmate_live_status_state_updated_at
before update on public.bydmate_live_status_state
for each row execute procedure public.set_updated_at();

alter table public.bydmate_live_status_state enable row level security;

drop policy if exists "bydmate_live_status_state_select_own" on public.bydmate_live_status_state;
create policy "bydmate_live_status_state_select_own"
  on public.bydmate_live_status_state for select
  using (auth.uid() = user_id);

drop policy if exists "bydmate_live_status_state_insert_own" on public.bydmate_live_status_state;
create policy "bydmate_live_status_state_insert_own"
  on public.bydmate_live_status_state for insert
  with check (auth.uid() = user_id);

drop policy if exists "bydmate_live_status_state_update_own" on public.bydmate_live_status_state;
create policy "bydmate_live_status_state_update_own"
  on public.bydmate_live_status_state for update
  using (auth.uid() = user_id);

drop policy if exists "bydmate_live_status_state_delete_own" on public.bydmate_live_status_state;
create policy "bydmate_live_status_state_delete_own"
  on public.bydmate_live_status_state for delete
  using (auth.uid() = user_id);
