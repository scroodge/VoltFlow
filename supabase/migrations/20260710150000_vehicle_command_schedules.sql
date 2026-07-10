-- Recurring parked/off commands. The Mate command poller materializes only due
-- schedules, so Android does not need to keep a local timer alive while parked.

create table if not exists public.vehicle_command_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  type text not null,
  params jsonb not null default '{}'::jsonb,
  run_time time not null,
  days_of_week smallint[] not null,
  time_zone text not null,
  enabled boolean not null default true,
  next_run_at timestamptz not null,
  last_enqueued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_command_schedules_days_check
    check (cardinality(days_of_week) between 1 and 7
      and days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[])
);

create index if not exists vehicle_command_schedules_due_idx
  on public.vehicle_command_schedules (next_run_at)
  where enabled;

alter table public.vehicle_command_schedules enable row level security;

drop policy if exists vehicle_command_schedules_select_own on public.vehicle_command_schedules;
create policy vehicle_command_schedules_select_own on public.vehicle_command_schedules
  for select using (user_id = auth.uid());

drop policy if exists vehicle_command_schedules_insert_own on public.vehicle_command_schedules;
create policy vehicle_command_schedules_insert_own on public.vehicle_command_schedules
  for insert with check (user_id = auth.uid());

drop policy if exists vehicle_command_schedules_update_own on public.vehicle_command_schedules;
create policy vehicle_command_schedules_update_own on public.vehicle_command_schedules
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists vehicle_command_schedules_delete_own on public.vehicle_command_schedules;
create policy vehicle_command_schedules_delete_own on public.vehicle_command_schedules
  for delete using (user_id = auth.uid());

create or replace function public.next_vehicle_command_schedule_run(
  p_run_time time,
  p_days_of_week smallint[],
  p_time_zone text,
  p_after timestamptz default now()
) returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  candidate_date date;
  candidate_run timestamptz;
  day_offset integer;
begin
  for day_offset in 0..7 loop
    candidate_date := (p_after at time zone p_time_zone)::date + day_offset;
    if extract(dow from candidate_date)::smallint = any(p_days_of_week) then
      candidate_run := (candidate_date + p_run_time) at time zone p_time_zone;
      if candidate_run > p_after then return candidate_run; end if;
    end if;
  end loop;
  raise exception 'Could not calculate next schedule run';
end;
$$;

-- Called by the authenticated Mate poll route. Missed runs older than two minutes
-- are deliberately skipped: a stale preheat or unlock command must never fire late.
create or replace function public.enqueue_due_vehicle_command_schedules(
  p_user_id uuid,
  p_vehicle_id text,
  p_now timestamptz default now()
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  schedule_row public.vehicle_command_schedules%rowtype;
  enqueued integer := 0;
begin
  for schedule_row in
    select * from public.vehicle_command_schedules
    where user_id = p_user_id and vehicle_id = p_vehicle_id
      and enabled and next_run_at <= p_now
    order by next_run_at
    for update skip locked
  loop
    if schedule_row.next_run_at >= p_now - interval '2 minutes' then
      insert into public.vehicle_commands (user_id, vehicle_id, type, params, status)
      values (schedule_row.user_id, schedule_row.vehicle_id, schedule_row.type,
        schedule_row.params, 'pending');
      enqueued := enqueued + 1;
    end if;

    update public.vehicle_command_schedules
    set next_run_at = public.next_vehicle_command_schedule_run(
          schedule_row.run_time, schedule_row.days_of_week, schedule_row.time_zone, p_now),
        last_enqueued_at = case when schedule_row.next_run_at >= p_now - interval '2 minutes'
          then p_now else last_enqueued_at end,
        updated_at = p_now
    where id = schedule_row.id;
  end loop;
  return enqueued;
end;
$$;

revoke all on function public.enqueue_due_vehicle_command_schedules(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.enqueue_due_vehicle_command_schedules(uuid, text, timestamptz)
  to service_role;
grant execute on function public.next_vehicle_command_schedule_run(time, smallint[], text, timestamptz)
  to authenticated, service_role;

