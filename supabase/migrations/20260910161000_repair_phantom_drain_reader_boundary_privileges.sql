-- The activated security-invoker reader must not expose the frozen raw parity
-- baseline to authenticated callers. Rebuild its at-most-three date boundary
-- calculation inline, with the same raw semantics and tenant/vehicle/date
-- bounds, so the baseline remains service-role-only.

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
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_today date := (statement_timestamp() at time zone 'UTC')::date;
  v_effective_from timestamptz;
begin
  if p_user_id is null
     or nullif(trim(p_vehicle_id), '') is null
     or p_from is null
     or p_to is null then
    return;
  end if;

  v_effective_from := case
    when public.is_user_premium(p_user_id, statement_timestamp()) then p_from
    else greatest(p_from, statement_timestamp() - interval '1 month')
  end;

  if p_to < v_effective_from then
    return;
  end if;

  return query
  with raw_candidates as (
    select
      (v_effective_from at time zone 'UTC')::date as raw_date,
      v_effective_from as window_from,
      least(
        p_to,
        (((v_effective_from at time zone 'UTC')::date + 1)::timestamp at time zone 'UTC')
          - interval '1 microsecond'
      ) as window_to
    where v_effective_from > (
      (v_effective_from at time zone 'UTC')::date::timestamp at time zone 'UTC'
    )
       or (v_effective_from at time zone 'UTC')::date = v_today

    union all

    select
      (p_to at time zone 'UTC')::date as raw_date,
      greatest(
        v_effective_from,
        ((p_to at time zone 'UTC')::date::timestamp at time zone 'UTC')
      ) as window_from,
      p_to as window_to
    where p_to < (
      (((p_to at time zone 'UTC')::date + 1)::timestamp at time zone 'UTC')
        - interval '1 microsecond'
    )
       and (p_to at time zone 'UTC')::date < v_today

    union all

    select
      v_today,
      greatest(v_effective_from, (v_today::timestamp at time zone 'UTC')),
      p_to
    where p_to >= (v_today::timestamp at time zone 'UTC')

    union all

    select
      v_today - 1,
      ((v_today - 1)::timestamp at time zone 'UTC'),
      (v_today::timestamp at time zone 'UTC') - interval '1 microsecond'
    where ((v_today - 1)::timestamp at time zone 'UTC') >= v_effective_from
      and (v_today::timestamp at time zone 'UTC') - interval '1 microsecond' <= p_to
      and not exists (
        select 1
        from public.bydmate_phantom_drain_daily_rollups r
        where r.user_id = p_user_id
          and r.vehicle_id = p_vehicle_id
          and r.date = v_today - 1
      )
  ),
  raw_windows as (
    select raw_date, min(window_from) as window_from, max(window_to) as window_to
    from raw_candidates
    where window_from <= window_to
    group by raw_date
  ),
  rolled_up as (
    select r.date, r.soc_start, r.soc_end, r.drain_percent, r.idle_hours
    from public.bydmate_phantom_drain_daily_rollups r
    where r.user_id = p_user_id
      and r.vehicle_id = p_vehicle_id
      and r.date < v_today
      and (r.date::timestamp at time zone 'UTC') >= v_effective_from
      and (((r.date + 1)::timestamp at time zone 'UTC') - interval '1 microsecond') <= p_to
      and not exists (
        select 1 from raw_windows w where w.raw_date = r.date
      )
  ),
  raw_classified as (
    select
      w.raw_date,
      s.device_time,
      public.bydmate_jsonb_numeric(s.telemetry, 'soc') as soc,
      public.bydmate_is_parked_unplugged(
        s.telemetry,
        s.diplus_charge_gun_state
      ) as is_parked
    from raw_windows w
    join public.bydmate_telemetry_samples s
      on s.user_id = p_user_id
     and s.vehicle_id = p_vehicle_id
     and s.device_time >= w.window_from
     and s.device_time <= w.window_to
  ),
  raw_ordered as (
    select
      raw_classified.*,
      lag(device_time) over (
        partition by raw_date order by device_time
      ) as previous_device_time,
      lag(raw_date) over (
        partition by raw_date order by device_time
      ) as previous_sample_date,
      lag(is_parked) over (
        partition by raw_date order by device_time
      ) as previous_is_parked
    from raw_classified
  ),
  raw_marked as (
    select
      raw_ordered.*,
      sum(
        case
          when is_parked and (
            previous_is_parked is distinct from true
            or previous_sample_date is distinct from raw_date
            or previous_device_time is null
            or device_time <= previous_device_time
            or device_time - previous_device_time >= interval '6 hours'
          ) then 1
          else 0
        end
      ) over (
        partition by raw_date
        order by device_time rows unbounded preceding
      ) as parked_interval_id
    from raw_ordered
  ),
  raw_parked_intervals as (
    select
      raw_date,
      parked_interval_id,
      min(device_time) as interval_started_at,
      max(device_time) as interval_ended_at,
      array_agg(soc order by device_time) filter (where soc is not null) as soc_values
    from raw_marked
    where is_parked
    group by raw_date, parked_interval_id
  ),
  raw_eligible as (
    select
      raw_date,
      interval_started_at,
      interval_ended_at,
      soc_values[1] as interval_soc_start,
      soc_values[array_length(soc_values, 1)] as interval_soc_end,
      soc_values[1] - soc_values[array_length(soc_values, 1)] as interval_drain
    from raw_parked_intervals
    where interval_ended_at - interval_started_at >= interval '4 hours'
      and array_length(soc_values, 1) > 0
      and soc_values[1] > soc_values[array_length(soc_values, 1)]
  ),
  raw_boundaries as (
    select
      raw_date as date,
      (array_agg(interval_soc_start order by interval_started_at))[1] as soc_start,
      (array_agg(interval_soc_end order by interval_started_at desc))[1] as soc_end,
      sum(interval_drain) as drain_percent,
      sum(extract(epoch from interval_ended_at - interval_started_at)) / 3600
        as idle_hours
    from raw_eligible
    group by raw_date
  )
  select result.date, result.soc_start, result.soc_end, result.drain_percent, result.idle_hours
  from (
    select * from rolled_up
    union all
    select * from raw_boundaries
  ) result
  order by result.date;
end;
$$;

revoke all on function public.bydmate_phantom_drain_daily(uuid, text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.bydmate_phantom_drain_daily(uuid, text, timestamptz, timestamptz)
  to authenticated, service_role;
