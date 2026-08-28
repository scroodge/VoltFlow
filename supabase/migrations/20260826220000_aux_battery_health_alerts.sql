-- Server-owned preference and durable per-vehicle episode/digest state.
alter table public.profiles
  add column if not exists aux_battery_alerts_enabled boolean not null default true;

comment on column public.profiles.aux_battery_alerts_enabled is
  'Opt-out for 12V auxiliary-battery acute alerts and weekly decline digests.';

create table if not exists public.bydmate_aux_battery_alert_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  acute_episode_active boolean not null default false,
  last_digest_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, vehicle_id)
);

drop trigger if exists set_bydmate_aux_battery_alert_state_updated_at
  on public.bydmate_aux_battery_alert_state;
create trigger set_bydmate_aux_battery_alert_state_updated_at
before update on public.bydmate_aux_battery_alert_state
for each row execute procedure public.set_updated_at();

alter table public.bydmate_aux_battery_alert_state enable row level security;
revoke all on table public.bydmate_aux_battery_alert_state from public, anon, authenticated;
grant all on table public.bydmate_aux_battery_alert_state to service_role;
