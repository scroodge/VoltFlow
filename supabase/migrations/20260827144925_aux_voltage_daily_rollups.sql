-- Materialise completed UTC days for 12 V auxiliary-battery analytics.
--
-- This migration intentionally does not replace bydmate_aux_voltage_daily yet.
-- The current raw implementation is preserved below as an independent parity
-- baseline. The reader switches only after raw-vs-rollup parity is demonstrated.

create table if not exists public.bydmate_aux_voltage_daily_rollups (
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  date date not null,
  v_min numeric,
  v_max numeric,
  v_resting numeric,
  resting_sample_count integer not null default 0,
  battery_chemistry text,
  resting_ceiling_v numeric,
  computed_at timestamptz not null default now(),
  constraint bydmate_aux_voltage_daily_rollups_pkey
    primary key (user_id, vehicle_id, date),
  constraint bydmate_aux_voltage_daily_rollups_resting_count_check
    check (resting_sample_count >= 0),
  constraint bydmate_aux_voltage_daily_rollups_chemistry_check
    check (battery_chemistry is null or battery_chemistry in ('flooded', 'efb', 'agm', 'lifepo4', 'other')),
  constraint bydmate_aux_voltage_daily_rollups_completed_day_check
    check (date < (computed_at at time zone 'UTC')::date)
);

comment on table public.bydmate_aux_voltage_daily_rollups is
  'Server-maintained 12 V daily analytics. Retained for five years independently of raw telemetry retention.';

create table if not exists public.bydmate_aux_voltage_rollup_queue (
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  date date not null,
  reason text not null default 'daily',
  enqueued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  constraint bydmate_aux_voltage_rollup_queue_pkey
    primary key (user_id, vehicle_id, date),
  constraint bydmate_aux_voltage_rollup_queue_attempts_check
    check (attempts >= 0)
);

create index if not exists bydmate_aux_voltage_rollup_queue_claim_idx
  on public.bydmate_aux_voltage_rollup_queue (attempts, enqueued_at, user_id, vehicle_id, date);

alter table public.bydmate_aux_voltage_daily_rollups enable row level security;
alter table public.bydmate_aux_voltage_rollup_queue enable row level security;

drop policy if exists "bydmate_aux_voltage_daily_rollups_select_own"
  on public.bydmate_aux_voltage_daily_rollups;
create policy "bydmate_aux_voltage_daily_rollups_select_own"
  on public.bydmate_aux_voltage_daily_rollups
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.bydmate_aux_voltage_daily_rollups from public, anon, authenticated;
grant select on table public.bydmate_aux_voltage_daily_rollups to authenticated;
revoke all on table public.bydmate_aux_voltage_rollup_queue from public, anon, authenticated;

-- Centralise chemistry derivation so materialisation, staleness checks, and the
-- eventual reader cannot drift apart.
create or replace function public.bydmate_aux_effective_chemistry(
  p_battery_chemistry text,
  p_model_generation text
)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select coalesce(
    p_battery_chemistry,
    case p_model_generation
      when 'gen1_2024' then 'flooded'
      when 'gen2_2025' then 'lifepo4'
      else 'other'
    end
  );
$$;

create or replace function public.bydmate_aux_resting_ceiling(
  p_battery_chemistry text
)
returns numeric
language sql
immutable
security invoker
set search_path = public
as $$
  select case p_battery_chemistry
    when 'flooded' then 12.9
    when 'efb' then 13.0
    when 'agm' then 13.1
    when 'lifepo4' then 13.5
    else null
  end::numeric;
$$;

-- Frozen copy of the CURRENT raw-sample RPC. This is the only parity baseline;
-- it must not be rewritten to read the rollup table or a view over that table.
create or replace function public.bydmate_aux_voltage_daily_raw_baseline(
  p_user_id uuid,
  p_vehicle_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  date date,
  v_min numeric,
  v_max numeric,
  v_resting numeric,
  resting_sample_count integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with car_config as (
    select case coalesce(
      battery_chemistry,
      case model_generation
        when 'gen1_2024' then 'flooded'
        when 'gen2_2025' then 'lifepo4'
        else 'other'
      end
    )
      when 'flooded' then 12.9
      when 'efb' then 13.0
      when 'agm' then 13.1
      when 'lifepo4' then 13.5
      else null
    end::numeric as resting_ceiling
    from public.cars
    where user_id = p_user_id
      and vehicle_alias = p_vehicle_id
    order by created_at
    limit 1
  ),
  source_samples as (
    select
      device_time,
      coalesce(
        public.bydmate_jsonb_numeric(telemetry, 'aux_voltage_v'),
        diplus_voltage_12v
      ) as voltage,
      public.bydmate_jsonb_numeric(telemetry, 'aux_voltage_v') as telemetry_voltage,
      public.bydmate_is_parked_unplugged(telemetry, diplus_charge_gun_state) as is_parked,
      (select resting_ceiling from car_config) as resting_ceiling
    from public.bydmate_telemetry_samples
    where user_id = p_user_id
      and vehicle_id = p_vehicle_id
      and device_time >= p_from - interval '2 hours'
      and device_time <= p_to
  ),
  marked as (
    select *,
      case
        when is_parked and coalesce(lag(is_parked) over (order by device_time), false) then 0
        else 1
      end as starts_interval
    from source_samples
  ),
  grouped as (
    select *, sum(starts_interval) over (order by device_time) as interval_id
    from marked
  ),
  qualified as (
    select *, min(device_time) over (partition by interval_id) as interval_start
    from grouped
  )
  select
    (device_time at time zone 'UTC')::date as date,
    min(telemetry_voltage) filter (where telemetry_voltage between 6 and 18)::numeric as v_min,
    max(telemetry_voltage) filter (where telemetry_voltage between 6 and 18)::numeric as v_max,
    percentile_cont(0.5) within group (order by voltage)
      filter (
        where voltage between 6 and 18
          and is_parked
          and device_time >= interval_start + interval '2 hours'
          and (resting_ceiling is null or voltage <= resting_ceiling)
      )::numeric as v_resting,
    count(*) filter (
      where voltage between 6 and 18
        and is_parked
        and device_time >= interval_start + interval '2 hours'
        and (resting_ceiling is null or voltage <= resting_ceiling)
    )::integer as resting_sample_count
  from qualified
  where device_time >= p_from
    and voltage between 6 and 18
  group by (device_time at time zone 'UTC')::date
  order by date;
$$;

create or replace function public.bydmate_materialize_aux_voltage_day(
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
  v_chemistry text;
  v_ceiling numeric;
  v_inserted integer := 0;
begin
  if p_date >= (clock_timestamp() at time zone 'UTC')::date then
    raise exception 'Only completed UTC days can be materialised: %', p_date
      using errcode = '22023';
  end if;

  select
    public.bydmate_aux_effective_chemistry(c.battery_chemistry, c.model_generation),
    public.bydmate_aux_resting_ceiling(
      public.bydmate_aux_effective_chemistry(c.battery_chemistry, c.model_generation)
    )
  into v_chemistry, v_ceiling
  from public.cars c
  where c.user_id = p_user_id
    and c.vehicle_alias = p_vehicle_id
  order by c.created_at
  limit 1;

  delete from public.bydmate_aux_voltage_daily_rollups r
  where r.user_id = p_user_id
    and r.vehicle_id = p_vehicle_id
    and r.date = p_date;

  with source_samples as (
    select
      s.device_time,
      coalesce(
        public.bydmate_jsonb_numeric(s.telemetry, 'aux_voltage_v'),
        s.diplus_voltage_12v
      ) as voltage,
      public.bydmate_jsonb_numeric(s.telemetry, 'aux_voltage_v') as telemetry_voltage,
      (
        coalesce(s.diplus_speed_kmh, public.bydmate_jsonb_numeric(s.telemetry, 'speed_kmh'), 0) <= 0.5
        and abs(coalesce(s.diplus_power_kw, public.bydmate_jsonb_numeric(s.telemetry, 'power_kw'), 0)) <= 0.1
        and not case
          when coalesce(public.bydmate_jsonb_numeric(s.telemetry, 'charge_power_kw'), 0) > 0 then true
          when s.diplus_charge_gun_state = '1' then false
          else lower(coalesce(s.telemetry->>'is_charging', '')) in ('true', '1', 'yes', 'on')
        end
      ) as is_parked
    from public.bydmate_telemetry_samples s
    where s.user_id = p_user_id
      and s.vehicle_id = p_vehicle_id
      and s.device_time >= (p_date::timestamp at time zone 'UTC') - interval '2 hours'
      and s.device_time < ((p_date + 1)::timestamp at time zone 'UTC')
  ),
  marked as (
    select source_samples.*,
      case
        when is_parked and coalesce(lag(is_parked) over (order by device_time), false) then 0
        else 1
      end as starts_interval
    from source_samples
  ),
  grouped as (
    select marked.*,
      sum(starts_interval) over (order by device_time) as interval_id
    from marked
  ),
  qualified as (
    select grouped.*,
      min(device_time) over (partition by interval_id) as interval_start
    from grouped
  ),
  daily as (
    select
      min(telemetry_voltage) filter (where telemetry_voltage between 6 and 18)::numeric as v_min,
      max(telemetry_voltage) filter (where telemetry_voltage between 6 and 18)::numeric as v_max,
      percentile_cont(0.5) within group (order by voltage)
        filter (
          where voltage between 6 and 18
            and is_parked
            and device_time >= interval_start + interval '2 hours'
            and (v_ceiling is null or voltage <= v_ceiling)
        )::numeric as v_resting,
      count(*) filter (
        where voltage between 6 and 18
          and is_parked
          and device_time >= interval_start + interval '2 hours'
          and (v_ceiling is null or voltage <= v_ceiling)
      )::integer as resting_sample_count
    from qualified
    where device_time >= (p_date::timestamp at time zone 'UTC')
      and device_time < ((p_date + 1)::timestamp at time zone 'UTC')
      and voltage between 6 and 18
    having count(*) > 0
  )
  insert into public.bydmate_aux_voltage_daily_rollups (
    user_id, vehicle_id, date, v_min, v_max, v_resting,
    resting_sample_count, battery_chemistry, resting_ceiling_v, computed_at
  )
  select
    p_user_id, p_vehicle_id, p_date, daily.v_min, daily.v_max,
    daily.v_resting, daily.resting_sample_count, v_chemistry, v_ceiling,
    clock_timestamp()
  from daily
  on conflict (user_id, vehicle_id, date) do update
  set v_min = excluded.v_min,
      v_max = excluded.v_max,
      v_resting = excluded.v_resting,
      resting_sample_count = excluded.resting_sample_count,
      battery_chemistry = excluded.battery_chemistry,
      resting_ceiling_v = excluded.resting_ceiling_v,
      computed_at = excluded.computed_at;

  get diagnostics v_inserted = row_count;

  delete from public.bydmate_aux_voltage_rollup_queue q
  where q.user_id = p_user_id
    and q.vehicle_id = p_vehicle_id
    and q.date = p_date;

  return v_inserted > 0;
end;
$$;

create or replace function public.bydmate_enqueue_aux_voltage_day(
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

  insert into public.bydmate_aux_voltage_rollup_queue (
    user_id, vehicle_id, date, reason
  )
  select distinct s.user_id, s.vehicle_id, p_date, 'daily'
  from public.bydmate_telemetry_samples s
  where s.device_time >= (p_date::timestamp at time zone 'UTC')
    and s.device_time < ((p_date + 1)::timestamp at time zone 'UTC')
    and (
      public.bydmate_jsonb_numeric(s.telemetry, 'aux_voltage_v') between 6 and 18
      or s.diplus_voltage_12v between 6 and 18
    )
  on conflict (user_id, vehicle_id, date) do update
  set reason = excluded.reason,
      enqueued_at = least(
        public.bydmate_aux_voltage_rollup_queue.enqueued_at,
        excluded.enqueued_at
      );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.bydmate_enqueue_aux_voltage_backfill(
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
  if p_to < p_from or p_to - p_from > 30 then
    raise exception 'Backfill enqueue range must contain at most 31 days'
      using errcode = '22023';
  end if;

  insert into public.bydmate_aux_voltage_rollup_queue (
    user_id, vehicle_id, date, reason
  )
  select distinct
    s.user_id,
    s.vehicle_id,
    (s.device_time at time zone 'UTC')::date,
    'backfill'
  from public.bydmate_telemetry_samples s
  where s.user_id = p_user_id
    and s.vehicle_id = p_vehicle_id
    and s.device_time >= (p_from::timestamp at time zone 'UTC')
    and s.device_time < ((p_to + 1)::timestamp at time zone 'UTC')
    and s.device_time < date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC'
    and (
      public.bydmate_jsonb_numeric(s.telemetry, 'aux_voltage_v') between 6 and 18
      or s.diplus_voltage_12v between 6 and 18
    )
  on conflict (user_id, vehicle_id, date) do update
  set reason = excluded.reason,
      enqueued_at = least(
        public.bydmate_aux_voltage_rollup_queue.enqueued_at,
        excluded.enqueued_at
      );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.bydmate_process_aux_voltage_rollup_queue(
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
    from public.bydmate_aux_voltage_rollup_queue q
    where q.attempts < 5
    order by q.attempts, q.enqueued_at
    for update skip locked
    limit p_batch_size
  loop
    begin
      perform public.bydmate_materialize_aux_voltage_day(
        v_item.user_id, v_item.vehicle_id, v_item.date
      );
      v_processed := v_processed + 1;
    exception when others then
      update public.bydmate_aux_voltage_rollup_queue q
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

create or replace function public.bydmate_queue_aux_voltage_chemistry_rebuild()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_chemistry text;
  v_new_chemistry text;
  v_old_ceiling numeric;
  v_new_ceiling numeric;
begin
  v_old_chemistry := public.bydmate_aux_effective_chemistry(
    old.battery_chemistry, old.model_generation
  );
  v_new_chemistry := public.bydmate_aux_effective_chemistry(
    new.battery_chemistry, new.model_generation
  );
  v_old_ceiling := public.bydmate_aux_resting_ceiling(v_old_chemistry);
  v_new_ceiling := public.bydmate_aux_resting_ceiling(v_new_chemistry);

  if v_old_chemistry is distinct from v_new_chemistry
     or v_old_ceiling is distinct from v_new_ceiling then
    insert into public.bydmate_aux_voltage_rollup_queue (
      user_id, vehicle_id, date, reason
    )
    select r.user_id, r.vehicle_id, r.date, 'chemistry_changed'
    from public.bydmate_aux_voltage_daily_rollups r
    where r.user_id = new.user_id
      and r.vehicle_id = new.vehicle_alias
    on conflict (user_id, vehicle_id, date) do update
    set reason = excluded.reason,
        enqueued_at = excluded.enqueued_at,
        attempts = 0,
        last_attempt_at = null,
        last_error = null;
  end if;

  return new;
end;
$$;

drop trigger if exists bydmate_queue_aux_voltage_chemistry_rebuild on public.cars;
create trigger bydmate_queue_aux_voltage_chemistry_rebuild
after update of battery_chemistry, model_generation on public.cars
for each row
execute function public.bydmate_queue_aux_voltage_chemistry_rebuild();

-- The daily aggregate deliberately outlives raw retention. Keep five years.
create or replace function public.purge_old_bydmate_aux_voltage_rollups()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint;
begin
  delete from public.bydmate_aux_voltage_daily_rollups
  where date < (clock_timestamp() at time zone 'UTC')::date - 1826;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.bydmate_aux_effective_chemistry(text, text) from public;
revoke all on function public.bydmate_aux_resting_ceiling(text) from public;
revoke all on function public.bydmate_aux_voltage_daily_raw_baseline(uuid, text, timestamptz, timestamptz) from public;
revoke all on function public.bydmate_materialize_aux_voltage_day(uuid, text, date) from public;
revoke all on function public.bydmate_enqueue_aux_voltage_day(date) from public;
revoke all on function public.bydmate_enqueue_aux_voltage_backfill(uuid, text, date, date) from public;
revoke all on function public.bydmate_process_aux_voltage_rollup_queue(integer) from public;
revoke all on function public.bydmate_queue_aux_voltage_chemistry_rebuild() from public;
revoke all on function public.purge_old_bydmate_aux_voltage_rollups() from public;

grant execute on function public.bydmate_aux_voltage_daily_raw_baseline(uuid, text, timestamptz, timestamptz) to service_role;
grant execute on function public.bydmate_materialize_aux_voltage_day(uuid, text, date) to service_role;
grant execute on function public.bydmate_enqueue_aux_voltage_day(date) to service_role;
grant execute on function public.bydmate_enqueue_aux_voltage_backfill(uuid, text, date, date) to service_role;
grant execute on function public.bydmate_process_aux_voltage_rollup_queue(integer) to service_role;
grant execute on function public.purge_old_bydmate_aux_voltage_rollups() to service_role;

-- Deliberately do not schedule queue population/processing yet. The next
-- migration adds pg_cron jobs only after raw-vs-rollup parity is approved.
