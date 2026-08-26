-- Exclude DC-DC converter voltage from the resting median. Min/max deliberately
-- use sanitized telemetry only, while resting keeps raw fallback for sparse sleep samples.
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

revoke all on function public.bydmate_aux_voltage_daily(uuid, text, timestamptz, timestamptz) from public;
grant execute on function public.bydmate_aux_voltage_daily(uuid, text, timestamptz, timestamptz) to authenticated, service_role;
