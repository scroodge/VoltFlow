-- Tracks consecutive charging/unplug samples for Mate-driven auto start/stop of charging_sessions.

create table if not exists public.bydmate_auto_charging_session_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  consecutive_charging_samples integer not null default 0,
  consecutive_unplug_samples integer not null default 0,
  last_is_charging boolean not null default false,
  last_device_time timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, vehicle_id)
);

drop trigger if exists set_bydmate_auto_charging_session_state_updated_at
  on public.bydmate_auto_charging_session_state;
create trigger set_bydmate_auto_charging_session_state_updated_at
before update on public.bydmate_auto_charging_session_state
for each row execute procedure public.set_updated_at();

alter table public.bydmate_auto_charging_session_state enable row level security;

create policy "bydmate_auto_charging_session_state_select_own"
  on public.bydmate_auto_charging_session_state for select
  using (auth.uid() = user_id);

create policy "bydmate_auto_charging_session_state_insert_own"
  on public.bydmate_auto_charging_session_state for insert
  with check (auth.uid() = user_id);

create policy "bydmate_auto_charging_session_state_update_own"
  on public.bydmate_auto_charging_session_state for update
  using (auth.uid() = user_id);

create policy "bydmate_auto_charging_session_state_delete_own"
  on public.bydmate_auto_charging_session_state for delete
  using (auth.uid() = user_id);
