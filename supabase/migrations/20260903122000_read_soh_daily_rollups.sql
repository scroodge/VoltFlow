-- Switch the stable public reader to daily rollups. Full completed UTC days use
-- rollups. Partial boundary days and the two most recent UTC dates use bounded
-- raw reads to preserve exact current/partial-day semantics while cron catches up.
create or replace function public.bydmate_soh_daily(
  p_user_id uuid,
  p_vehicle_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  device_time timestamptz,
  soh_percent numeric
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_today date := (statement_timestamp() at time zone 'UTC')::date;
begin
  if p_to < p_from then
    return;
  end if;

  if p_vehicle_id is not null then
    return query
    with raw_windows as (
      select
        greatest(p_from, ((v_today - 1)::timestamp at time zone 'UTC')) as window_from,
        p_to as window_to
      where p_to >= ((v_today - 1)::timestamp at time zone 'UTC')
      union all
      select
        p_from,
        least(
          p_to,
          (((p_from at time zone 'UTC')::date + 1)::timestamp at time zone 'UTC')
            - interval '1 millisecond'
        )
      where p_from > ((p_from at time zone 'UTC')::date::timestamp at time zone 'UTC')
        and (p_from at time zone 'UTC')::date < v_today - 1
      union all
      select
        greatest(
          p_from,
          ((p_to at time zone 'UTC')::date::timestamp at time zone 'UTC')
        ),
        p_to
      where p_to < (
          (((p_to at time zone 'UTC')::date + 1)::timestamp at time zone 'UTC')
            - interval '1 millisecond'
        )
        and (p_to at time zone 'UTC')::date < v_today - 1
        and (p_to at time zone 'UTC')::date <> (p_from at time zone 'UTC')::date
    ),
    rolled_up as (
      select r.device_time, r.soh_percent
      from public.bydmate_soh_daily_rollups r
      where r.user_id = p_user_id
        and r.vehicle_id = p_vehicle_id
        and r.date < v_today - 1
        and (r.date::timestamp at time zone 'UTC') >= p_from
        and (((r.date + 1)::timestamp at time zone 'UTC') - interval '1 millisecond') <= p_to
        and r.device_time >= p_from
        and r.device_time <= p_to
    ),
    raw_boundaries as (
      select distinct on ((candidate.device_time at time zone 'UTC')::date)
        candidate.device_time,
        candidate.soh_percent
      from raw_windows w
      cross join lateral (
        select
          s.device_time,
          public.bydmate_jsonb_numeric(s.telemetry, 'soh_percent') as soh_percent
        from public.bydmate_telemetry_samples s
        where s.user_id = p_user_id
          and s.vehicle_id = p_vehicle_id
          and s.device_time >= w.window_from
          and s.device_time <= w.window_to
          and s.telemetry ? 'soh_percent'
          and public.bydmate_jsonb_numeric(s.telemetry, 'soh_percent') between 0 and 100
      ) candidate
      order by (candidate.device_time at time zone 'UTC')::date, candidate.device_time desc
    )
    select points.device_time, points.soh_percent
    from (
      select * from rolled_up
      union all
      select * from raw_boundaries
    ) points
    order by points.device_time;
  else
    return query
    with raw_windows as (
      select
        greatest(p_from, ((v_today - 1)::timestamp at time zone 'UTC')) as window_from,
        p_to as window_to
      where p_to >= ((v_today - 1)::timestamp at time zone 'UTC')
      union all
      select
        p_from,
        least(
          p_to,
          (((p_from at time zone 'UTC')::date + 1)::timestamp at time zone 'UTC')
            - interval '1 millisecond'
        )
      where p_from > ((p_from at time zone 'UTC')::date::timestamp at time zone 'UTC')
        and (p_from at time zone 'UTC')::date < v_today - 1
      union all
      select
        greatest(
          p_from,
          ((p_to at time zone 'UTC')::date::timestamp at time zone 'UTC')
        ),
        p_to
      where p_to < (
          (((p_to at time zone 'UTC')::date + 1)::timestamp at time zone 'UTC')
            - interval '1 millisecond'
        )
        and (p_to at time zone 'UTC')::date < v_today - 1
        and (p_to at time zone 'UTC')::date <> (p_from at time zone 'UTC')::date
    ),
    vehicles as (
      select distinct c.vehicle_alias as vehicle_id
      from public.cars c
      where c.user_id = p_user_id
        and nullif(trim(c.vehicle_alias), '') is not null
    ),
    rolled_up as (
      select distinct on (r.date) r.device_time, r.soh_percent
      from public.bydmate_soh_daily_rollups r
      where r.user_id = p_user_id
        and r.date < v_today - 1
        and (r.date::timestamp at time zone 'UTC') >= p_from
        and (((r.date + 1)::timestamp at time zone 'UTC') - interval '1 millisecond') <= p_to
        and r.device_time >= p_from
        and r.device_time <= p_to
      order by r.date, r.device_time desc
    ),
    raw_boundaries as (
      select distinct on ((candidate.device_time at time zone 'UTC')::date)
        candidate.device_time,
        candidate.soh_percent
      from vehicles v
      cross join raw_windows w
      cross join lateral (
        select
          s.device_time,
          public.bydmate_jsonb_numeric(s.telemetry, 'soh_percent') as soh_percent
        from public.bydmate_telemetry_samples s
        where s.user_id = p_user_id
          and s.vehicle_id = v.vehicle_id
          and s.device_time >= w.window_from
          and s.device_time <= w.window_to
          and s.telemetry ? 'soh_percent'
          and public.bydmate_jsonb_numeric(s.telemetry, 'soh_percent') between 0 and 100
      ) candidate
      order by (candidate.device_time at time zone 'UTC')::date, candidate.device_time desc
    )
    select points.device_time, points.soh_percent
    from (
      select * from rolled_up
      union all
      select * from raw_boundaries
    ) points
    order by points.device_time;
  end if;
end;
$$;

revoke all on function public.bydmate_soh_daily(uuid, text, timestamptz, timestamptz) from public;
grant execute on function public.bydmate_soh_daily(uuid, text, timestamptz, timestamptz) to authenticated, service_role;
