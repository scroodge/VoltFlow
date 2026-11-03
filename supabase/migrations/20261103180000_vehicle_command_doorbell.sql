-- Command doorbell: push a "you have a command" signal to the car over Supabase Realtime
-- so it polls immediately instead of on its next 6 s / 90 s tick.
--
-- The signal carries no command: the car still fetches, validates and acks through
-- /api/bydmate/commands, so a forged ring can only cause one extra poll. The topic is a
-- random per-car token handed to the car in the poll response; it is the only secret.

create table if not exists public.bydmate_command_doorbells (
  user_id    uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  topic      text not null unique
             default ('cmd-' || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz not null default now(),
  primary key (user_id, vehicle_id)
);

-- Service-role API routes and the trigger below only; no client policies.
alter table public.bydmate_command_doorbells enable row level security;

create or replace function public.ring_vehicle_command_doorbell()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_topic text;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  select topic into v_topic
  from public.bydmate_command_doorbells
  where user_id = new.user_id and vehicle_id = new.vehicle_id;

  if v_topic is null then
    return new; -- car has never asked for a doorbell (older APK): polling only
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('id', new.id),
      'command',
      v_topic,
      false
    );
  exception when others then
    -- A Realtime hiccup must never block the command itself; polling still delivers it.
    raise warning 'vehicle command doorbell failed: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists vehicle_commands_ring_doorbell on public.vehicle_commands;
create trigger vehicle_commands_ring_doorbell
  after insert on public.vehicle_commands
  for each row
  execute function public.ring_vehicle_command_doorbell();
