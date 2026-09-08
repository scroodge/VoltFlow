-- Materialise completed UTC days for phantom-drain analytics.
--
-- This additive migration intentionally preserves the public
-- bydmate_phantom_drain_daily reader. Scheduling, population, and the reader
-- switch are separate, explicitly approved rollout phases.

create table if not exists public.bydmate_phantom_drain_daily_rollups (
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  date date not null,
  soc_start numeric not null,
  soc_end numeric not null,
  drain_percent numeric not null,
  idle_hours numeric not null,
  computed_at timestamptz not null default now(),
  constraint bydmate_phantom_drain_daily_rollups_pkey
    primary key (user_id, vehicle_id, date),
  constraint bydmate_phantom_drain_daily_rollups_drain_check
    check (drain_percent > 0),
  constraint bydmate_phantom_drain_daily_rollups_idle_check
    check (idle_hours >= 4),
  constraint bydmate_phantom_drain_daily_rollups_completed_day_check
    check (date < (computed_at at time zone 'UTC')::date)
);

comment on table public.bydmate_phantom_drain_daily_rollups is
  'Server-maintained phantom-drain analytics for completed UTC days. Retained for five calendar years independently of raw telemetry.';

create table if not exists public.bydmate_phantom_drain_rollup_queue (
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  date date not null,
  reason text not null default 'daily',
  enqueued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  constraint bydmate_phantom_drain_rollup_queue_pkey
    primary key (user_id, vehicle_id, date),
  constraint bydmate_phantom_drain_rollup_queue_attempts_check
    check (attempts >= 0)
);

create index if not exists bydmate_phantom_drain_rollup_queue_claim_idx
  on public.bydmate_phantom_drain_rollup_queue (
    attempts, enqueued_at, user_id, vehicle_id, date
  );

alter table public.bydmate_phantom_drain_daily_rollups enable row level security;
alter table public.bydmate_phantom_drain_rollup_queue enable row level security;

drop policy if exists "bydmate_phantom_drain_daily_rollups_select_own"
  on public.bydmate_phantom_drain_daily_rollups;
create policy "bydmate_phantom_drain_daily_rollups_select_own"
  on public.bydmate_phantom_drain_daily_rollups
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    and (
      (select public.is_user_premium(auth.uid(), statement_timestamp()))
      or date > (
        (statement_timestamp() - interval '1 month') at time zone 'UTC'
      )::date
    )
  );

revoke all on table public.bydmate_phantom_drain_daily_rollups
  from public, anon, authenticated;
grant select on table public.bydmate_phantom_drain_daily_rollups
  to authenticated;
revoke all on table public.bydmate_phantom_drain_rollup_queue
  from public, anon, authenticated;

-- Frozen copy of the pre-rollup RPC. Never rewrite this function to read the
-- rollup table or a view over it: it is the independent parity baseline.
create or replace function public.bydmate_phantom_drain_daily_raw_baseline(
  p_user_id uuid,
  p_vehicle_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  date date,
  soc_start numeric,
  soc_end numeric,
  drain_percent numeric,
  idle_hours numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with classified as (
    select
      device_time,
      (device_time at time zone 'UTC')::date as sample_date,
      public.bydmate_jsonb_numeric(telemetry, 'soc') as soc,
      public.bydmate_is_parked_unplugged(
        telemetry,
        diplus_charge_gun_state
      ) as is_parked
    from public.bydmate_telemetry_samples
    where user_id = p_user_id
      and vehicle_id = p_vehicle_id
      and device_time >= p_from
      and device_time <= p_to
  ),
  ordered as (
    select
      *,
      lag(device_time) over (order by device_time) as previous_device_time,
      lag(sample_date) over (order by device_time) as previous_sample_date,
      lag(is_parked) over (order by device_time) as previous_is_parked
    from classified
  ),
  marked as (
    select
      *,
      sum(
        case
          when is_parked and (
            previous_is_parked is distinct from true
            or previous_sample_date is distinct from sample_date
            or previous_device_time is null
            or device_time <= previous_device_time
            or device_time - previous_device_time >= interval '6 hours'
          ) then 1
          else 0
        end
      ) over (order by device_time rows unbounded preceding) as parked_interval_id
    from ordered
  ),
  parked_intervals as (
    select
      sample_date,
      parked_interval_id,
      min(device_time) as interval_started_at,
      max(device_time) as interval_ended_at,
      array_agg(soc order by device_time) filter (where soc is not null) as soc_values
    from marked
    where is_parked
    group by sample_date, parked_interval_id
  ),
  eligible as (
    select
      sample_date,
      interval_started_at,
      interval_ended_at,
      soc_values[1] as interval_soc_start,
      soc_values[array_length(soc_values, 1)] as interval_soc_end,
      soc_values[1] - soc_values[array_length(soc_values, 1)] as interval_drain
    from parked_intervals
    where interval_ended_at - interval_started_at >= interval '4 hours'
      and array_length(soc_values, 1) > 0
      and soc_values[1] > soc_values[array_length(soc_values, 1)]
  )
  select
    sample_date,
    (array_agg(interval_soc_start order by interval_started_at))[1],
    (array_agg(interval_soc_end order by interval_started_at desc))[1],
    sum(interval_drain),
    sum(extract(epoch from interval_ended_at - interval_started_at)) / 3600
  from eligible
  group by sample_date
  order by sample_date;
$$;

create or replace function public.bydmate_materialize_phantom_drain_day(
  p_user_id uuid,
  p_vehicle_id text,
  p_date date
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  if p_user_id is null or nullif(trim(p_vehicle_id), '') is null then
    raise exception 'User and vehicle are required'
      using errcode = '22023';
  end if;

  if p_date is null
     or p_date >= (clock_timestamp() at time zone 'UTC')::date then
    raise exception 'Only completed UTC days can be materialised: %', p_date
      using errcode = '22023';
  end if;

  delete from public.bydmate_phantom_drain_daily_rollups r
  where r.user_id = p_user_id
    and r.vehicle_id = p_vehicle_id
    and r.date = p_date;

  with classified as (
    select
      s.device_time,
      (s.device_time at time zone 'UTC')::date as sample_date,
      public.bydmate_jsonb_numeric(s.telemetry, 'soc') as soc,
      public.bydmate_is_parked_unplugged(
        s.telemetry,
        s.diplus_charge_gun_state
      ) as is_parked
    from public.bydmate_telemetry_samples s
    where s.user_id = p_user_id
      and s.vehicle_id = p_vehicle_id
      and s.device_time >= (p_date::timestamp at time zone 'UTC')
      and s.device_time < ((p_date + 1)::timestamp at time zone 'UTC')
  ),
  ordered as (
    select
      classified.*,
      lag(device_time) over (order by device_time) as previous_device_time,
      lag(sample_date) over (order by device_time) as previous_sample_date,
      lag(is_parked) over (order by device_time) as previous_is_parked
    from classified
  ),
  marked as (
    select
      ordered.*,
      sum(
        case
          when is_parked and (
            previous_is_parked is distinct from true
            or previous_sample_date is distinct from sample_date
            or previous_device_time is null
            or device_time <= previous_device_time
            or device_time - previous_device_time >= interval '6 hours'
          ) then 1
          else 0
        end
      ) over (order by device_time rows unbounded preceding) as parked_interval_id
    from ordered
  ),
  parked_intervals as (
    select
      sample_date,
      parked_interval_id,
      min(device_time) as interval_started_at,
      max(device_time) as interval_ended_at,
      array_agg(soc order by device_time) filter (where soc is not null) as soc_values
    from marked
    where is_parked
    group by sample_date, parked_interval_id
  ),
  eligible as (
    select
      sample_date,
      interval_started_at,
      interval_ended_at,
      soc_values[1] as interval_soc_start,
      soc_values[array_length(soc_values, 1)] as interval_soc_end,
      soc_values[1] - soc_values[array_length(soc_values, 1)] as interval_drain
    from parked_intervals
    where interval_ended_at - interval_started_at >= interval '4 hours'
      and array_length(soc_values, 1) > 0
      and soc_values[1] > soc_values[array_length(soc_values, 1)]
  ),
  daily as (
    select
      (array_agg(interval_soc_start order by interval_started_at))[1] as soc_start,
      (array_agg(interval_soc_end order by interval_started_at desc))[1] as soc_end,
      sum(interval_drain) as drain_percent,
      sum(extract(epoch from interval_ended_at - interval_started_at)) / 3600
        as idle_hours
    from eligible
    group by sample_date
  )
  insert into public.bydmate_phantom_drain_daily_rollups (
    user_id, vehicle_id, date, soc_start, soc_end, drain_percent, idle_hours,
    computed_at
  )
  select
    p_user_id, p_vehicle_id, p_date, daily.soc_start, daily.soc_end,
    daily.drain_percent, daily.idle_hours, clock_timestamp()
  from daily;

  get diagnostics v_inserted = row_count;

  delete from public.bydmate_phantom_drain_rollup_queue q
  where q.user_id = p_user_id
    and q.vehicle_id = p_vehicle_id
    and q.date = p_date;

  return v_inserted > 0;
end;
$$;

-- Daily discovery is deliberately driven from configured cars. Every EXISTS
-- probe binds one tenant, one vehicle, and one UTC day.
create or replace function public.bydmate_enqueue_phantom_drain_day(
  p_date date default ((clock_timestamp() at time zone 'UTC')::date - 1)
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_car record;
  v_count integer := 0;
begin
  if p_date is null
     or p_date >= (clock_timestamp() at time zone 'UTC')::date then
    raise exception 'Only completed UTC days can be queued: %', p_date
      using errcode = '22023';
  end if;

  for v_car in
    select distinct c.user_id, c.vehicle_alias as vehicle_id
    from public.cars c
    where nullif(trim(c.vehicle_alias), '') is not null
  loop
    if exists (
      select 1
      from public.bydmate_telemetry_samples s
      where s.user_id = v_car.user_id
        and s.vehicle_id = v_car.vehicle_id
        and s.device_time >= (p_date::timestamp at time zone 'UTC')
        and s.device_time < ((p_date + 1)::timestamp at time zone 'UTC')
    ) then
      insert into public.bydmate_phantom_drain_rollup_queue (
        user_id, vehicle_id, date, reason
      ) values (
        v_car.user_id, v_car.vehicle_id, p_date, 'daily'
      )
      on conflict (user_id, vehicle_id, date) do update
      set reason = excluded.reason,
          enqueued_at = least(
            public.bydmate_phantom_drain_rollup_queue.enqueued_at,
            excluded.enqueued_at
          );

      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- Backfill orchestration supplies one explicit key at a time. There is no
-- range function and no generate_series execution shape.
create or replace function public.bydmate_enqueue_phantom_drain_key(
  p_user_id uuid,
  p_vehicle_id text,
  p_date date,
  p_reason text default 'backfill'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or nullif(trim(p_vehicle_id), '') is null then
    raise exception 'User and vehicle are required'
      using errcode = '22023';
  end if;

  if p_date is null
     or p_date >= (clock_timestamp() at time zone 'UTC')::date then
    raise exception 'Only completed UTC days can be queued: %', p_date
      using errcode = '22023';
  end if;

  if nullif(trim(p_reason), '') is null then
    raise exception 'Queue reason is required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.bydmate_telemetry_samples s
    where s.user_id = p_user_id
      and s.vehicle_id = p_vehicle_id
      and s.device_time >= (p_date::timestamp at time zone 'UTC')
      and s.device_time < ((p_date + 1)::timestamp at time zone 'UTC')
  ) then
    return false;
  end if;

  insert into public.bydmate_phantom_drain_rollup_queue (
    user_id, vehicle_id, date, reason
  ) values (
    p_user_id, p_vehicle_id, p_date, trim(p_reason)
  )
  on conflict (user_id, vehicle_id, date) do update
  set reason = excluded.reason,
      enqueued_at = least(
        public.bydmate_phantom_drain_rollup_queue.enqueued_at,
        excluded.enqueued_at
      );

  return true;
end;
$$;

-- One call claims and processes at most one vehicle-day. The caller controls
-- the transaction boundary, preserving the paced one-day rollout contract.
create or replace function public.bydmate_process_phantom_drain_rollup_queue()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
begin
  select q.user_id, q.vehicle_id, q.date
  into v_item
  from public.bydmate_phantom_drain_rollup_queue q
  where q.attempts < 5
  order by q.attempts, q.enqueued_at, q.user_id, q.vehicle_id, q.date
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object('processed', 0, 'failed', 0);
  end if;

  begin
    perform public.bydmate_materialize_phantom_drain_day(
      v_item.user_id, v_item.vehicle_id, v_item.date
    );
    return jsonb_build_object('processed', 1, 'failed', 0);
  exception when others then
    update public.bydmate_phantom_drain_rollup_queue q
    set attempts = q.attempts + 1,
        last_attempt_at = clock_timestamp(),
        last_error = left(sqlstate || ': ' || sqlerrm, 1000)
    where q.user_id = v_item.user_id
      and q.vehicle_id = v_item.vehicle_id
      and q.date = v_item.date;

    return jsonb_build_object('processed', 0, 'failed', 1);
  end;
end;
$$;

-- Five calendar years, independently of free/premium raw retention. The raw
-- telemetry purge must never include this table.
create or replace function public.purge_old_bydmate_phantom_drain_rollups()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint;
begin
  delete from public.bydmate_phantom_drain_daily_rollups
  where date < (
    (statement_timestamp() at time zone 'UTC')::date - interval '5 years'
  )::date;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.bydmate_phantom_drain_daily_raw_baseline(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.bydmate_materialize_phantom_drain_day(uuid, text, date) from public, anon, authenticated;
revoke all on function public.bydmate_enqueue_phantom_drain_day(date) from public, anon, authenticated;
revoke all on function public.bydmate_enqueue_phantom_drain_key(uuid, text, date, text) from public, anon, authenticated;
revoke all on function public.bydmate_process_phantom_drain_rollup_queue() from public, anon, authenticated;
revoke all on function public.purge_old_bydmate_phantom_drain_rollups() from public, anon, authenticated;

grant execute on function public.bydmate_phantom_drain_daily_raw_baseline(uuid, text, timestamptz, timestamptz) to service_role;
grant execute on function public.bydmate_materialize_phantom_drain_day(uuid, text, date) to service_role;
grant execute on function public.bydmate_enqueue_phantom_drain_day(date) to service_role;
grant execute on function public.bydmate_enqueue_phantom_drain_key(uuid, text, date, text) to service_role;
grant execute on function public.bydmate_process_phantom_drain_rollup_queue() to service_role;
grant execute on function public.purge_old_bydmate_phantom_drain_rollups() to service_role;

-- No data is enqueued or materialised here. Scheduling and the public reader
-- switch are deliberately absent from this migration.
