-- Remote vehicle commands queue (VoltFlow dashboard → BYDMate agent).

do $$
begin
  create type public.vehicle_command_status as enum (
    'pending', 'sent', 'done', 'failed', 'rejected'
  );
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.vehicle_commands (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  vehicle_id   text not null,
  type         text not null,
  params       jsonb not null default '{}'::jsonb,
  status       public.vehicle_command_status not null default 'pending',
  result       jsonb,
  created_at   timestamptz not null default now(),
  executed_at  timestamptz
);

create index if not exists vehicle_commands_user_created_idx
  on public.vehicle_commands (user_id, created_at desc);

create index if not exists vehicle_commands_vehicle_pending_idx
  on public.vehicle_commands (vehicle_id, created_at)
  where status = 'pending';

alter table public.vehicle_commands enable row level security;

drop policy if exists vehicle_commands_select_own on public.vehicle_commands;
create policy vehicle_commands_select_own
  on public.vehicle_commands
  for select
  using (user_id = auth.uid());

drop policy if exists vehicle_commands_insert_own on public.vehicle_commands;
create policy vehicle_commands_insert_own
  on public.vehicle_commands
  for insert
  with check (user_id = auth.uid());

-- Agent updates via service-role API routes only.

do $$
begin
  alter publication supabase_realtime add table public.vehicle_commands;
exception
  when duplicate_object then null;
end;
$$;
