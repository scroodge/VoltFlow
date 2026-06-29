create table if not exists public.bydmate_vehicle_state_notifications (
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  last_device_time timestamptz,
  last_received_at timestamptz,
  last_soc numeric,
  last_odometer_km numeric,
  last_lat double precision,
  last_lon double precision,
  last_is_parked boolean not null default false,
  last_connected_at timestamptz,
  last_disconnected_at timestamptz,
  last_park_notified_at timestamptz,
  primary key (user_id, vehicle_id)
);

alter table public.bydmate_vehicle_state_notifications enable row level security;

create policy "Users can view own vehicle state notifications"
  on public.bydmate_vehicle_state_notifications
  for select
  using (auth.uid() = user_id);

grant all on public.bydmate_vehicle_state_notifications to service_role;
