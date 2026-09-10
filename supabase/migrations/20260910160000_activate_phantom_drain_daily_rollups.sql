-- Activate the parity-verified Phantom Drain rollups. Completed UTC dates read
-- from the user-scoped projection; only at-most-three boundary dates may read
-- raw telemetry, preserving timestamp-precise API semantics without reviving
-- the 14-day window scan that exceeded production's statement timeout.

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
    -- The partial effective lower boundary. A UTC-day-aligned, completed day
    -- is served by the projection instead.
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

    -- The partial supplied upper boundary. It is kept separately so arbitrary
    -- historical API ranges retain their old timestamp semantics.
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

    -- Today is never complete. It stays a single tenant/vehicle/date raw read.
    select
      v_today,
      greatest(v_effective_from, (v_today::timestamp at time zone 'UTC')),
      p_to
    where p_to >= (v_today::timestamp at time zone 'UTC')

    union all

    -- Yesterday is normally a projection row. During the enqueue/worker seam,
    -- read this one completed day directly instead of showing a false gap.
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
  raw_boundaries as (
    select b.date, b.soc_start, b.soc_end, b.drain_percent, b.idle_hours
    from raw_windows w
    cross join lateral public.bydmate_phantom_drain_daily_raw_baseline(
      p_user_id,
      p_vehicle_id,
      w.window_from,
      w.window_to
    ) b
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

-- Keep completed-day work separate from application requests. Each worker
-- invocation claims one vehicle-day, so the schedule cannot create a large
-- transaction or compete with telemetry ingest through a broad raw query.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname in (
      'enqueue-bydmate-phantom-drain-daily',
      'process-bydmate-phantom-drain-rollups',
      'purge-bydmate-phantom-drain-rollups'
    );

    perform cron.schedule(
      'enqueue-bydmate-phantom-drain-daily',
      '18 0 * * *',
      $cron$select public.bydmate_enqueue_phantom_drain_day()$cron$
    );
    perform cron.schedule(
      'process-bydmate-phantom-drain-rollups',
      '4,9,14,19,24,29,34,39,44,49,54,59 * * * *',
      $cron$select public.bydmate_process_phantom_drain_rollup_queue()$cron$
    );
    perform cron.schedule(
      'purge-bydmate-phantom-drain-rollups',
      '40 3 * * *',
      $cron$select public.purge_old_bydmate_phantom_drain_rollups()$cron$
    );
  end if;
exception
  when undefined_table or undefined_function or invalid_schema_name then
    null;
end;
$$;
