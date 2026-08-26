-- Full-window day telemetry envelope. Each of 800 time buckets emits min, max,
-- and last samples (at most 2,400 rows), so dense 1 Hz days never truncate while
-- sharp per-field transients remain visible to the existing line charts.
create or replace function public.bydmate_telemetry_day_buckets(
  p_user_id uuid,
  p_vehicle_id text,
  p_from timestamptz,
  p_to timestamptz,
  p_bucket_count integer default 800
)
returns table (
  device_time timestamptz,
  bucket_id integer,
  bucket_kind integer,
  telemetry jsonb,
  diplus_charge_gun_state text,
  diplus_min_cell_voltage_v numeric,
  diplus_max_cell_voltage_v numeric,
  diplus_cell_delta_v numeric,
  source_sample_count bigint,
  source_first_time timestamptz,
  source_last_time timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with source as (
    select
      sample.*,
      least(
        greatest(p_bucket_count, 1) - 1,
        floor(
          extract(epoch from (sample.device_time - p_from))
          / greatest(extract(epoch from (p_to - p_from)), 0.001)
          * greatest(p_bucket_count, 1)
        )::integer
      ) as bucket_id
    from public.bydmate_telemetry_samples sample
    where sample.user_id = p_user_id
      and (p_vehicle_id is null or sample.vehicle_id = p_vehicle_id)
      and sample.device_time >= p_from
      and sample.device_time <= p_to
  ),
  bucketed as (
    select
      bucket_id,
      min(device_time) as bucket_first_time,
      max(device_time) as bucket_last_time,
      (array_agg(telemetry order by device_time desc))[1] as last_telemetry,
      (array_agg(diplus_charge_gun_state order by device_time desc))[1] as last_gun_state,
      (array_agg(diplus_min_cell_voltage_v order by device_time desc))[1] as last_flat_min_cell,
      (array_agg(diplus_max_cell_voltage_v order by device_time desc))[1] as last_flat_max_cell,
      (array_agg(diplus_cell_delta_v order by device_time desc))[1] as last_flat_delta,
      min(public.bydmate_jsonb_numeric(telemetry, 'soc')) as soc_min,
      max(public.bydmate_jsonb_numeric(telemetry, 'soc')) as soc_max,
      min(public.bydmate_jsonb_numeric(telemetry, 'speed_kmh')) as speed_min,
      max(public.bydmate_jsonb_numeric(telemetry, 'speed_kmh')) as speed_max,
      min(public.bydmate_jsonb_numeric(telemetry, 'power_kw')) as power_min,
      max(public.bydmate_jsonb_numeric(telemetry, 'power_kw')) as power_max,
      min(public.bydmate_jsonb_numeric(telemetry, 'charge_power_kw')) as charge_power_min,
      max(public.bydmate_jsonb_numeric(telemetry, 'charge_power_kw')) as charge_power_max,
      min(public.bydmate_jsonb_numeric(telemetry, 'battery_temp_c')) as battery_temp_min,
      max(public.bydmate_jsonb_numeric(telemetry, 'battery_temp_c')) as battery_temp_max,
      min(public.bydmate_jsonb_numeric(telemetry, 'cabin_temp_c')) as cabin_temp_min,
      max(public.bydmate_jsonb_numeric(telemetry, 'cabin_temp_c')) as cabin_temp_max,
      min(public.bydmate_jsonb_numeric(telemetry, 'outside_temp_c')) as outside_temp_min,
      max(public.bydmate_jsonb_numeric(telemetry, 'outside_temp_c')) as outside_temp_max,
      min(public.bydmate_jsonb_numeric(telemetry, 'aux_voltage_v')) as aux_voltage_min,
      max(public.bydmate_jsonb_numeric(telemetry, 'aux_voltage_v')) as aux_voltage_max,
      min(public.bydmate_jsonb_numeric(telemetry, 'cell_voltage_min_v')) as cell_voltage_min_min,
      max(public.bydmate_jsonb_numeric(telemetry, 'cell_voltage_min_v')) as cell_voltage_min_max,
      min(public.bydmate_jsonb_numeric(telemetry, 'cell_voltage_max_v')) as cell_voltage_max_min,
      max(public.bydmate_jsonb_numeric(telemetry, 'cell_voltage_max_v')) as cell_voltage_max_max,
      min(public.bydmate_jsonb_numeric(telemetry, 'cell_delta_v')) as cell_delta_min,
      max(public.bydmate_jsonb_numeric(telemetry, 'cell_delta_v')) as cell_delta_max,
      min(diplus_min_cell_voltage_v) as diplus_min_cell_min,
      max(diplus_min_cell_voltage_v) as diplus_min_cell_max,
      min(diplus_max_cell_voltage_v) as diplus_max_cell_min,
      max(diplus_max_cell_voltage_v) as diplus_max_cell_max,
      min(diplus_cell_delta_v) as diplus_delta_min,
      max(diplus_cell_delta_v) as diplus_delta_max
    from source
    group by bucket_id
  ),
  bounds as (
    select count(*)::bigint as sample_count, min(device_time) as first_time, max(device_time) as last_time
    from source
  ),
  envelope as (
    select bucket_id, 0 as kind, bucket_first_time as point_time, last_gun_state,
      last_telemetry || jsonb_strip_nulls(jsonb_build_object(
        'soc', soc_min, 'speed_kmh', speed_min, 'power_kw', power_min,
        'charge_power_kw', charge_power_min, 'battery_temp_c', battery_temp_min,
        'cabin_temp_c', cabin_temp_min, 'outside_temp_c', outside_temp_min,
        'aux_voltage_v', aux_voltage_min, 'cell_voltage_min_v', cell_voltage_min_min,
        'cell_voltage_max_v', cell_voltage_max_min, 'cell_delta_v', cell_delta_min
      )) as point_telemetry,
      diplus_min_cell_min as flat_min_cell, diplus_max_cell_min as flat_max_cell, diplus_delta_min as flat_delta
    from bucketed
    union all
    select bucket_id, 1, bucket_first_time + (bucket_last_time - bucket_first_time) / 2, last_gun_state,
      last_telemetry || jsonb_strip_nulls(jsonb_build_object(
        'soc', soc_max, 'speed_kmh', speed_max, 'power_kw', power_max,
        'charge_power_kw', charge_power_max, 'battery_temp_c', battery_temp_max,
        'cabin_temp_c', cabin_temp_max, 'outside_temp_c', outside_temp_max,
        'aux_voltage_v', aux_voltage_max, 'cell_voltage_min_v', cell_voltage_min_max,
        'cell_voltage_max_v', cell_voltage_max_max, 'cell_delta_v', cell_delta_max
      )),
      diplus_min_cell_max, diplus_max_cell_max, diplus_delta_max
    from bucketed
    union all
    select bucket_id, 2, bucket_last_time, last_gun_state, last_telemetry,
      last_flat_min_cell, last_flat_max_cell, last_flat_delta
    from bucketed
  )
  select
    envelope.point_time,
    envelope.bucket_id,
    envelope.kind,
    envelope.point_telemetry,
    envelope.last_gun_state,
    envelope.flat_min_cell,
    envelope.flat_max_cell,
    envelope.flat_delta,
    bounds.sample_count,
    bounds.first_time,
    bounds.last_time
  from envelope
  cross join bounds
  order by envelope.bucket_id, envelope.kind;
$$;

revoke all on function public.bydmate_telemetry_day_buckets(uuid, text, timestamptz, timestamptz, integer) from public;
grant execute on function public.bydmate_telemetry_day_buckets(uuid, text, timestamptz, timestamptz, integer) to authenticated, service_role;
