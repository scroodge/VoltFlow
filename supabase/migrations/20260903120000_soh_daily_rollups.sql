-- Materialise completed UTC days for SOH analytics.
--
-- This migration intentionally preserves the public bydmate_soh_daily reader.
-- Its current raw implementation is frozen below for production parity proof;
-- the reader switches in a later migration after rollup population is verified.

create table if not exists public.bydmate_soh_daily_rollups (
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  date date not null,
  device_time timestamptz not null,
  soh_percent numeric not null,
  computed_at timestamptz not null default now(),
  constraint bydmate_soh_daily_rollups_pkey
    primary key (user_id, vehicle_id, date),
  constraint bydmate_soh_daily_rollups_value_check
    check (soh_percent between 0 and 100),
  constraint bydmate_soh_daily_rollups_device_day_check
    check ((device_time at time zone 'UTC')::date = date),
  constraint bydmate_soh_daily_rollups_completed_day_check
    check (date < (computed_at at time zone 'UTC')::date)
);

create index if not exists bydmate_soh_daily_rollups_user_date_idx
  on public.bydmate_soh_daily_rollups (user_id, date, vehicle_id);

comment on table public.bydmate_soh_daily_rollups is
  'Server-maintained latest valid SOH sample per completed UTC day. Retained for five years independently of raw telemetry.';

create table if not exists public.bydmate_soh_rollup_queue (
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  date date not null,
  reason text not null default 'daily',
  enqueued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  constraint bydmate_soh_rollup_queue_pkey
    primary key (user_id, vehicle_id, date),
  constraint bydmate_soh_rollup_queue_attempts_check
    check (attempts >= 0)
);

create index if not exists bydmate_soh_rollup_queue_claim_idx
  on public.bydmate_soh_rollup_queue (attempts, enqueued_at, user_id, vehicle_id, date);

alter table public.bydmate_soh_daily_rollups enable row level security;
alter table public.bydmate_soh_rollup_queue enable row level security;

drop policy if exists "bydmate_soh_daily_rollups_select_own"
  on public.bydmate_soh_daily_rollups;
create policy "bydmate_soh_daily_rollups_select_own"
  on public.bydmate_soh_daily_rollups
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.bydmate_soh_daily_rollups from public, anon, authenticated;
grant select on table public.bydmate_soh_daily_rollups to authenticated;
revoke all on table public.bydmate_soh_rollup_queue from public, anon, authenticated;

-- Frozen copy of the pre-rollup RPC. Never rewrite this function to read the
-- rollup table or a view over it: it is the independent parity baseline.
create or replace function public.bydmate_soh_daily_raw_baseline(
  p_user_id uuid,
  p_vehicle_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  device_time timestamptz,
  soh_percent numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select sampled.device_time, sampled.soh_percent
  from (
    select distinct on ((device_time at time zone 'UTC')::date)
      device_time,
      public.bydmate_jsonb_numeric(telemetry, 'soh_percent') as soh_percent
    from public.bydmate_telemetry_samples
    where user_id = p_user_id
      and (p_vehicle_id is null or vehicle_id = p_vehicle_id)
      and device_time >= p_from
      and device_time <= p_to
      and telemetry ? 'soh_percent'
      and public.bydmate_jsonb_numeric(telemetry, 'soh_percent') between 0 and 100
    order by (device_time at time zone 'UTC')::date, device_time desc
  ) as sampled
  order by sampled.device_time;
$$;

create or replace function public.bydmate_materialize_soh_day(
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

  if p_date >= (clock_timestamp() at time zone 'UTC')::date then
    raise exception 'Only completed UTC days can be materialised: %', p_date
      using errcode = '22023';
  end if;

  delete from public.bydmate_soh_daily_rollups r
  where r.user_id = p_user_id
    and r.vehicle_id = p_vehicle_id
    and r.date = p_date;

  insert into public.bydmate_soh_daily_rollups (
    user_id, vehicle_id, date, device_time, soh_percent, computed_at
  )
  select
    p_user_id,
    p_vehicle_id,
    p_date,
    s.device_time,
    public.bydmate_jsonb_numeric(s.telemetry, 'soh_percent'),
    clock_timestamp()
  from public.bydmate_telemetry_samples s
  where s.user_id = p_user_id
    and s.vehicle_id = p_vehicle_id
    and s.device_time >= (p_date::timestamp at time zone 'UTC')
    and s.device_time < ((p_date + 1)::timestamp at time zone 'UTC')
    and s.telemetry ? 'soh_percent'
    and public.bydmate_jsonb_numeric(s.telemetry, 'soh_percent') between 0 and 100
  order by s.device_time desc
  limit 1;

  get diagnostics v_inserted = row_count;

  delete from public.bydmate_soh_rollup_queue q
  where q.user_id = p_user_id
    and q.vehicle_id = p_vehicle_id
    and q.date = p_date;

  return v_inserted > 0;
end;
$$;

-- Drive daily discovery from configured tenant/vehicle pairs. Each raw probe
-- binds user_id, vehicle_id, and one day so it cannot fall back to an unscoped
-- BRIN or user/time scan.
create or replace function public.bydmate_enqueue_soh_day(
  p_date date default ((clock_timestamp() at time zone 'UTC')::date - 1)
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_date >= (clock_timestamp() at time zone 'UTC')::date then
    raise exception 'Only completed UTC days can be queued: %', p_date
      using errcode = '22023';
  end if;

  insert into public.bydmate_soh_rollup_queue (
    user_id, vehicle_id, date, reason
  )
  select distinct c.user_id, c.vehicle_alias, p_date, 'daily'
  from public.cars c
  where nullif(trim(c.vehicle_alias), '') is not null
    and exists (
      select 1
      from public.bydmate_telemetry_samples s
      where s.user_id = c.user_id
        and s.vehicle_id = c.vehicle_alias
        and s.device_time >= (p_date::timestamp at time zone 'UTC')
        and s.device_time < ((p_date + 1)::timestamp at time zone 'UTC')
        and s.telemetry ? 'soh_percent'
        and public.bydmate_jsonb_numeric(s.telemetry, 'soh_percent') between 0 and 100
    )
  on conflict (user_id, vehicle_id, date) do update
  set reason = excluded.reason,
      enqueued_at = least(
        public.bydmate_soh_rollup_queue.enqueued_at,
        excluded.enqueued_at
      );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.bydmate_enqueue_soh_backfill(
  p_user_id uuid,
  p_vehicle_id text,
  p_from date,
  p_to date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_user_id is null or nullif(trim(p_vehicle_id), '') is null then
    raise exception 'User and vehicle are required'
      using errcode = '22023';
  end if;

  if p_to < p_from or p_to - p_from > 30 then
    raise exception 'Backfill enqueue range must contain at most 31 days'
      using errcode = '22023';
  end if;

  insert into public.bydmate_soh_rollup_queue (
    user_id, vehicle_id, date, reason
  )
  select p_user_id, p_vehicle_id, d.date, 'backfill'
  from generate_series(p_from, p_to, interval '1 day') as d(date)
  where d.date::date < (clock_timestamp() at time zone 'UTC')::date
    and exists (
      select 1
      from public.bydmate_telemetry_samples s
      where s.user_id = p_user_id
        and s.vehicle_id = p_vehicle_id
        and s.device_time >= (d.date::date::timestamp at time zone 'UTC')
        and s.device_time < (((d.date::date + 1)::timestamp) at time zone 'UTC')
        and s.telemetry ? 'soh_percent'
        and public.bydmate_jsonb_numeric(s.telemetry, 'soh_percent') between 0 and 100
    )
  on conflict (user_id, vehicle_id, date) do update
  set reason = excluded.reason,
      enqueued_at = least(
        public.bydmate_soh_rollup_queue.enqueued_at,
        excluded.enqueued_at
      );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.bydmate_process_soh_rollup_queue(
  p_batch_size integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_processed integer := 0;
  v_failed integer := 0;
begin
  if p_batch_size < 1 or p_batch_size > 10 then
    raise exception 'Batch size must be between 1 and 10'
      using errcode = '22023';
  end if;

  for v_item in
    select q.user_id, q.vehicle_id, q.date
    from public.bydmate_soh_rollup_queue q
    where q.attempts < 5
    order by q.attempts, q.enqueued_at
    for update skip locked
    limit p_batch_size
  loop
    begin
      perform public.bydmate_materialize_soh_day(
        v_item.user_id, v_item.vehicle_id, v_item.date
      );
      v_processed := v_processed + 1;
    exception when others then
      update public.bydmate_soh_rollup_queue q
      set attempts = q.attempts + 1,
          last_attempt_at = clock_timestamp(),
          last_error = left(sqlstate || ': ' || sqlerrm, 1000)
      where q.user_id = v_item.user_id
        and q.vehicle_id = v_item.vehicle_id
        and q.date = v_item.date;
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('processed', v_processed, 'failed', v_failed);
end;
$$;

-- Five years, independent of free/premium raw telemetry retention.
create or replace function public.purge_old_bydmate_soh_rollups()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint;
begin
  delete from public.bydmate_soh_daily_rollups
  where date < (clock_timestamp() at time zone 'UTC')::date - 1826;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.bydmate_soh_daily_raw_baseline(uuid, text, timestamptz, timestamptz) from public;
revoke all on function public.bydmate_materialize_soh_day(uuid, text, date) from public;
revoke all on function public.bydmate_enqueue_soh_day(date) from public;
revoke all on function public.bydmate_enqueue_soh_backfill(uuid, text, date, date) from public;
revoke all on function public.bydmate_process_soh_rollup_queue(integer) from public;
revoke all on function public.purge_old_bydmate_soh_rollups() from public;

grant execute on function public.bydmate_soh_daily_raw_baseline(uuid, text, timestamptz, timestamptz) to service_role;
grant execute on function public.bydmate_materialize_soh_day(uuid, text, date) to service_role;
grant execute on function public.bydmate_enqueue_soh_day(date) to service_role;
grant execute on function public.bydmate_enqueue_soh_backfill(uuid, text, date, date) to service_role;
grant execute on function public.bydmate_process_soh_rollup_queue(integer) to service_role;
grant execute on function public.purge_old_bydmate_soh_rollups() to service_role;

-- Scheduling and the reader switch are deliberately separate migrations.
