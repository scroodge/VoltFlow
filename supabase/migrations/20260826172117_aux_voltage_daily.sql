-- Resting 12 V auxiliary-battery analytics. The shared parked predicate keeps
-- phantom-drain and resting-voltage classification behavior aligned.
create or replace function public.bydmate_is_parked_unplugged(
  telemetry jsonb,
  gun_state text
)
returns boolean
language sql
immutable
security invoker
set search_path = public
as $$
  select
    coalesce(public.bydmate_jsonb_numeric(telemetry, 'speed_kmh'), 0) <= 0.5
    and abs(coalesce(public.bydmate_jsonb_numeric(telemetry, 'power_kw'), 0)) <= 0.1
    and not case
      when coalesce(public.bydmate_jsonb_numeric(telemetry, 'charge_power_kw'), 0) > 0 then true
      -- Di+ explicitly reports 1 when the gun is unplugged. Do not let a stale
      -- normalized is_charging Boolean suppress legitimate parked idle time.
      when gun_state = '1' then false
      else lower(coalesce(telemetry->>'is_charging', '')) in ('true', '1', 'yes', 'on')
    end;
$$;

create or replace function public.bydmate_phantom_drain_daily(
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
  with samples as (
    select
      device_time,
      (device_time at time zone 'UTC')::date as sample_date,
      public.bydmate_jsonb_numeric(telemetry, 'soc') as soc,
      public.bydmate_is_parked_unplugged(telemetry, diplus_charge_gun_state) as is_parked_unplugged,
      lag(device_time) over (order by device_time) as previous_device_time
    from public.bydmate_telemetry_samples
    where user_id = p_user_id
      and vehicle_id = p_vehicle_id
      and device_time >= p_from
      and device_time <= p_to
  ),
  daily as (
    select
      sample_date,
      array_agg(soc order by device_time) filter (where soc is not null) as soc_values,
      sum(
        case
          when soc is not null
            and is_parked_unplugged
            and previous_device_time is not null
            and device_time > previous_device_time
            and device_time - previous_device_time < interval '6 hours'
          then extract(epoch from device_time - previous_device_time) * 1000
          else 0
        end
      ) as idle_ms
    from samples
    group by sample_date
  )
  select
    sample_date,
    soc_values[1],
    soc_values[array_length(soc_values, 1)],
    soc_values[1] - soc_values[array_length(soc_values, 1)],
    idle_ms / 3600000
  from daily
  where array_length(soc_values, 1) > 0
    and idle_ms / 3600000 >= 4
    and soc_values[1] > soc_values[array_length(soc_values, 1)]
  order by sample_date;
$$;

create or replace function public.bydmate_aux_voltage_daily(
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
  with source_samples as (
    select
      device_time,
      coalesce(
        public.bydmate_jsonb_numeric(telemetry, 'aux_voltage_v'),
        diplus_voltage_12v
      ) as voltage,
      public.bydmate_is_parked_unplugged(telemetry, diplus_charge_gun_state) as is_parked
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
    min(voltage) filter (where voltage between 6 and 18)::numeric as v_min,
    max(voltage) filter (where voltage between 6 and 18)::numeric as v_max,
    percentile_cont(0.5) within group (order by voltage)
      filter (where voltage between 6 and 18 and is_parked and device_time >= interval_start + interval '2 hours')::numeric as v_resting,
    count(*) filter (where voltage between 6 and 18 and is_parked and device_time >= interval_start + interval '2 hours')::integer as resting_sample_count
  from qualified
  where device_time >= p_from
    and voltage between 6 and 18
  group by (device_time at time zone 'UTC')::date
  order by date;
$$;

create index if not exists bydmate_telemetry_samples_aux_voltage_analytics_idx
  on public.bydmate_telemetry_samples (user_id, vehicle_id, device_time desc)
  where telemetry ? 'aux_voltage_v';

revoke all on function public.bydmate_is_parked_unplugged(jsonb, text) from public;
revoke all on function public.bydmate_aux_voltage_daily(uuid, text, timestamptz, timestamptz) from public;

grant execute on function public.bydmate_is_parked_unplugged(jsonb, text) to authenticated, service_role;
grant execute on function public.bydmate_aux_voltage_daily(uuid, text, timestamptz, timestamptz) to authenticated, service_role;
