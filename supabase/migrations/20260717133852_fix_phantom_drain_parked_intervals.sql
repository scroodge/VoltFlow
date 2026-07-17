-- Phantom drain must measure SOC loss inside continuous parked intervals. The previous
-- RPC used parked time only as an eligibility filter, then subtracted the whole UTC
-- day's first/last SOC, so ordinary trips appeared as parked drain.

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
  with classified as (
    select
      device_time,
      (device_time at time zone 'UTC')::date as sample_date,
      public.bydmate_jsonb_numeric(telemetry, 'soc') as soc,
      coalesce(public.bydmate_jsonb_numeric(telemetry, 'speed_kmh'), 0) <= 0.5
        and abs(coalesce(public.bydmate_jsonb_numeric(telemetry, 'power_kw'), 0)) <= 0.1
        and not (
          coalesce(public.bydmate_jsonb_numeric(telemetry, 'charge_power_kw'), 0) > 0
          or (
            diplus_charge_gun_state is distinct from '1'
            and lower(coalesce(telemetry->>'is_charging', '')) in ('true', '1', 'yes', 'on')
          )
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

revoke all on function public.bydmate_phantom_drain_daily(uuid, text, timestamptz, timestamptz) from public;
grant execute on function public.bydmate_phantom_drain_daily(uuid, text, timestamptz, timestamptz) to authenticated, service_role;
